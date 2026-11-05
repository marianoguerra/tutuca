// A canvas of components and shapes: an SVG with each item in a <foreignObject>, so the other
// demos' HTML components live at a point of the canvas, and lines, arrows, rectangles, ellipses
// and text drawn between them. With the hole tool, clicking the canvas puts a Hole there, the
// empty slot of the studio's layouts: its + lists what it can become, and picking one swaps the
// hole for that component, maybe one of the layouts (layout.js) holding holes of their own.
// What a hole can become is up to the host: it asks (see layout.js), and kindHandlers(kinds)
// answers for a table of kinds; canvasComponents and canvasAskHandlers are the notebook's.
// Every item has a chrome, shown while the pointer is over it: a header to drag it by, collapse
// it, toggle editing it, clone it or remove it, and a corner to resize it by. Editing pushes the edit view
// above its content, so a layout in it (and every layout in that) shows what edits it.
//
// A foreignObject doesn't size to its content, so each one is as wide as its item and taller
// than any of them, and lets the pointer through (pointer-events none) where its card isn't;
// the card takes it back. A drag (moving or resizing an item, moving a shape, drawing one)
// captures the pointer on the canvas's svg, so the moves and the release reach the canvas
// wherever the pointer goes, and the components inside never see them.
import {
	$if,
	apply,
	component,
	copy,
	DISPLAY_META,
	each,
	field,
	pushView,
	render,
	renderEach,
	send,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { compositionComponents, GROUPS, KINDS, makeContent } from "../composition/index.js";
import { capture, coord, paintType, svgPoint } from "../drawing/shapes.js";
import {
	BECOME_ARGS,
	CANVAS_META,
	canvasMetaOf,
	kindEnv,
	kindHandlers,
	kindLook,
	layoutComponents,
	metaLabel,
	withBuiltins,
} from "./layout.js";
import { Arrow, Text } from "./shapes.js";

const { button, div, foreignObject, g, header, input, p, rect, span, svg } = tag;

// Taller than any item: the foreignObject's height, which the pointer goes through.
const ROOM = 4000;
const HOLE_WIDTH = 240;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 80;
// How tall an item grows with its content before its content scrolls; resizing it sets its
// height, past this too.
const MAX_AUTO_HEIGHT = 720;
// How far the canvas reaches past what's on it, growing as items are moved or resized there.
const GROW_MARGIN = 400;
// How far down and right of its item a clone goes.
const CLONE_OFFSET = 24;
const MAX_SIZE = 10000;
// How far the canvas zooms out and in, and how much each step does.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

// The chrome's parts are invisible until the pointer is over the item's card or something in it
// has the focus; till then the card is transparent too, its content on the canvas. Collapsed,
// there's no content to show where it is: its header and border stay, faded.
const CHROME =
	"opacity-0 [.canvas-card:hover>&]:opacity-100 [.canvas-card:focus-within>&]:opacity-100";
const SHOWN =
	"opacity-80 [.canvas-card:hover>&]:opacity-100 [.canvas-card:focus-within>&]:opacity-100";
const HEADER =
	"flex shrink-0 cursor-grab items-center gap-1 rounded-t-box border-b border-base-300 bg-base-200 px-2 py-1 transition-opacity select-none active:cursor-grabbing";
const CARD =
	"canvas-card relative flex flex-col rounded-box border transition-[background-color,border-color,box-shadow] hover:border-base-300 hover:bg-base-100 hover:shadow-md focus-within:border-base-300 focus-within:bg-base-100 focus-within:shadow-md";
const CARD_OPEN = `${CARD} border-transparent bg-transparent`;
// Holding anything but a layout or a hole, it keeps its background, or it'd blend into the
// canvas.
const CARD_BACKED = `${CARD} border-transparent bg-base-100`;
const CARD_COLLAPSED = `${CARD} border-base-300/60 bg-transparent`;
const HEADER_OPEN = `${HEADER} ${CHROME}`;
const HEADER_COLLAPSED = `${HEADER} rounded-b-box border-b-0 ${SHOWN}`;

// One component on the canvas, at x, y, with a chrome shown while the pointer is over it: a
// header to drag it by, collapse it, toggle editing it, clone it or remove it, and a corner to
// resize it by. Its height is its content's until it's resized (0). Editing, it pushes the edit view above
// its content, for the components that have one (the layouts).
export const Item = component({
	name: "Item",
	fields: {
		content: t.component(),
		x: coord(),
		y: coord(),
		width: t.number().int().min(MIN_WIDTH).max(4000).default(HOLE_WIDTH),
		height: t.number().int().min(0).max(4000),
		collapsed: t.boolean(),
		// The name given in its header; empty, the header says what it holds.
		title: t.string(),
		// Whether its content shows its edit view: a mode, not part of what's on the canvas.
		editing: t.boolean().sync("none"),
		// What the header says while the title is empty: what it holds.
		label: t.string().default("Empty"),
	},
	queries: {
		get isOpen() {
			return !this.collapsed;
		},
		get cardClass() {
			if (this.collapsed) return CARD_COLLAPSED;
			return canvasMetaOf(this.content).transparent ? CARD_OPEN : CARD_BACKED;
		},
		get headerClass() {
			return this.collapsed ? HEADER_COLLAPSED : HEADER_OPEN;
		},
		get chevron() {
			return this.collapsed ? "▸" : "▾";
		},
		// Whether its content has an edit view to toggle to.
		get canEdit() {
			return specOf(this.content).views.edit !== undefined;
		},
		get pushed() {
			return this.editing && this.canEdit ? "edit" : "main";
		},
		get editLabel() {
			return this.editing ? "Use it" : "Edit it";
		},
		get editIcon() {
			return this.editing ? "👁" : "✎";
		},
		get shownTitle() {
			return this.title === "" ? this.label : this.title;
		},
		// Resized, the card keeps its height and its content scrolls; till then it's as tall as
		// its content, up to MAX_AUTO_HEIGHT; collapsed, it's the header.
		get cardStyle() {
			if (this.collapsed) return "pointer-events:auto";
			const height =
				this.height === 0 ? `max-height:${MAX_AUTO_HEIGHT}px;` : `height:${this.height}px;`;
			return `${height}pointer-events:auto`;
		},
	},
	view: foreignObject(
		{
			x: field("x"),
			y: field("y"),
			width: field("width"),
			height: String(ROOM),
			style: "pointer-events:none;overflow:visible",
		},
		div(
			{
				class: field("cardClass"),
				style: field("cardStyle"),
			},
			header(
				{
					class: field("headerClass"),
					style: "touch-action:none",
					title: "Drag to move",
					"on:pointerdown": send("grab"),
				},
				span({ class: "opacity-40", "aria-hidden": "true" }, "⠿"),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Collapse or expand (Ctrl+click: every item)",
						"aria-expanded": $if(field("isOpen"), "true", "false"),
						"on:click": send("toggle"),
					},
					field("chevron"),
				),
				input({
					class:
						"input input-ghost input-xs min-w-0 flex-1 truncate px-1 text-xs font-bold opacity-60 focus:opacity-100",
					"aria-label": "Title",
					value: field("title"),
					placeholder: field("label"),
					"on:input": send("setTitle", targetValue()),
				}),
				$if(
					field("canEdit"),
					button(
						{
							class: "btn btn-ghost btn-xs w-6 px-0",
							title: field("editLabel"),
							"aria-label": field("editLabel"),
							"aria-pressed": $if(field("editing"), "true", "false"),
							"on:click": send("toggleEditing"),
						},
						field("editIcon"),
					),
					"",
				),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Maximize",
						"aria-label": "Maximize",
						"on:click": send("maximize"),
					},
					"⤢",
				),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Clone",
						"aria-label": "Clone",
						"on:click": send("clone"),
					},
					"⧉",
				),
				button({ class: "btn btn-ghost btn-xs", title: "Remove", "on:click": send("remove") }, "✕"),
			),
			$if(
				field("isOpen"),
				// Main pushed too, so a nested item's content isn't edited with this one's.
				div(
					{ class: "min-h-0 flex-1 overflow-auto p-3" },
					pushView(field("pushed"), render(field("content"))),
				),
				"",
			),
			div({
				class:
					"absolute right-0 bottom-0 size-4 cursor-nwse-resize rounded-br-box opacity-0 transition-opacity [.canvas-card:focus-within>&]:opacity-50 [.canvas-card:hover>&]:opacity-50 [.canvas-card:hover>&:hover]:opacity-100",
				style:
					"touch-action:none;background:linear-gradient(135deg,transparent 50%,currentColor 50% 60%,transparent 60% 70%,currentColor 70% 80%,transparent 80%)",
				title: "Drag to resize",
				"on:pointerdown": send("grabCorner"),
			}),
		),
	),
	// Maximized: over the whole page, as tall as its content, which scrolls past the window.
	views: {
		full: div(
			{
				class: "canvas-maximized fixed inset-0 z-50 flex items-start bg-base-300/70 p-4 sm:p-8",
				role: "dialog",
				"on:keydown": send("fullKey"),
				"aria-modal": "true",
				"aria-label": field("shownTitle"),
			},
			div(
				{
					class:
						"mx-auto flex max-h-full w-full max-w-5xl flex-col rounded-box border border-base-300 bg-base-100 shadow-xl",
				},
				header(
					{
						class:
							"flex shrink-0 items-center gap-1 rounded-t-box border-b border-base-300 bg-base-200 px-2 py-1",
					},
					span(
						{ class: "min-w-0 flex-1 truncate px-1 text-sm font-bold opacity-60" },
						field("shownTitle"),
					),
					$if(
						field("canEdit"),
						button(
							{
								class: "btn btn-ghost btn-xs w-6 px-0",
								title: field("editLabel"),
								"aria-label": field("editLabel"),
								"aria-pressed": $if(field("editing"), "true", "false"),
								"on:click": send("toggleEditing"),
							},
							field("editIcon"),
						),
						"",
					),
					button(
						{
							class: "btn btn-ghost btn-xs",
							title: "Restore (Esc)",
							"aria-label": "Restore",
							"on:click": send("restore"),
						},
						"⤡ Restore",
					),
				),
				div(
					{ class: "min-h-0 flex-1 overflow-auto p-4" },
					pushView(field("pushed"), render(field("content"))),
				),
			),
		),
	},
	on: {
		// With Ctrl (⌘ on a Mac) held, every item on the canvas does the same.
		toggle: {
			args: [],
			emits: { notify: ["collapseAll"] },
			run(next, _args, ctx) {
				const collapsed = !this.collapsed;
				if (ctx.event?.ctrlKey || ctx.event?.metaKey) ctx.notify("collapseAll", [collapsed]);
				else next.collapsed = collapsed;
			},
		},
		setCollapsed: {
			pure: true,
			args: [t.boolean()],
			run(next, [collapsed]) {
				next.collapsed = collapsed;
			},
		},
		// Maximized, the focus goes to its Restore button, so Esc reaches it.
		maximize: {
			args: [],
			emits: { notify: ["maximizeItem"] },
			run(_next, _args, ctx) {
				ctx.notify("maximizeItem");
				const root = ctx.event?.target?.closest?.(".canvas-root");
				afterRender(() => root?.querySelector('.canvas-maximized [aria-label="Restore"]')?.focus());
			},
		},
		fullKey: {
			args: [],
			emits: { notify: ["restoreItem"] },
			run(_next, _args, ctx) {
				const e = ctx.event;
				if (e?.key !== "Escape" || e.defaultPrevented) return;
				e.preventDefault();
				ctx.notify("restoreItem");
			},
		},
		restore: {
			args: [],
			emits: { notify: ["restoreItem"] },
			run(_next, _args, ctx) {
				ctx.notify("restoreItem");
			},
		},
		setTitle: {
			args: [t.string()],
			run(next, [title]) {
				next.title = title;
			},
		},
		toggleEditing(next) {
			next.editing = !this.editing;
		},
		moveTo: {
			pure: true,
			args: [coord(), coord()],
			run(next, [x, y]) {
				next.x = x;
				next.y = y;
			},
		},
		resizeTo: {
			pure: true,
			args: [t.number(), t.number()],
			run(next, [width, height]) {
				next.width = clamp(Math.round(width), MIN_WIDTH, 4000);
				next.height = clamp(Math.round(height), MIN_HEIGHT, 4000);
			},
		},
		// Its content becomes content, labeled label, width wide (0 keeps its width) and as tall
		// as it is; one with an edit view starts edited, to fill it in.
		setContent: {
			pure: true,
			args: BECOME_ARGS,
			run(next, [content, label, width]) {
				next.content = content;
				next.label = label;
				next.editing = specOf(content).views.edit !== undefined;
				if (width > 0) next.width = clamp(width, MIN_WIDTH, 4000);
				next.height = 0;
			},
		},
		clone: {
			args: [],
			emits: { notify: ["cloneItem"] },
			run(_next, _args, ctx) {
				ctx.notify("cloneItem");
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeItem"] },
			run(_next, _args, ctx) {
				ctx.notify("removeItem");
			},
		},
		// The header pressed, not one of its buttons or its title: the canvas picks the item up.
		grab: {
			args: [],
			emits: { notify: ["pickUp"] },
			run(_next, _args, ctx) {
				// Checked before pressPoint captures the pointer: a captured press never clicks.
				if (ctx.event?.target?.closest?.("button, input")) return;
				const point = pressPoint(ctx.event);
				if (point === null) return;
				ctx.notify("pickUp", point);
			},
		},
		// The corner pressed: the canvas resizes the item from its size now, as it shows.
		grabCorner: {
			args: [],
			emits: { notify: ["pickUpCorner"] },
			run(_next, _args, ctx) {
				const point = pressPoint(ctx.event);
				if (point === null) return;
				const shown = ctx.event.target.closest?.(".canvas-card")?.offsetHeight ?? 0;
				ctx.notify("pickUpCorner", [...point, this.height || shown]);
			},
		},
		// From the hole, on its way to the canvas, which makes what it becomes.
		become: { args: BECOME_ARGS, run() {} },
	},
});

// Where a primary press is, in its canvas, capturing the pointer there; null for other presses.
const pressPoint = (event) => {
	if (!event || event.button > 0) return null;
	const point = svgPoint(event);
	if (point === null) return null;
	event.preventDefault(); // No text selection while dragging.
	capture(event);
	return point;
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// How far the pointer may go between press and release for it to be a click.
const SLOP = 4;

// The canvas's tools: the hole tool adds holes, select picks and moves shapes, the rest draw.
const TOOLS = [
	["hole", "▢", "Add a component (H)", null],
	["select", "⬉", "Select and move shapes (V)", null],
	["line", "╱", "Line (L)", "Line"],
	["arrow", "↗", "Arrow (A)", "Arrow"],
	["rect", "▭", "Rectangle, Shift for a square (R)", "Rect"],
	["ellipse", "◯", "Ellipse, Shift for a circle (E)", "Ellipse"],
	["text", "T", "Text (T)", "Text"],
];
const TOOL_IDS = TOOLS.map(([id]) => id);
const TOOL_KEYS = {
	h: "hole",
	v: "select",
	l: "line",
	a: "arrow",
	r: "rect",
	e: "ellipse",
	t: "text",
};
export const SHAPES = ["Rect", "Ellipse", "Line", "Arrow", "Text"];
// The colors fill and stroke take.
export const COLORS = [
	"none",
	"#1f2937",
	"#9ca3af",
	"#ffffff",
	"#ef4444",
	"#f59e0b",
	"#22c55e",
	"#3b82f6",
	"#a855f7",
];
const NONE_STYLE = "background:repeating-linear-gradient(45deg,#fff 0 3px,#ef4444 3px 5px)";
const swatchStyle = (paint) => (paint === "none" ? NONE_STYLE : `background:${paint}`);
const ON = "btn btn-sm btn-square btn-primary join-item";
const OFF = "btn btn-sm btn-square join-item";
const swatches = (current, message, what) =>
	COLORS.map((color) => ({
		color,
		message,
		label: `${what} ${color}`,
		style: swatchStyle(color),
		cls: `size-5 rounded-sm border ${color === current ? "border-primary outline-2 outline-primary" : "border-base-content/30"}`,
	}));
const typing = (target) =>
	target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);

export const Canvas = component({
	name: "Canvas",
	meta: {
		[DISPLAY_META]: {
			title: "Canvas",
			icon: "🖼️",
			description: "Components and the shapes drawn between them, laid out on an SVG canvas.",
		},
		[CANVAS_META]: { width: 720 },
	},
	fields: {
		width: t.number().int().min(200).max(MAX_SIZE).default(2400),
		height: t.number().int().min(200).max(MAX_SIZE).default(1600),
		// How big it shows: 1 is a canvas pixel to a screen pixel.
		zoom: t.number().min(MIN_ZOOM).max(MAX_ZOOM).default(1).sync("local"),
		// The key of the item shown over the whole page, or "".
		maximized: t.string().sync("none"),
		// Items by key, and the keys from back to front; picking one up brings it to the front.
		items: t.map(t.component("Item")),
		order: t.array(t.string()),
		// Shapes from back to front, under the items.
		shapes: t.array(t.component(SHAPES)),
		tool: t.enum(...TOOL_IDS).sync("local"),
		fill: paintType("none"), // For new shapes, and the selected one.
		stroke: paintType("#1f2937"),
		selected: t.string().sync("none"), // The selected shape's id, or "".
		current: t.option(t.component(SHAPES)).sync("none"), // The shape being drawn.
		// What the pointer is dragging: an item (by key) to move or resize, a shape (by id) to
		// move, or the shape being drawn; and where it was grabbed, from what it's dragging.
		drag: t.enum("none", "move", "resize", "shape", "draw").sync("none"),
		dragKey: t.string().sync("none"),
		grabX: t.number().sync("none"),
		grabY: t.number().sync("none"),
		// Where the background was pressed, until it's released; a click there adds a hole.
		pressed: t.option(t.array(t.number())).sync("none"),
	},
	loops: {
		ordered: {
			iter(items) {
				return this.order.map((key) => [key, items[key]]);
			},
		},
		shapes: {
			key(_index, shape) {
				return shape.id;
			},
		},
		// The maximized item, if any, in its full view.
		maximized: {
			iter(items) {
				const item = items[this.maximized];
				return item === undefined ? [] : [[this.maximized, item]];
			},
			view: "full",
		},
	},
	invariants: {
		orderHasEveryItem() {
			const keys = Object.keys(this.items);
			return keys.length === this.order.length && this.order.every((k) => k in this.items);
		},
		uniqueShapeIds() {
			return new Set(this.shapes.map((s) => s.id)).size === this.shapes.length;
		},
		selectionExists() {
			return this.selected === "" || this.shapes.some((s) => s.id === this.selected);
		},
	},
	methods: {
		selectedIndex() {
			return this.shapes.findIndex((s) => s.id === this.selected);
		},
	},
	queries: {
		get viewBox() {
			return `0 0 ${this.width} ${this.height}`;
		},
		// The viewBox is the whole canvas; the svg is as big as it shows, zoomed, and its
		// viewport scrolls.
		get shownWidth() {
			return String(Math.round(this.width * this.zoom));
		},
		get shownHeight() {
			return String(Math.round(this.height * this.zoom));
		},
		get zoomLabel() {
			return `${Math.round(this.zoom * 100)}%`;
		},
		get cantZoomOut() {
			return this.zoom <= MIN_ZOOM;
		},
		get cantZoomIn() {
			return this.zoom >= MAX_ZOOM;
		},
		get bgClass() {
			if (this.drag !== "none") return "canvas-bg cursor-grabbing";
			return `canvas-bg ${this.tool === "select" ? "cursor-default" : "cursor-crosshair"}`;
		},
		get toolButtons() {
			return TOOLS.map(([id, icon, label]) => ({
				id,
				icon,
				label,
				cls: id === this.tool ? ON : OFF,
			}));
		},
		get fillSwatches() {
			return swatches(this.fill, "setFill", "Fill");
		},
		get strokeSwatches() {
			return swatches(this.stroke, "setStroke", "Stroke");
		},
		get selection() {
			return this.shapes.find((s) => s.id === this.selected) ?? null;
		},
		get noSelection() {
			return this.selection === null;
		},
		get hasSelection() {
			return this.selection !== null;
		},
		get isTextSelected() {
			return this.selection !== null && specOf(this.selection).name === "Text";
		},
		get selectedText() {
			return this.isTextSelected ? this.selection.text : "";
		},
		get hasCurrent() {
			return this.current !== null;
		},
		// The selected shape's box, a little bigger.
		get selX() {
			return (this.selection?.left ?? 0) - 4;
		},
		get selY() {
			return (this.selection?.top ?? 0) - 4;
		},
		get selW() {
			return (this.selection?.boxWidth ?? 0) + 8;
		},
		get selH() {
			return (this.selection?.boxHeight ?? 0) + 8;
		},
		get hint() {
			const tool = TOOLS.find(([id]) => id === this.tool)[2].replace(/ \(.\)$/, "");
			return `${tool} · drag an item by its header, resize it by its corner · Ctrl+wheel zooms`;
		},
	},
	view: div(
		{
			class: "canvas-root flex flex-col gap-2 outline-none",
			tabindex: "0",
			"on:keydown": send("key"),
		},
		div(
			{ class: "flex flex-wrap items-center gap-3" },
			div(
				{ class: "join", role: "toolbar", "aria-label": "Tools" },
				each(
					field("toolButtons"),
					button(
						{
							class: field("cls"),
							title: field("label"),
							"aria-label": field("label"),
							value: field("id"),
							"on:click": send("setTool", targetValue()),
						},
						field("icon"),
					),
				),
			),
			...[
				["Fill", "fillSwatches", "setFill"],
				["Stroke", "strokeSwatches", "setStroke"],
			].map(([label, swatchesField, message]) =>
				div(
					{ class: "flex items-center gap-1 text-xs", role: "group", "aria-label": label },
					span({ class: "w-10 opacity-70" }, label),
					each(
						field(swatchesField),
						button({
							class: field("cls"),
							style: field("style"),
							title: field("label"),
							"aria-label": field("label"),
							value: field("color"),
							"on:click": send(message, targetValue()),
						}),
					),
				),
			),
			$if(
				field("isTextSelected"),
				input({
					class: "input input-sm w-48",
					"aria-label": "Text",
					value: field("selectedText"),
					"on:input": send("setText", targetValue()),
				}),
				"",
			),
			button(
				{
					class: "btn btn-sm",
					disabled: field("noSelection"),
					title: "Delete the selected shape (Del)",
					"on:click": send("removeShape"),
				},
				"Delete",
			),
			div(
				{ class: "join ml-auto", role: "group", "aria-label": "Zoom" },
				button(
					{
						class: OFF,
						title: "Zoom out",
						"aria-label": "Zoom out",
						disabled: field("cantZoomOut"),
						"on:click": send("zoomOut"),
					},
					"−",
				),
				button(
					{
						class: "btn btn-sm join-item w-16 tabular-nums",
						title: "Actual size",
						"aria-label": "Actual size",
						"on:click": send("zoomReset"),
					},
					field("zoomLabel"),
				),
				button(
					{
						class: OFF,
						title: "Zoom in",
						"aria-label": "Zoom in",
						disabled: field("cantZoomIn"),
						"on:click": send("zoomIn"),
					},
					"+",
				),
				button(
					{
						class: "btn btn-sm join-item",
						title: "Zoom to fit what's on the canvas",
						"on:click": send("zoomToFit"),
					},
					"Fit",
				),
			),
		),
		p({ class: "text-xs opacity-60" }, field("hint")),
		div(
			{
				class:
					"canvas-viewport max-h-[80vh] overflow-auto rounded-box border border-base-300 bg-base-200",
			},
			svg(
				{
					class: "canvas-svg block",
					viewBox: field("viewBox"),
					width: field("shownWidth"),
					height: field("shownHeight"),
					style:
						"background-image:radial-gradient(circle,rgb(0 0 0 / 0.15) 1px,transparent 1px);background-size:24px 24px",
					"on:wheel": send("wheel"),
					"on:pointermove": send("drag"),
					"on:pointerup": send("release"),
					"on:pointercancel": send("cancel"),
				},
				rect({
					class: field("bgClass"),
					width: "100%",
					height: "100%",
					fill: "transparent",
					"on:pointerdown": send("press"),
				}),
				g(renderEach(field("shapes"), "shapes")),
				$if(field("hasCurrent"), render(field("current")), ""),
				$if(
					field("hasSelection"),
					rect({
						x: field("selX"),
						y: field("selY"),
						width: field("selW"),
						height: field("selH"),
						fill: "none",
						stroke: "#3b82f6",
						"stroke-width": "1",
						"stroke-dasharray": "4 3",
						"pointer-events": "none",
					}),
					"",
				),
				renderEach(field("items"), "ordered"),
			),
		),
		renderEach(field("items"), "maximized"),
	),
	on: {
		// A hole at x, y.
		addHole: {
			args: [coord(), coord()],
			run(next, [x, y], ctx) {
				const key = ctx.uuid();
				const C = ctx.scope.components;
				next.items[key] = C.Item({ content: C.Hole(), x, y });
				next.order.push(key);
				growTo(this, next, x + HOLE_WIDTH, y + MIN_HEIGHT);
			},
		},
		// Zooming by the buttons keeps the middle of what shows where it is.
		zoomIn(next, _args, ctx) {
			zoomAround(this, next, this.zoom * ZOOM_STEP, ctx.event);
		},
		zoomOut(next, _args, ctx) {
			zoomAround(this, next, this.zoom / ZOOM_STEP, ctx.event);
		},
		zoomReset(next, _args, ctx) {
			zoomAround(this, next, 1, ctx.event);
		},
		setZoom: {
			pure: true,
			args: [t.number()],
			run(next, [zoom]) {
				next.zoom = clampZoom(zoom);
			},
		},
		// Ctrl+wheel (a pinch on a trackpad) zooms around the pointer; the wheel alone scrolls.
		wheel(next, _args, ctx) {
			const e = ctx.event;
			if (!e || !(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			zoomAround(this, next, this.zoom * Math.exp(-e.deltaY * 0.002), e, [e.clientX, e.clientY]);
		},
		// Zoomed, no further in than actual size, so everything on it shows, and scrolled to it.
		zoomToFit(next, _args, ctx) {
			const viewport = viewportOf(ctx.event);
			const box = contentBox(this, viewport);
			if (viewport === null || box === null) {
				zoomAround(this, next, 1, ctx.event);
				return;
			}
			const pad = 16;
			const zoom = clampZoom(
				Math.min(
					1,
					(viewport.clientWidth - 2 * pad) / box.width,
					(viewport.clientHeight - 2 * pad) / box.height,
				),
			);
			next.zoom = zoom;
			afterRender(() => {
				viewport.scrollLeft = box.left * zoom - pad;
				viewport.scrollTop = box.top * zoom - pad;
			});
		},
		// From an item's header, Ctrl+clicked: every item collapses or expands.
		collapseAll: {
			args: [t.boolean()],
			run(next, [collapsed], ctx) {
				ctx.stopNext();
				for (const key of this.order)
					next.items[key] = apply(next.items[key], "setCollapsed", collapsed);
			},
		},
		maximizeItem: {
			args: [],
			sourceKey: t.index("items"),
			run(next, _args, ctx) {
				ctx.stopNext();
				next.maximized = ctx.sourceKey;
			},
		},
		restoreItem: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				next.maximized = "";
			},
		},
		setTool: {
			args: [t.string()],
			run(next, [tool]) {
				if (!TOOL_IDS.includes(tool)) return;
				next.tool = tool;
				next.selected = ""; // So paint picked for the new tool leaves the last shape as it is.
				next.current = null;
				next.drag = "none";
			},
		},
		// The paint for new shapes, and the selected one's.
		setFill: {
			args: [t.string()],
			run(next, [color]) {
				if (!COLORS.includes(color)) return;
				next.fill = color;
				restyle(this, next, { fill: color });
			},
		},
		setStroke: {
			args: [t.string()],
			run(next, [color]) {
				if (!COLORS.includes(color)) return;
				next.stroke = color;
				restyle(this, next, { stroke: color });
			},
		},
		setText: {
			args: [t.string()],
			run(next, [value]) {
				const i = this.selectedIndex();
				if (i >= 0 && this.isTextSelected) next.shapes[i] = apply(next.shapes[i], "setText", value);
			},
		},
		removeShape: {
			args: [],
			run(next) {
				if (this.selected === "") return;
				next.shapes = this.shapes.filter((s) => s.id !== this.selected);
				next.selected = "";
			},
		},
		key(next, _args, ctx) {
			const e = ctx.event;
			if (!e || e.defaultPrevented || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey)
				return;
			const key = e.key?.toLowerCase();
			if (key === "delete" || key === "backspace") Canvas.on.removeShape.run.call(this, next);
			else if (key === "escape") {
				next.maximized = "";
				next.selected = "";
				next.current = null;
				next.drag = "none";
			} else if (TOOL_KEYS[key] !== undefined)
				Canvas.on.setTool.run.call(this, next, [TOOL_KEYS[key]], ctx);
			else return;
			e.preventDefault();
		},
		// Pointer events on the background and the svg, turned into the messages above and below.
		press(next, _args, ctx) {
			const e = ctx.event;
			const point = svgPoint(e);
			if (point === null || e.button > 0) return;
			next.selected = "";
			capture(e); // So the drag's moves and release reach the svg, not what's drawn.
			startAt(this, next, point, ctx);
		},
		drag(next, _args, ctx) {
			if (this.drag === "none") return;
			const point = svgPoint(ctx.event);
			if (point === null) return;
			dragTo(this, next, point, ctx.event.shiftKey);
		},
		release(next, _args, ctx) {
			releaseAt(this, next, svgPoint(ctx.event), ctx);
		},
		cancel(next) {
			next.drag = "none";
			next.current = null;
			next.pressed = null;
		},
		// From an item's header: it's picked up at x, y, and comes to the front.
		pickUp: {
			args: [coord(), coord()],
			sourceKey: t.index("items"),
			run(next, [x, y], ctx) {
				ctx.stopNext();
				const item = this.items[ctx.sourceKey];
				grab(this, next, "move", ctx.sourceKey, x - item.x, y - item.y);
			},
		},
		// From an item's corner: it's resized from height, how tall it shows.
		pickUpCorner: {
			args: [coord(), coord(), t.number()],
			sourceKey: t.index("items"),
			run(next, [x, y, height], ctx) {
				ctx.stopNext();
				const item = this.items[ctx.sourceKey];
				grab(this, next, "resize", ctx.sourceKey, x - item.width, y - height);
			},
		},
		// From an item's header: a copy of it, everything in it a new instance (copy), a little
		// down and right of it, in front.
		cloneItem: {
			args: [],
			sourceKey: t.index("items"),
			run(next, _args, ctx) {
				ctx.stopNext();
				const item = this.items[ctx.sourceKey];
				const key = ctx.uuid();
				const x = item.x + CLONE_OFFSET;
				const y = item.y + CLONE_OFFSET;
				next.items[key] = apply(copy(item), "moveTo", x, y);
				next.order.push(key);
				growTo(this, next, x + item.width, y + (item.height || MIN_HEIGHT));
			},
		},
		removeItem: {
			args: [],
			sourceKey: t.index("items"),
			run(next, _args, ctx) {
				ctx.stopNext();
				delete next.items[ctx.sourceKey];
				next.order = this.order.filter((k) => k !== ctx.sourceKey);
				if (this.dragKey === ctx.sourceKey) next.drag = "none";
				if (this.maximized === ctx.sourceKey) next.maximized = "";
			},
		},
		// From a pressed shape: the drawing tools draw over it, the others pick it up.
		shapeDown: {
			args: [t.string(), coord(), coord()],
			run(next, [id, x, y], ctx) {
				ctx.stopNext();
				const drawing = TOOLS.find(([tool]) => tool === this.tool)[3] !== null;
				if (drawing || !this.shapes.some((s) => s.id === id)) {
					startAt(this, next, [x, y], ctx);
					return;
				}
				next.selected = id;
				grab(this, next, "shape", id, x, y);
			},
		},
		// Moves and releases that nothing captured, passed on by the shape under the pointer.
		shapeMove: {
			args: [coord(), coord()],
			run(next, point, ctx) {
				ctx.stopNext();
				if (this.drag !== "none") dragTo(this, next, point, false);
			},
		},
		shapeUp: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				releaseAt(this, next, null, ctx);
			},
		},
		// From the hole of the item at ctx.sourceKey: it becomes content.
		become: {
			args: BECOME_ARGS,
			sourceKey: t.index("items"),
			run(next, [content, label, width], ctx) {
				ctx.stopNext();
				const item = next.items[ctx.sourceKey];
				next.items[ctx.sourceKey] = apply(item, "setContent", content, label, width);
			},
		},
	},
});

// A press at point on the background or a shape, by the tool: a hole's click starts, a shape
// starts being drawn, or a text is put there and selected.
function startAt(self, next, [x, y], ctx) {
	const kind = TOOLS.find(([id]) => id === self.tool)[3];
	const C = ctx.scope.components;
	const style = { id: `s-${ctx.uuid()}`, fill: self.fill, stroke: self.stroke };
	if (self.tool === "hole") next.pressed = [x, y];
	else if (kind === "Text") {
		next.shapes.push(C.Text({ ...style, x, y }));
		next.selected = style.id;
		next.tool = "select"; // So the next press picks it up, or another shape.
	} else if (kind !== null) {
		next.current = C[kind]({ ...style, x0: x, y0: y, x1: x, y1: y });
		next.drag = "draw";
	}
}

// The pointer let go at point (null when it isn't known): a drawn shape is kept and selected,
// a drag ends, and a click on the background with the hole tool puts a hole there.
function releaseAt(self, next, point, ctx) {
	const was = self.pressed;
	next.drag = "none";
	next.pressed = null;
	if (self.drag === "draw") {
		next.current = null;
		if (self.current === null || self.current.isEmpty()) return;
		next.shapes.push(self.current);
		next.selected = self.current.id;
		return;
	}
	if (self.drag !== "none" || was === null) return;
	const [x, y] = point ?? was;
	if (Math.hypot(x - was[0], y - was[1]) > SLOP) return;
	Canvas.on.addHole.run.call(self, next, was, ctx);
}

function grab(self, next, drag, key, grabX, grabY) {
	next.drag = drag;
	next.dragKey = key;
	next.grabX = grabX;
	next.grabY = grabY;
	next.pressed = null;
	if (drag === "move" || drag === "resize")
		next.order = [...self.order.filter((k) => k !== key), key];
}

// The pointer at point while dragging; square makes rectangles squares and ellipses circles.
function dragTo(self, next, [x, y], square) {
	const key = self.dragKey;
	if (self.drag === "move") {
		const item = self.items[key];
		if (item === undefined) return;
		const nx = clamp(Math.round(x - self.grabX), 0, self.width - 40);
		const ny = clamp(Math.round(y - self.grabY), 0, self.height - 24);
		next.items[key] = apply(item, "moveTo", nx, ny);
		growTo(self, next, nx + item.width, ny + (item.height || MAX_AUTO_HEIGHT));
	} else if (self.drag === "resize") {
		const item = self.items[key];
		if (item === undefined) return;
		const resized = apply(item, "resizeTo", x - self.grabX, y - self.grabY);
		next.items[key] = resized;
		growTo(self, next, resized.x + resized.width, resized.y + resized.height);
	} else if (self.drag === "shape") {
		const i = self.shapes.findIndex((s) => s.id === key);
		if (i < 0) return;
		next.shapes[i] = apply(self.shapes[i], "moveBy", x - self.grabX, y - self.grabY);
		next.grabX = x;
		next.grabY = y;
	} else if (self.drag === "draw" && self.current !== null) {
		const { x0, y0 } = self.current;
		const kind = specOf(self.current).name;
		if (square && (kind === "Rect" || kind === "Ellipse")) {
			const side = Math.max(Math.abs(x - x0), Math.abs(y - y0));
			x = x0 + Math.sign(x - x0 || 1) * side;
			y = y0 + Math.sign(y - y0 || 1) * side;
		}
		next.current = apply(self.current, "dragTo", x, y);
	}
}

// The canvas grows to reach GROW_MARGIN past right and bottom, never shrinking.
function growTo(self, next, right, bottom) {
	const width = Math.min(MAX_SIZE, Math.ceil(right + GROW_MARGIN));
	const height = Math.min(MAX_SIZE, Math.ceil(bottom + GROW_MARGIN));
	if (width > self.width) next.width = width;
	if (height > self.height) next.height = height;
}

const clampZoom = (zoom) => clamp(Math.round(zoom * 1000) / 1000, MIN_ZOOM, MAX_ZOOM);
// The scrolling viewport of the canvas an event happened in, or null outside a browser.
const viewportOf = (event) =>
	event?.target?.closest?.(".canvas-root")?.querySelector(":scope > .canvas-viewport") ?? null;
// Runs fn once the render the handler causes is done: scrolling has to wait for the new size.
const afterRender = (fn) => {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
};
// Zooms to zoom keeping the canvas point under at (client coordinates; the viewport's middle
// without it) where it shows.
function zoomAround(self, next, zoom, event, at = undefined) {
	const to = clampZoom(zoom);
	next.zoom = to;
	const viewport = viewportOf(event);
	if (viewport === null) return;
	const rect = viewport.getBoundingClientRect();
	const ox = (at?.[0] ?? rect.left + viewport.clientWidth / 2) - rect.left;
	const oy = (at?.[1] ?? rect.top + viewport.clientHeight / 2) - rect.top;
	const px = (viewport.scrollLeft + ox) / self.zoom;
	const py = (viewport.scrollTop + oy) / self.zoom;
	afterRender(() => {
		viewport.scrollLeft = px * to - ox;
		viewport.scrollTop = py * to - oy;
	});
}
// The box around every item and shape, in canvas coordinates, or null when there's none. An
// item as tall as its content is measured, as it shows in viewport.
function contentBox(self, viewport) {
	const cards = viewport?.querySelectorAll(":scope > svg > foreignObject > .canvas-card") ?? [];
	const boxes = self.order.map((key, i) => {
		const item = self.items[key];
		const shown = cards[i]?.offsetHeight ?? 0;
		return [item.x, item.y, item.width, item.height || shown || MIN_HEIGHT];
	});
	for (const s of self.shapes) boxes.push([s.left, s.top, s.boxWidth, s.boxHeight]);
	if (boxes.length === 0) return null;
	const left = Math.min(...boxes.map(([x]) => x));
	const top = Math.min(...boxes.map(([, y]) => y));
	const right = Math.max(...boxes.map(([x, , w]) => x + w));
	const bottom = Math.max(...boxes.map(([, y, , h]) => y + h));
	return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

// The selected shape takes the changed paint, keeping the rest of its style.
function restyle(self, next, changes) {
	const i = self.selectedIndex();
	if (i < 0) return;
	const { fill, stroke, width } = self.shapes[i];
	next.shapes[i] = apply(
		next.shapes[i],
		"setStyle",
		changes.fill ?? fill,
		changes.stroke ?? stroke,
		width,
	);
}

// A canvas with items, each [x, y, content], and shapes; item keys are item-1, item-2…
// A canvas with items, each [x, y, what, label, width], and fields; item keys are item-1,
// item-2… what is a kind's id, made as a hole picking it would, or a component, labeled label
// (its component's name without one); width defaults to the kind's.
export const canvas = (C, items = [], fields = {}, kinds = COMPOSITION_KINDS) => {
	const all = withBuiltins(kinds);
	let made = 0;
	const read = { now: () => 0, uuid: () => `made-${++made}` };
	const order = items.map((_, i) => `item-${i + 1}`);
	const itemOf = ([x, y, what, label, width]) => {
		if (typeof what !== "string") {
			const name = specOf(what).name;
			const w = width ?? canvasMetaOf(what).width;
			const l = label ?? metaLabel(what) ?? name;
			return C.Item({ x, y, content: what, label: l, ...(w ? { width: w } : {}) });
		}
		const kind = all[what];
		if (kind === undefined) throw new Error(`no component kind ${what}`);
		const content = kind.make(C, kindEnv(read));
		const look = kindLook(kind, content);
		const w = width ?? look.width;
		return C.Item({ x, y, content, label: label ?? look.label, ...(w ? { width: w } : {}) });
	};
	return C.Canvas({
		...fields,
		order,
		items: Object.fromEntries(items.map((item, i) => [order[i], itemOf(item)])),
	});
};

// The notebook's kinds: what its pickers offer, a tracker picking its group first. Their
// components say what they are in their display meta; they say nothing to a canvas, so the
// width, how wide each reads well, is the kind's.
const COMPOSITION_WIDTHS = {
	notes: 320,
	todos: 760,
	kanban: 720,
	drawing: 760,
	tracker: 380,
	notebook: 560,
};
export const COMPOSITION_KINDS = Object.fromEntries(
	Object.entries(KINDS).map(([id, component]) => [
		id,
		{
			component,
			width: COMPOSITION_WIDTHS[id],
			make: (C, { choice, now, tz, uuid }) =>
				makeContent(C, id, { group: choice ?? undefined, now, tz, uuid }),
			...(id === "tracker" ? { choices: GROUPS.map(({ id, title }) => ({ id, title })) } : {}),
		},
	]),
);

// The canvas's own components: its items, shapes, holes and layouts. Whoever uses it registers
// these, the components its holes' kinds make, and kindHandlers(kinds) to answer the holes.
export const canvasKitComponents = { ...layoutComponents, Canvas, Item, Arrow, Text };
// The notebook's components on a canvas, and the handlers for its kinds.
export const canvasComponents = { ...compositionComponents, ...canvasKitComponents };
export const canvasAskHandlers = kindHandlers(COMPOSITION_KINDS);
// The schemas of the meta the canvas reads, for whoever uses it to register.
export { CANVAS_META, canvasMetaSchemas } from "./layout.js";

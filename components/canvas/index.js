// A canvas of components and shapes: an SVG with each item in a <foreignObject>, so the other
// demos' HTML components live at a point of the canvas, and lines, arrows, rectangles, ellipses
// and text drawn between them. With the hole tool, clicking the canvas puts a Hole there, the
// empty slot of the studio's layouts: its + lists what it can become, and picking one swaps the
// hole for that component. Every item has a header to drag it by, collapse it or remove it, and
// a corner to resize it by.
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
	each,
	field,
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
import { Arrow, Text } from "./shapes.js";

const { button, div, foreignObject, g, header, input, li, p, rect, span, svg, ul } = tag;

// What a hole can become: the notebook's kinds, and a canvas inside this one.
export const HOLE_KINDS = {
	...KINDS,
	canvas: ["Canvas", "🖼️", "A canvas of its own, inside this one."],
};
const KIND_NAMES = Object.keys(HOLE_KINDS);
const GROUP_IDS = GROUPS.map((g) => g.id);
// How wide an item is, by what it holds.
const WIDTHS = {
	Hole: 240,
	Notes: 320,
	TodoApp: 760,
	Board: 720,
	Drawing: 760,
	TrackerCell: 380,
	Notebook: 560,
	Canvas: 720,
};
// Taller than any item: the foreignObject's height, which the pointer goes through.
const ROOM = 4000;

const choice = (id, action, label) => li(button({ "data-choice": id, "on:click": action }, label));

// An empty slot: + lists what it can become, picking one asks the canvas to make it.
export const Hole = component({
	name: "Hole",
	fields: { step: t.enum("closed", "kind", "tracker").sync("none") },
	queries: {
		get isClosed() {
			return this.step === "closed";
		},
		get isPickingKind() {
			return this.step === "kind";
		},
	},
	view: div(
		{
			class:
				"flex min-h-24 items-center justify-center rounded-box border-2 border-dashed border-primary/60 bg-base-100/60 p-2",
		},
		$if(
			field("isClosed"),
			button(
				{
					class: "btn btn-circle btn-ghost btn-sm text-lg",
					title: "Put a component here",
					"on:click": send("open"),
				},
				"+",
			),
			div(
				{ class: "flex w-full flex-col items-stretch gap-1" },
				$if(
					field("isPickingKind"),
					ul(
						{ class: "choices menu menu-sm w-full rounded-box border border-base-300 bg-base-100" },
						Object.entries(HOLE_KINDS).map(([kind, [label, emoji]]) =>
							choice(kind, send("pick", kind), `${emoji} ${label}`),
						),
					),
					ul(
						{
							class:
								"choices menu menu-sm max-h-64 w-full flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100",
						},
						GROUPS.map(({ id, emoji, title }) =>
							choice(id, send("pickGroup", id), `${emoji} ${title}`),
						),
					),
				),
				button({ class: "btn btn-ghost btn-xs", "on:click": send("close") }, "cancel"),
			),
		),
	),
	on: {
		open(next) {
			next.step = "kind";
		},
		close(next) {
			next.step = "closed";
		},
		pick: {
			args: [t.enum(...KIND_NAMES)],
			emits: { notify: ["become"] },
			run(next, [kind], ctx) {
				if (kind === "tracker") next.step = "tracker";
				else ctx.notify("become", [kind, null]);
			},
		},
		pickGroup: {
			args: [t.enum(...GROUP_IDS)],
			emits: { notify: ["become"] },
			run(_next, [group], ctx) {
				ctx.notify("become", ["tracker", group]);
			},
		},
	},
});

// The label in an item's header, by what it holds.
const LABELS = {
	Hole: "Empty",
	Notes: "📝 Notes",
	TodoApp: "✅ Todos",
	Board: "🗂️ Kanban board",
	Drawing: "🎨 Drawing",
	Notebook: "📓 Notebook",
	Canvas: "🖼️ Canvas",
};
const MIN_WIDTH = 160;
const MIN_HEIGHT = 80;

// One component on the canvas, at x, y: a header to drag it by, collapse it or remove it, and
// a corner to resize it by. Its height is its content's until it's resized (0).
export const Item = component({
	name: "Item",
	fields: {
		content: t.component(),
		x: coord(),
		y: coord(),
		width: t.number().int().min(MIN_WIDTH).max(4000).default(WIDTHS.Hole),
		height: t.number().int().min(0).max(4000),
		collapsed: t.boolean(),
	},
	queries: {
		get label() {
			const { name } = specOf(this.content);
			if (name === "TrackerCell") return `📈 ${this.content.section.title}`;
			return LABELS[name] ?? name;
		},
		get isOpen() {
			return !this.collapsed;
		},
		get chevron() {
			return this.collapsed ? "▸" : "▾";
		},
		// Resized, the card keeps its height and its content scrolls; collapsed, it's the header.
		get cardStyle() {
			const height = this.height === 0 || this.collapsed ? "" : `height:${this.height}px;`;
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
				class:
					"canvas-card relative flex flex-col rounded-box border border-base-300 bg-base-100 shadow-md",
				style: field("cardStyle"),
			},
			header(
				{
					class:
						"flex shrink-0 cursor-grab items-center gap-1 rounded-t-box border-b border-base-300 bg-base-200 px-2 py-1 select-none active:cursor-grabbing",
					style: "touch-action:none",
					title: "Drag to move",
					"on:pointerdown": send("grab"),
				},
				span({ class: "opacity-40", "aria-hidden": "true" }, "⠿"),
				button(
					{
						class: "btn btn-ghost btn-xs w-6 px-0",
						title: "Collapse or expand",
						"aria-expanded": $if(field("isOpen"), "true", "false"),
						"on:click": send("toggle"),
					},
					field("chevron"),
				),
				span({ class: "flex-1 truncate text-xs font-bold opacity-60" }, field("label")),
				button({ class: "btn btn-ghost btn-xs", title: "Remove", "on:click": send("remove") }, "✕"),
			),
			$if(
				field("isOpen"),
				div({ class: "min-h-0 flex-1 overflow-auto p-3" }, render(field("content"))),
				"",
			),
			div({
				class:
					"absolute right-0 bottom-0 size-4 cursor-nwse-resize rounded-br-box opacity-50 hover:opacity-100",
				style:
					"touch-action:none;background:linear-gradient(135deg,transparent 50%,currentColor 50% 60%,transparent 60% 70%,currentColor 70% 80%,transparent 80%)",
				title: "Drag to resize",
				"on:pointerdown": send("grabCorner"),
			}),
		),
	),
	on: {
		toggle(next) {
			next.collapsed = !this.collapsed;
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
		// Its content becomes content, as wide as that needs and as tall as it is.
		setContent: {
			pure: true,
			args: [t.component()],
			run(next, [content]) {
				next.content = content;
				next.width = WIDTHS[specOf(content).name] ?? this.width;
				next.height = 0;
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeItem"] },
			run(_next, _args, ctx) {
				ctx.notify("removeItem");
			},
		},
		// The header pressed, not one of its buttons: the canvas picks the item up.
		grab: {
			args: [],
			emits: { notify: ["pickUp"] },
			run(_next, _args, ctx) {
				// Checked before pressPoint captures the pointer: a captured press never clicks.
				if (ctx.event?.target?.closest?.("button")) return;
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
		become: { args: [t.enum(...KIND_NAMES), t.option(t.enum(...GROUP_IDS))], run() {} },
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
	fields: {
		width: t.number().int().min(200).max(10000).default(2400),
		height: t.number().int().min(200).max(10000).default(1600),
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
			return `${tool} · drag an item by its header, resize it by its corner`;
		},
	},
	view: div(
		{
			class: "flex flex-col gap-2 outline-none",
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
		),
		p({ class: "text-xs opacity-60" }, field("hint")),
		div(
			{ class: "max-h-[75vh] overflow-auto rounded-box border border-base-300 bg-base-200" },
			svg(
				{
					class: "block",
					viewBox: field("viewBox"),
					width: field("width"),
					height: field("height"),
					style:
						"background-image:radial-gradient(circle,rgb(0 0 0 / 0.15) 1px,transparent 1px);background-size:24px 24px",
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
		removeItem: {
			args: [],
			sourceKey: t.index("items"),
			run(next, _args, ctx) {
				ctx.stopNext();
				delete next.items[ctx.sourceKey];
				next.order = this.order.filter((k) => k !== ctx.sourceKey);
				if (this.dragKey === ctx.sourceKey) next.drag = "none";
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
		// From the hole of the item at ctx.sourceKey: it becomes kind.
		become: {
			args: [t.enum(...KIND_NAMES), t.option(t.enum(...GROUP_IDS))],
			sourceKey: t.index("items"),
			run(next, [kind, group], ctx) {
				ctx.stopNext();
				const C = ctx.scope.components;
				const content =
					kind === "canvas"
						? C.Canvas({ width: 1200, height: 800 })
						: makeContent(C, kind, {
								group: group ?? undefined,
								now: ctx.now(),
								tz: -new Date(ctx.now()).getTimezoneOffset(),
								uuid: () => ctx.uuid(),
							});
				next.items[ctx.sourceKey] = apply(next.items[ctx.sourceKey], "setContent", content);
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
	} else if (self.drag === "resize") {
		const item = self.items[key];
		if (item !== undefined)
			next.items[key] = apply(item, "resizeTo", x - self.grabX, y - self.grabY);
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
export const canvas = (C, items = [], fields = {}) => {
	const order = items.map((_, i) => `item-${i + 1}`);
	return C.Canvas({
		...fields,
		order,
		items: Object.fromEntries(
			items.map(([x, y, content], i) => {
				const width = WIDTHS[specOf(content).name];
				return [order[i], C.Item({ x, y, content, ...(width ? { width } : {}) })];
			}),
		),
	});
};

export const canvasComponents = { ...compositionComponents, Canvas, Item, Hole, Arrow, Text };

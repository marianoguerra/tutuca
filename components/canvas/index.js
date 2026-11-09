// A canvas of components and shapes: an SVG with each item in a <foreignObject>, so the other
// demos' HTML components live at a point of the canvas, and lines, arrows, rectangles, ellipses
// and text drawn between them. With the hole tool, clicking the canvas puts a Hole there, the
// empty slot of the studio's layouts: its + lists what it can become, and picking one swaps the
// hole for that component, maybe one of the layouts (layout.js) holding holes of their own.
// What a hole can become is up to the host: it asks (see layout.js), and kindHandlers(kinds)
// answers for a table of kinds; canvasComponents and canvasAskHandlers are the notebook's.
// Every item (item.js) has a chrome, shown while the pointer is over it: a header to drag it by, collapse
// it, toggle editing it, clone it or remove it, and a corner to resize it by. Editing pushes the edit view
// above its content, so a layout in it (and every layout in that) shows what edits it. A content
// that says what its data is (DATA_META) can be downloaded as JSON from the header, and a JSON
// file dropped on it is loaded into it.
//
// A foreignObject doesn't size to its content, so each one is as wide as its item and taller
// than any of them, and lets the pointer through (pointer-events none) where its card isn't;
// the card takes it back. A drag (moving or resizing an item, moving a shape, drawing one)
// captures the pointer on the canvas's svg, so the moves and the release reach the canvas
// wherever the pointer goes, and the components inside never see them.

import { AGENT_META } from "../../src/meta/index.js";
import {
	$if,
	apply,
	component,
	copy,
	each,
	errorMessage,
	field,
	render,
	renderEach,
	send,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { agent, agentComponents } from "../agent/index.js";
import { setField } from "../common/card.js";
import { metaFor } from "../common/meta.js";
import { clamp, isModKey, mix } from "../common/util.js";
import { compositionComponents, GROUPS, KINDS, makeContent } from "../composition/index.js";
import { capture, coord, paintType, svgPoint } from "../drawing/shapes.js";
import { swatchStyle, TOOL_OFF, TOOL_ON, toolButton, toolButtons } from "../drawing/tools.js";
import { transcriptComponents } from "../llm/transcript.js";
import { markdownComponents } from "../markdown/index.js";
import { ASSISTANT, agentBusy, assistantQueries, passModel } from "./assistant.js";
import { afterRender, HOLE_WIDTH, Item, MAX_AUTO_HEIGHT, MIN_HEIGHT, MIN_WIDTH } from "./item.js";
import {
	BECOME_ARGS,
	canvasMetaOf,
	kindEnv,
	kindHandlers,
	kindLook,
	kindType,
	layoutComponents,
	metaLabel,
	withBuiltins,
} from "./layout.js";
import { Arrow, Text } from "./shapes.js";

const { button, div, g, input, p, rect, span, svg } = tag;

// How far the canvas reaches past what's on it, growing as items are moved or resized there.
const GROW_MARGIN = 400;
// How far down and right of its item a clone goes.
const CLONE_OFFSET = 24;
const MAX_SIZE = 10000;
// How far the canvas zooms out and in, and how much each step does.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

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
// What its agent draws with: shapes by id.
const newShapeId = (ctx) => `s-${ctx.uuid()}`;
const shapeAt = (self, id) => self.shapes.findIndex((s) => s.id === id);
const hasShape = (self, id) => shapeAt(self, id) !== -1;
const noShape = (_self, [id]) => `there's no shape ${id}`;
const widthType = () => t.enum(2, 1, 4, 8);
const growToShape = (self, next, s) => growTo(self, next, s.left + s.boxWidth, s.top + s.boxHeight);

// Whether a tool draws a shape: the ones the ✏ button shows and hides.
const isDrawingTool = (tool) => TOOLS.find(([id]) => id === tool)?.[3] != null;
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
const ON = TOOL_ON;
const OFF = TOOL_OFF;
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
	meta: metaFor(
		"Canvas",
		"🖼️",
		"Components and the shapes drawn between them, laid out on an SVG canvas.",
		720,
		{
			[AGENT_META]: ASSISTANT,
		},
	),
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
		// Whether the drawing tools, fill and stroke show: picking one shows them, picking the
		// hole or select tool hides them, and the ✏ button toggles them.
		drawing: t.boolean().sync("local"),
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
		// Whether the host has a model to ask, so its items' components can be wrapped in
		// agents: the answer to inferenceAvailable, asked once the canvas starts (checkInference).
		agentsAvailable: t.boolean().sync("none"),
		// What its items can be, as the host's componentKinds answers, asked with
		// inferenceAvailable: what its agent lists and makes.
		kinds: t.array(kindType).sync("none"),
		// For its agent: where add_component puts what it asked for while it's made, the item it
		// added last or why it couldn't, and the item it prompted last.
		placing: t.any(null).sync("none"),
		added: t.string().sync("none"),
		problem: t.string().sync("none"),
		delegated: t.string().sync("none"),
		// The model the agent driving it uses ("" when none does), which the agents it gives its
		// items use too, unless one was picked for them.
		agentModel: t.string().sync("none"),
	},
	provides: {
		agentsAvailable(b) {
			b.field("agentsAvailable");
		},
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
	queries: mix(assistantQueries, {
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
		// The drawing tools show while drawing is on or one of them is picked.
		get showsDrawing() {
			return this.drawing || isDrawingTool(this.tool);
		},
		get toolButtons() {
			return TOOLS.filter(([id]) => !isDrawingTool(id) || this.showsDrawing).map((tool) =>
				toolButton(tool, this.tool),
			);
		},
		get drawingClass() {
			return this.showsDrawing ? ON : OFF;
		},
		get drawingLabel() {
			return this.showsDrawing ? "Hide the drawing tools" : "Draw: lines, arrows, shapes and text";
		},
		// Deleting a shape goes with selecting it or drawing it.
		get showDelete() {
			return this.showsDrawing || this.tool === "select";
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
	}),
	view: div(
		{
			// As tall as the window, or as what holds it when that's shorter (an agent's column):
			// the viewport takes what the toolbar leaves, and scrolls.
			class: "canvas-root flex h-[calc(100dvh-1rem)] max-h-full flex-col gap-2 outline-none",
			tabindex: "0",
			"on:keydown": send("key"),
		},
		div(
			{ class: "flex flex-wrap items-center gap-3" },
			div(
				{ class: "join", role: "toolbar", "aria-label": "Tools" },
				toolButtons(),
				button(
					{
						class: field("drawingClass"),
						title: field("drawingLabel"),
						"aria-label": field("drawingLabel"),
						"aria-pressed": $if(field("showsDrawing"), "true", "false"),
						"on:click": send("toggleDrawing"),
					},
					"✏",
				),
			),
			$if(
				field("showsDrawing"),
				div(
					{ class: "flex flex-wrap items-center gap-3" },
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
				),
				"",
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
			$if(
				field("showDelete"),
				button(
					{
						class: "btn btn-sm",
						disabled: field("noSelection"),
						title: "Delete the selected shape (Del)",
						"on:click": send("removeShape"),
					},
					"Delete",
				),
				"",
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
					"canvas-viewport min-h-0 flex-1 overflow-auto rounded-box border border-base-300 bg-base-200",
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
	answers: {
		componentKinds: {
			ok(next, [kinds]) {
				next.kinds = Array.isArray(kinds) ? kinds : [];
			},
			error(next) {
				next.kinds = [];
			},
			unhandled(next) {
				next.kinds = [];
			},
		},
		// What add_component asked for, made: an item where it was asked to go, or after the rest.
		makeComponent: {
			ok(next, [{ content, label, width }], ctx) {
				const key = ctx.uuid();
				const C = ctx.scope.components;
				const w = width > 0 ? clamp(width, MIN_WIDTH, 4000) : HOLE_WIDTH;
				const { x, y } = placeFor(this, this.placing, w);
				next.items[key] = C.Item({ content, label, x, y, width: w });
				next.order.push(key);
				growTo(this, next, x + w, y + MIN_HEIGHT);
				next.placing = null;
				next.added = `${key} (${label})`;
				next.problem = "";
			},
			error(next, [error]) {
				next.placing = null;
				next.problem = errorMessage(error);
			},
			unhandled(next) {
				next.placing = null;
				next.problem = "this page can't make components";
			},
		},
		inferenceAvailable: {
			ok(next, [available]) {
				next.agentsAvailable = available === true;
			},
			error(next) {
				next.agentsAvailable = false;
			},
			unhandled(next) {
				next.agentsAvailable = false;
			},
		},
	},
	on: {
		// Asks the host whether it has a model to ask.
		checkInference: {
			args: [],
			emits: { ask: ["inferenceAvailable", "componentKinds"] },
			run(_next, _args, ctx) {
				ctx.ask("inferenceAvailable");
				ctx.ask("componentKinds");
			},
		},
		// Its agent's tools, by item key. A component of a kind, maybe one of its choices or
		// samples, at x, y (null: after what's there).
		add_component: {
			args: [t.string().len(1), t.option(t.string()), t.option(coord()), t.option(coord())],
			pre: (self, [kind]) => self.kinds.length === 0 || self.kinds.some((k) => k.id === kind),
			why: (self, [kind]) =>
				`there's no kind ${kind}; there are ${self.kinds.map((k) => k.id).join(", ")}`,
			emits: { ask: ["makeComponent"] },
			run(next, [kind, choice, x, y], ctx) {
				next.placing = { x, y };
				next.added = "";
				next.problem = "";
				ctx.ask("makeComponent", [kind, choice]);
			},
		},
		move_item: {
			pure: true,
			args: [t.string(), coord(), coord()],
			pre: (self, [key]) => key in self.items,
			why: (_self, [key]) => `there's no item ${key}`,
			run(next, [key, x, y]) {
				const item = this.items[key];
				next.items[key] = apply(item, "moveTo", x, y);
				growTo(this, next, x + item.width, y + (item.height || MIN_HEIGHT));
			},
		},
		resize_item: {
			pure: true,
			args: [t.string(), t.number().min(0), t.number().min(0)],
			pre: (self, [key]) => key in self.items,
			why: (_self, [key]) => `there's no item ${key}`,
			run(next, [key, width, height]) {
				const item = apply(this.items[key], "setSize", width, height);
				next.items[key] = item;
				growTo(this, next, item.x + item.width, item.y + (item.height || MIN_HEIGHT));
			},
		},
		set_title: {
			pure: true,
			args: [t.string(), t.string()],
			pre: (self, [key]) => key in self.items,
			why: (_self, [key]) => `there's no item ${key}`,
			run(next, [key, title]) {
				next.items[key] = apply(this.items[key], "setTitle", title);
			},
		},
		remove_item: {
			pure: true,
			args: [t.string()],
			pre: (self, [key]) => key in self.items && !agentBusy(self.items[key]),
			why: (self, [key]) =>
				key in self.items ? `${key}'s agent is busy` : `there's no item ${key}`,
			run(next, [key]) {
				delete next.items[key];
				next.order = this.order.filter((k) => k !== key);
				if (this.maximized === key) next.maximized = "";
			},
		},
		// Shapes by id, in canvas coordinates, colors as #rrggbb or none.
		add_shape: {
			args: [
				t.enum("rect", "ellipse", "line", "arrow"),
				coord(),
				coord(),
				coord(),
				coord(),
				paintType("none"),
				paintType("#1f2937"),
				widthType(),
			],
			run(next, [kind, x0, y0, x1, y1, fill, stroke, width], ctx) {
				const name = { rect: "Rect", ellipse: "Ellipse", line: "Line", arrow: "Arrow" }[kind];
				const shape = ctx.scope.make(name, {
					id: newShapeId(ctx),
					x0,
					y0,
					x1,
					y1,
					fill,
					stroke,
					width,
				});
				next.shapes.push(shape);
				growToShape(this, next, shape);
			},
		},
		add_text: {
			args: [coord(), coord(), t.string(), paintType("#1f2937")],
			run(next, [x, y, text, color], ctx) {
				const shape = ctx.scope.make("Text", { id: newShapeId(ctx), x, y, text, stroke: color });
				next.shapes.push(shape);
				growToShape(this, next, shape);
			},
		},
		set_text: {
			pure: true,
			args: [t.string(), t.string()],
			pre: (self, [id]) => {
				const shape = self.shapes[shapeAt(self, id)];
				return shape !== undefined && specOf(shape).name === "Text";
			},
			why: (self, [id]) => (hasShape(self, id) ? `${id} isn't a text` : `there's no shape ${id}`),
			run(next, [id, text]) {
				const i = shapeAt(this, id);
				next.shapes[i] = apply(this.shapes[i], "setText", text);
			},
		},
		move_shape: {
			pure: true,
			args: [t.string(), t.number(), t.number()],
			pre: (self, [id]) => hasShape(self, id),
			why: noShape,
			run(next, [id, dx, dy]) {
				const i = shapeAt(this, id);
				next.shapes[i] = apply(this.shapes[i], "moveBy", dx, dy);
				growToShape(this, next, next.shapes[i]);
			},
		},
		style_shape: {
			pure: true,
			args: [t.string(), paintType("none"), paintType("#1f2937"), widthType()],
			pre: (self, [id]) => hasShape(self, id),
			why: noShape,
			run(next, [id, fill, stroke, width]) {
				const i = shapeAt(this, id);
				next.shapes[i] = apply(this.shapes[i], "setStyle", fill, stroke, width);
			},
		},
		layer_shape: {
			pure: true,
			args: [t.string(), t.enum("front", "back", "up", "down")],
			pre: (self, [id]) => hasShape(self, id),
			why: noShape,
			run(next, [id, to]) {
				const i = shapeAt(this, id);
				const last = this.shapes.length - 1;
				const j = { front: last, back: 0, up: Math.min(i + 1, last), down: Math.max(i - 1, 0) }[to];
				const shapes = [...this.shapes];
				const [shape] = shapes.splice(i, 1);
				shapes.splice(j, 0, shape);
				next.shapes = shapes;
			},
		},
		remove_shape: {
			pure: true,
			args: [t.string()],
			pre: (self, [id]) => hasShape(self, id),
			why: noShape,
			run(next, [id]) {
				next.shapes = this.shapes.filter((s) => s.id !== id);
				if (this.selected === id) next.selected = "";
			},
		},
		clear_shapes: {
			pure: true,
			args: [],
			post: (_prev, next) => next.shapes.length === 0,
			run(next) {
				next.shapes = [];
				next.selected = "";
			},
		},
		// Its component in an agent of its own, which delegate prompts.
		enable_agent: {
			args: [t.string()],
			pre: (self, [key]) => self.items[key]?.canWrap === true,
			why: (self, [key]) => {
				const item = self.items[key];
				if (item === undefined) return `there's no item ${key}`;
				return item.isWrapped ? `${key} has an agent already` : `${key} can't have an agent`;
			},
			run(_next, [key], ctx) {
				ctx.sendAt("wrapInAgent", [], (s) => s.item("items", key));
				passModel(this, ctx, key);
			},
		},
		// Prompts the agent of the item at key; the tool answers once that agent is done.
		delegate: {
			args: [t.string(), t.string().len(1)],
			pre: (self, [key]) => self.items[key]?.isWrapped === true && !agentBusy(self.items[key]),
			why: (self, [key]) => {
				const item = self.items[key];
				if (item === undefined) return `there's no item ${key}`;
				return item.isWrapped
					? `${key}'s agent is busy`
					: `${key} has no agent: enable_agent first`;
			},
			run(next, [key, prompt], ctx) {
				next.delegated = key;
				passModel(this, ctx, key);
				ctx.sendAt("ask", [prompt], (s) => s.item("items", key).field("content"));
			},
		},
		// Its component back in its place, as its agent left it.
		eject_agent: {
			pure: true,
			args: [t.string()],
			pre: (self, [key]) => self.items[key]?.isWrapped === true && !agentBusy(self.items[key]),
			why: (self, [key]) => {
				const item = self.items[key];
				if (item === undefined) return `there's no item ${key}`;
				return item.isWrapped ? `${key}'s agent is busy` : `${key} has no agent`;
			},
			run(next, [key]) {
				next.items[key] = apply(this.items[key], "ejectAgent");
			},
		},
		// From the agent driving it: the model it uses, for its items' agents.
		useModel: setField("agentModel", t.string().len(1), { pure: true }),
		// What holds it stopped: so do its items' agents.
		stopAgents(_next, _args, ctx) {
			for (const key of this.order) {
				if (agentBusy(this.items[key])) {
					ctx.sendAt("stop", [], (s) => s.item("items", key).field("content"));
				}
			}
		},
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
			if (!isModKey(e)) return;
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
				next.drawing = isDrawingTool(tool);
				next.selected = ""; // So paint picked for the new tool leaves the last shape as it is.
				next.current = null;
				next.drag = "none";
			},
		},
		// Shows the drawing tools, or hides them, leaving a drawing tool for select.
		toggleDrawing(next) {
			next.drawing = !this.showsDrawing;
			if (!next.drawing && isDrawingTool(this.tool)) next.tool = "select";
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
			if (!e || e.defaultPrevented || typing(e.target) || isModKey(e) || e.altKey) return;
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
		// From an item whose chrome was pressed: it comes to the front, over the others (nothing
		// changes when it's there already).
		raiseItem: {
			args: [],
			sourceKey: t.index("items"),
			run(next, _args, ctx) {
				ctx.stopNext(); // A canvas in an item raises its own items, not the outer ones.
				if (this.order.at(-1) !== ctx.sourceKey) {
					next.order = [...this.order.filter((k) => k !== ctx.sourceKey), ctx.sourceKey];
				}
			},
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
	const style = { id: newShapeId(ctx), fill: self.fill, stroke: self.stroke };
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

// Where add_component puts what's made width wide: where it was asked to, or after the items,
// on the top row.
const placeFor = (self, placing, width) => {
	const gap = 24;
	const right = self.order.reduce((m, k) => Math.max(m, self.items[k].x + self.items[k].width), 0);
	const x = placing?.x ?? (self.order.length === 0 ? 40 : right + gap);
	const y = placing?.y ?? 40;
	return { x: clamp(x, 0, MAX_SIZE - width), y: clamp(y, 0, MAX_SIZE - MIN_HEIGHT) };
};

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

// A canvas with an agent beside it, which makes, places and drives its components, through
// the canvas's agent meta: what holds the agent and the canvas both.
export const withAssistant = (C, canvasValue) =>
	agent(C, { target: canvasValue, canChange: false, layout: "side" });

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

// The canvas's own components: its items, shapes, holes, layouts and markdown documents.
// Whoever uses it registers these, the components its holes' kinds make, and kindHandlers(kinds)
// to answer the holes.
// The agent a component that says agent meta can be wrapped in comes with the canvas.
export const canvasKitComponents = {
	...layoutComponents,
	...markdownComponents,
	...agentComponents,
	...transcriptComponents,
	Canvas,
	Item,
	Arrow,
	Text,
};
// The notebook's components on a canvas, and the handlers for its kinds.
export const canvasComponents = { ...compositionComponents, ...canvasKitComponents };
export const canvasAskHandlers = kindHandlers(COMPOSITION_KINDS);
// The schemas of the meta the canvas reads, for whoever uses it to register.
export { CANVAS_META, canvasMetaSchemas } from "./layout.js";

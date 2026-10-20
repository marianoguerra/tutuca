// A small vector drawing editor in SVG, simple like MS Paint and vector like Inkscape:
// rectangle, ellipse, line and polyline tools, a select tool to pick and move shapes, raise,
// lower, duplicate and delete, fill and stroke from a palette (click for fill, right click
// for stroke), stroke widths, undo and redo, and export as an .svg file. Pointer events turn
// into messages with coordinates (startAt, moveTo, end), so drawing can be scripted and tested.

import {
	$if,
	button,
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
import {
	COORD_MAX,
	capture,
	coord,
	Ellipse,
	isPaint,
	Line,
	PALETTE,
	Polyline,
	paintType,
	Rect,
	svgPoint,
} from "./shapes.js";

const { div, g, rect, span } = tag;

export const svg = tag.svg;
export const SHAPES = ["Rect", "Ellipse", "Line", "Polyline"];
const TOOLS = [
	["select", "⬉", "Select and move (S)", null],
	["rect", "▭", "Rectangle (R)", "Rect"],
	["ellipse", "◯", "Ellipse (E)", "Ellipse"],
	["line", "╱", "Line (L)", "Line"],
	["polyline", "⌇", "Polyline: click points, double click or Enter to finish (P)", "Polyline"],
];
const TOOL_KEYS = { s: "select", r: "rect", e: "ellipse", l: "line", p: "polyline" };
const MAX_HISTORY = 50;
const ON = "btn btn-sm btn-square btn-primary join-item";
const OFF = "btn btn-sm btn-square join-item";
const NONE_STYLE = "background:repeating-linear-gradient(45deg,#fff 0 4px,#ed1c24 4px 6px)";
const swatchStyle = (paint) => (paint === "none" ? NONE_STYLE : `background:${paint}`);

// Every change to the shapes goes through here, so it can be undone.
const remember = (self, draft) => {
	draft.past = [...self.past.slice(-(MAX_HISTORY - 1)), self.shapes];
	draft.future = [];
};
const newId = (ctx) => `s-${ctx.uuid()}`;

export const Drawing = component({
	name: "Drawing",
	fields: {
		width: t.number(640).int().min(16).max(4000),
		height: t.number(400).int().min(16).max(4000),
		tool: t.enum(...TOOLS.map(([id]) => id)).sync("local"),
		fill: paintType("#99d9ea"), // For new shapes, and the selected one.
		stroke: paintType("#000000"),
		strokeWidth: t.enum(2, 1, 4, 8),
		shapes: t.array(t.component(SHAPES)),
		selected: t.string().sync("none"), // The selected shape's id, or "".
		current: t.option(t.component(SHAPES)).sync("none"), // The shape being drawn.
		dragFrom: t.option(t.array(coord()).len(2, 2)).sync("none"), // Where moving the selection was last.
		past: t
			.array(t.array(t.component(SHAPES)))
			.len(0, MAX_HISTORY)
			.sync("none"), // Undo stays per tab.
		future: t.array(t.array(t.component(SHAPES))).sync("none"),
		cursor: t.string().sync("none"),
	},
	invariants: {
		uniqueIds() {
			return hasUniqueIds(this.shapes);
		},
		// Undo and redo bring snapshots back as the shapes.
		uniqueIdsInHistory() {
			return this.past.every(hasUniqueIds) && this.future.every(hasUniqueIds);
		},
		// The shape being drawn is committed as a new one, also after undo or redo.
		currentIsNew() {
			if (this.current === null) return true;
			const { id } = this.current;
			const snapshots = [this.shapes, ...this.past, ...this.future];
			return !snapshots.some((shapes) => shapes.some((s) => s.id === id));
		},
		// Only a drawing tool draws, and only its kind of shape.
		currentMatchesTool() {
			const kind = TOOLS.find(([id]) => id === this.tool)[3];
			return this.current === null || specOf(this.current).name === kind;
		},
		// Its points so far, then the one that follows the pointer.
		drawnPolylineHasPointer() {
			return this.current?.points === undefined || this.current.points.length >= 4;
		},
		selectionExists() {
			return this.selected === "" || this.shapes.some((s) => s.id === this.selected);
		},
	},
	methods: {
		get viewBox() {
			return `0 0 ${this.width} ${this.height}`;
		},
		get selectedIndex() {
			return this.shapes.findIndex((s) => s.id === this.selected);
		},
		get selection() {
			return this.shapes[this.selectedIndex] ?? null;
		},
		get hasSelection() {
			return this.selection !== null;
		},
		get noSelection() {
			return !this.hasSelection;
		},
		// The selection's box, with a margin so it doesn't hide thin shapes.
		get selectionBox() {
			const s = this.selection;
			if (s === null) return { x: 0, y: 0, w: 0, h: 0 };
			const m = s.width / 2 + 4;
			return { x: s.left - m, y: s.top - m, w: s.boxWidth + 2 * m, h: s.boxHeight + 2 * m };
		},
		get selX() {
			return this.selectionBox.x;
		},
		get selY() {
			return this.selectionBox.y;
		},
		get selW() {
			return this.selectionBox.w;
		},
		get selH() {
			return this.selectionBox.h;
		},
		get toolButtons() {
			return TOOLS.map(([id, icon, label]) => ({
				id,
				icon,
				label,
				cls: id === this.tool ? ON : OFF,
			}));
		},
		get widthButtons() {
			return [1, 2, 4, 8].map((w) => ({
				value: String(w),
				label: `${w}px stroke`,
				cls: w === this.strokeWidth ? ON : OFF,
				bar: `display:block;width:1.2rem;background:currentColor;height:${w}px`,
			}));
		},
		get swatches() {
			return ["none", ...PALETTE].map((p) => ({
				paint: p,
				style: swatchStyle(p),
				label: `${p}: click for fill, right click for stroke`,
			}));
		},
		get fillStyle() {
			return swatchStyle(this.fill);
		},
		get strokeStyle() {
			return swatchStyle(this.stroke);
		},
		get cannotUndo() {
			return this.past.length === 0;
		},
		get cannotRedo() {
			return this.future.length === 0;
		},
		get hasCurrent() {
			return this.current !== null;
		},
		get canvasStyle() {
			return `cursor:${this.tool === "select" ? "default" : "crosshair"};touch-action:none;background:#ffffff;height:auto`; // Scales with its width.
		},
		get status() {
			const s = this.selection;
			const what =
				s === null
					? TOOLS.find(([id]) => id === this.tool)[2]
							.split(/[:(]/)[0]
							.trim()
					: `${s.id} selected`;
			const where = this.cursor === "" ? "" : ` · ${this.cursor}`;
			return `${what} · ${this.shapes.length} ${this.shapes.length === 1 ? "shape" : "shapes"}${where}`;
		},
		// The drawing as a standalone SVG document.
		toSvg() {
			const body = this.shapes.map((s) => `  ${s.toSvg()}\n`).join("");
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${this.viewBox}" width="${this.width}" height="${this.height}">\n${body}</svg>\n`;
		},
	},
	loops: {
		shapes: {
			key(_index, shape) {
				return shape.id;
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-2 select-none" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
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
			div(
				{ class: "join", role: "group", "aria-label": "Stroke width" },
				each(
					field("widthButtons"),
					button(
						{
							class: field("cls"),
							title: field("label"),
							value: field("value"),
							"on:click": send("setWidth", targetValue()),
						},
						span({ style: field("bar") }),
					),
				),
			),
			div(
				{ class: "join", role: "group", "aria-label": "Selection" },
				button(
					{
						class: "btn btn-sm join-item",
						disabled: field("noSelection"),
						title: "Raise (Page Up)",
						"on:click": send("raise"),
					},
					"Raise",
				),
				button(
					{
						class: "btn btn-sm join-item",
						disabled: field("noSelection"),
						title: "Lower (Page Down)",
						"on:click": send("lower"),
					},
					"Lower",
				),
				button(
					{
						class: "btn btn-sm join-item",
						disabled: field("noSelection"),
						title: "Duplicate (Ctrl+D)",
						"on:click": send("duplicate"),
					},
					"Duplicate",
				),
				button(
					{
						class: "btn btn-sm join-item",
						disabled: field("noSelection"),
						title: "Delete (Del)",
						"on:click": send("remove"),
					},
					"Delete",
				),
			),
			div(
				{ class: "join" },
				button(
					{
						class: "btn btn-sm join-item",
						disabled: field("cannotUndo"),
						title: "Undo (Ctrl+Z)",
						"on:click": send("undo"),
					},
					"↶",
				),
				button(
					{
						class: "btn btn-sm join-item",
						disabled: field("cannotRedo"),
						title: "Redo (Ctrl+Y)",
						"on:click": send("redo"),
					},
					"↷",
				),
			),
			button({ class: "btn btn-sm", "on:click": send("clear") }, "New"),
			button({ class: "btn btn-sm", "on:click": send("exportSvg") }, "Save .svg"),
		),
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			div(
				{ class: "flex items-center gap-1 text-xs", title: "Fill and stroke" },
				"Fill",
				span({ class: "size-5 border border-base-content/40", style: field("fillStyle") }),
				"Stroke",
				span({ class: "size-5 border border-base-content/40", style: field("strokeStyle") }),
			),
			div(
				{ class: "flex flex-wrap gap-0.5" },
				each(
					field("swatches"),
					button({
						class: "size-5 border border-base-content/30",
						style: field("style"),
						title: field("label"),
						"aria-label": field("paint"),
						value: field("paint"),
						"on:click": send("setFill", targetValue()),
						"on:contextmenu": send("setStroke", targetValue()),
					}),
				),
			),
		),
		div(
			{
				class: "overflow-auto rounded border border-base-300 bg-base-300 p-2 outline-none",
				tabindex: "0",
				"on:keydown": send("key"),
			},
			svg(
				{
					class: "block max-w-full shadow",
					viewBox: field("viewBox"),
					width: field("width"),
					height: field("height"),
					style: field("canvasStyle"),
					role: "img",
					"aria-label": "Drawing canvas",
					"on:pointerdown": send("down"),
					"on:pointermove": send("move"),
					"on:pointerup": send("up"),
					"on:pointercancel": send("up"),
					"on:dblclick": send("finish"),
				},
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
						stroke: "#3f48cc",
						"stroke-width": "1",
						"stroke-dasharray": "4 3",
						"pointer-events": "none",
					}),
					"",
				),
			),
		),
		div({ class: "px-1 text-xs tabular-nums opacity-70", "aria-live": "polite" }, field("status")),
	),
	on: {
		setTool: {
			args: [t.string()],
			run(draft, [tool]) {
				if (!TOOLS.some(([id]) => id === tool)) return;
				draft.tool = tool;
				draft.current = null;
				if (tool !== "select") draft.selected = "";
			},
		},
		setWidth: {
			args: [t.string()],
			run(draft, [width]) {
				const w = Number(width);
				if (![1, 2, 4, 8].includes(w)) return;
				draft.strokeWidth = w;
				restyle(this, draft, { width: w });
			},
		},
		setFill: {
			args: [t.string()],
			run(draft, [p]) {
				if (!isPaint(p)) return;
				draft.fill = p;
				restyle(this, draft, { fill: p });
			},
		},
		// A right click on a swatch, as Inkscape's shift click.
		setStroke: {
			args: [t.string()],
			run(draft, [p], ctx) {
				ctx.event?.preventDefault();
				if (!isPaint(p)) return;
				draft.stroke = p;
				restyle(this, draft, { stroke: p });
			},
		},
		// Drawing, by coordinates.
		startAt: {
			args: [coord(), coord()],
			run(draft, [x, y], ctx) {
				if (this.tool === "select") {
					draft.selected = "";
					return;
				}
				// A polyline being drawn takes another point; its last one follows the pointer.
				if (this.current !== null && this.tool === "polyline") {
					draft.current.addPoint(x, y);
					return;
				}
				const kind = TOOLS.find(([id]) => id === this.tool)[3];
				const style = {
					fill: kind === "Line" ? "none" : this.fill,
					stroke: this.stroke,
					width: this.strokeWidth,
				};
				const shape =
					kind === "Polyline" ? { points: [x, y, x, y] } : { x0: x, y0: y, x1: x, y1: y };
				draft.current = ctx.scope.make(kind, { id: newId(ctx), ...style, ...shape });
			},
		},
		moveTo: {
			args: [coord(), coord()],
			run(draft, [x, y]) {
				draft.cursor = `${Math.round(x)}, ${Math.round(y)}`;
				if (draft.current !== null) draft.current.dragTo(x, y);
				else if (this.dragFrom !== null && this.selection !== null) {
					const [x0, y0] = this.dragFrom;
					draft.shapes[this.selectedIndex].moveBy(x - x0, y - y0);
					draft.dragFrom = [x, y];
				}
			},
		},
		// Ends a drag; a polyline goes on until finish.
		end: {
			args: [],
			run(draft) {
				draft.dragFrom = null;
				if (this.current === null || this.tool === "polyline") return;
				commit(this, draft, this.current);
			},
		},
		finish: {
			args: [],
			post: (_prev, next) => next.current === null,
			run(draft, _args, ctx) {
				const shape = this.current;
				if (shape === null) return;
				if (shape.points === undefined) {
					commit(this, draft, shape);
					return;
				}
				// Without the point following the pointer, and the repeats a double click adds.
				const points = shape.points.slice(0, -2);
				const kept = [];
				for (let i = 0; i < points.length; i += 2) {
					if (kept.at(-2) !== points[i] || kept.at(-1) !== points[i + 1])
						kept.push(points[i], points[i + 1]);
				}
				commit(this, draft, ctx.scope.make("Polyline", { ...shape, points: kept }));
			},
		},
		cancel: {
			args: [],
			run(draft) {
				draft.current = null;
				draft.dragFrom = null;
				draft.selected = "";
			},
		},
		// Pointer events, turned into the messages above.
		down(draft, _args, ctx) {
			const point = svgPoint(ctx.event);
			if (point === null || ctx.event.button > 0) return;
			capture(ctx.event);
			Drawing.on.startAt.run.call(this, draft, point, ctx);
		},
		move(draft, _args, ctx) {
			const point = svgPoint(ctx.event);
			if (point !== null) Drawing.on.moveTo.run.call(this, draft, point, ctx);
		},
		up(draft, _args, ctx) {
			Drawing.on.end.run.call(this, draft, [], ctx);
		},
		// From a pressed shape: the select tool picks it up, the others draw over it.
		shapeDown: {
			args: [t.string(), coord(), coord()],
			run(draft, [id, x, y], ctx) {
				ctx.stopNext();
				if (this.tool !== "select") {
					Drawing.on.startAt.run.call(this, draft, [x, y], ctx);
					return;
				}
				if (!this.shapes.some((s) => s.id === id)) return;
				remember(this, draft); // So moving it can be undone.
				draft.selected = id;
				draft.dragFrom = [x, y];
			},
		},
		shapeMove: {
			args: [coord(), coord()],
			run(draft, point, ctx) {
				ctx.stopNext();
				Drawing.on.moveTo.run.call(this, draft, point, ctx);
			},
		},
		shapeUp: {
			args: [],
			run(draft, _args, ctx) {
				ctx.stopNext();
				Drawing.on.end.run.call(this, draft, [], ctx);
			},
		},
		raise: {
			args: [],
			run(draft) {
				const i = this.selectedIndex;
				if (i < 0 || i === this.shapes.length - 1) return;
				remember(this, draft);
				[draft.shapes[i], draft.shapes[i + 1]] = [this.shapes[i + 1], this.shapes[i]];
			},
		},
		lower: {
			args: [],
			run(draft) {
				const i = this.selectedIndex;
				if (i <= 0) return;
				remember(this, draft);
				[draft.shapes[i - 1], draft.shapes[i]] = [this.shapes[i], this.shapes[i - 1]];
			},
		},
		// A copy a little down and right, above the original, which becomes the selection.
		duplicate: {
			args: [],
			run(draft, _args, ctx) {
				const s = this.selection;
				if (s === null) return;
				remember(this, draft);
				const copy = ctx.scope.make(specOf(s).name, { ...s, id: newId(ctx) });
				const at = this.selectedIndex + 1;
				draft.shapes.splice(at, 0, copy);
				// Toward the side with room, so a copy at the edge still shows apart.
				const nudge = (far) => (far + 10 <= COORD_MAX ? 10 : -10);
				draft.shapes[at].moveBy(nudge(s.left + s.boxWidth), nudge(s.top + s.boxHeight));
				draft.selected = copy.id;
			},
		},
		remove: {
			args: [],
			run(draft) {
				const i = this.selectedIndex;
				if (i < 0) return;
				remember(this, draft);
				draft.shapes.splice(i, 1);
				draft.selected = "";
			},
		},
		undo: {
			args: [],
			run(draft) {
				if (this.past.length === 0) return;
				draft.future = [this.shapes, ...this.future];
				draft.shapes = this.past.at(-1);
				draft.past = this.past.slice(0, -1);
				deselectMissing(draft);
			},
		},
		redo: {
			args: [],
			run(draft) {
				if (this.future.length === 0) return;
				draft.past = [...this.past.slice(-(MAX_HISTORY - 1)), this.shapes];
				draft.shapes = this.future[0];
				draft.future = this.future.slice(1);
				deselectMissing(draft);
			},
		},
		clear: {
			args: [],
			post: (_prev, next) => next.shapes.length === 0,
			run(draft) {
				draft.current = null;
				draft.selected = "";
				if (this.shapes.length === 0) return;
				remember(this, draft);
				draft.shapes = [];
			},
		},
		key(draft, _args, ctx) {
			const e = ctx.event;
			const key = e?.key?.toLowerCase();
			if (key === undefined) return;
			const run = (name) => Drawing.on[name].run.call(this, draft, [], ctx);
			if (e.ctrlKey || e.metaKey) {
				if (key === "z" && !e.shiftKey) run("undo");
				else if (key === "y" || key === "z") run("redo");
				else if (key === "d") run("duplicate");
				else return;
			} else if (key === "delete" || key === "backspace") run("remove");
			else if (key === "pageup") run("raise");
			else if (key === "pagedown") run("lower");
			else if (key === "enter") run("finish");
			else if (key === "escape") run("cancel");
			else if (TOOL_KEYS[key] !== undefined)
				Drawing.on.setTool.run.call(this, draft, [TOOL_KEYS[key]], ctx);
			else return;
			e.preventDefault();
		},
		exportSvg: {
			args: [],
			emits: { ask: ["saveFile"] },
			run(_draft, _args, ctx) {
				ctx.ask("saveFile", ["drawing.svg", this.toSvg(), "image/svg+xml"]);
			},
		},
		saveFileReplyOk() {},
		saveFileReplyError() {},
		saveFileHandlerNotFound() {},
	},
});
// Paint and width apply to the selection too, as one undoable change.
function restyle(self, draft, changes) {
	const i = self.selectedIndex;
	if (i < 0) return;
	remember(self, draft);
	Object.assign(draft.shapes[i], changes);
}
function commit(self, draft, shape) {
	draft.current = null;
	if (shape.isEmpty()) return;
	remember(self, draft);
	draft.shapes.push(shape);
}
function hasUniqueIds(shapes) {
	return new Set(shapes.map((s) => s.id)).size === shapes.length;
}
function deselectMissing(draft) {
	if (!draft.shapes.some((s) => s.id === draft.selected)) draft.selected = "";
}

export const drawingComponents = { Drawing, Rect, Ellipse, Line, Polyline };

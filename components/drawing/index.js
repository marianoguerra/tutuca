// A small vector drawing editor in SVG, simple like MS Paint and vector like Inkscape:
// rectangle, ellipse, line and polyline tools, a select tool to pick and move shapes, raise,
// lower, duplicate and delete, fill and stroke from a palette (click for fill, right click
// for stroke), stroke widths, undo and redo, and export as an .svg file. Pointer events turn
// into messages with coordinates (startAt, moveTo, end), so drawing can be scripted and tested.

import {
	$if,
	AGENT_META,
	agentTool,
	apply,
	button,
	component,
	DISPLAY_META,
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
const remember = (self, next) => {
	next.past = [...self.past.slice(-(MAX_HISTORY - 1)), self.shapes];
	next.future = [];
};
const newId = (ctx) => `s-${ctx.uuid()}`;

// What an agent draws with: shapes by id, in canvas coordinates, colors as #rrggbb or none.
const shapeAt = (self, id) => self.shapes.findIndex((s) => s.id === id);
const hasShape = (self, id) => shapeAt(self, id) !== -1;
const noShape = (_self, [id]) => `there's no shape ${id}`;
const widthType = () => t.enum(2, 1, 4, 8);
const shapeLine = (s) => {
	const kind = specOf(s).name.toLowerCase();
	const where =
		kind === "polyline"
			? `points ${s.points.join(",")}`
			: kind === "line"
				? `from (${s.x0}, ${s.y0}) to (${s.x1}, ${s.y1})`
				: `at (${s.left}, ${s.top}), ${s.boxWidth}×${s.boxHeight}`;
	return `${s.id} ${kind} ${where}, fill ${s.fill}, stroke ${s.stroke} ${s.width}px`;
};
const AGENT = {
	prompt:
		"An SVG drawing: shapes from back to front, in canvas coordinates (x right, y down, from the top left corner, inside its width and height). Rectangles and ellipses fill the box between two corners, lines go from one point to the other, polylines join points [x0, y0, x1, y1, ...]. Colors are #rrggbb (lowercase) or none; stroke widths are 1, 2, 4 or 8. Draw scenes from simple shapes, back ones first; check the summary after.",
	tools: [
		agentTool(
			"add_shape",
			"message",
			["kind", "x0", "y0", "x1", "y1", "fill", "stroke", "width"],
			"Add a rect, ellipse or line between two corners (a line between two points), in front of the rest.",
		),
		agentTool(
			"add_polyline",
			"message",
			["points", "fill", "stroke", "width"],
			"Add a polyline through points [x0, y0, x1, y1, ...], in front of the rest.",
		),
		agentTool("move_shape", "message", ["id", "dx", "dy"], "Move a shape by dx, dy."),
		agentTool(
			"style_shape",
			"message",
			["id", "fill", "stroke", "width"],
			"Change a shape's colors and stroke width.",
		),
		agentTool(
			"layer_shape",
			"message",
			["id", "to"],
			"Move a shape to the front or back, or one step up or down.",
		),
		agentTool("remove_shape", "message", ["id"], "Remove a shape."),
		agentTool("undo", "message", [], "Undo the last change."),
		agentTool("redo", "message", [], "Redo what was undone."),
		agentTool("clear", "message", [], "Remove every shape."),
	],
};

export const Drawing = component({
	name: "Drawing",
	meta: {
		[DISPLAY_META]: {
			title: "Drawing",
			icon: "🎨",
			description: "Shapes you draw, move and layer.",
		},
		[AGENT_META]: AGENT,
	},
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
		// The drawing as a standalone SVG document.
		toSvg() {
			const body = this.shapes.map((s) => `  ${s.toSvg()}\n`).join("");
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${this.viewBox}" width="${this.width}" height="${this.height}">\n${body}</svg>\n`;
		},
	},
	queries: {
		// The canvas and each shape, back to front, for an agent.
		get summary() {
			const shapes = this.shapes.map(shapeLine).join("\n");
			return `${this.width}×${this.height} canvas, ${this.shapes.length} shapes:\n${shapes || "none"}`;
		},
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
			run(next, [tool]) {
				if (!TOOLS.some(([id]) => id === tool)) return;
				next.tool = tool;
				next.current = null;
				if (tool !== "select") next.selected = "";
			},
		},
		setWidth: {
			args: [t.string()],
			run(next, [width]) {
				const w = Number(width);
				if (![1, 2, 4, 8].includes(w)) return;
				next.strokeWidth = w;
				restyle(this, next, { width: w });
			},
		},
		setFill: {
			args: [t.string()],
			run(next, [p]) {
				if (!isPaint(p)) return;
				next.fill = p;
				restyle(this, next, { fill: p });
			},
		},
		// A right click on a swatch, as Inkscape's shift click.
		setStroke: {
			args: [t.string()],
			run(next, [p], ctx) {
				ctx.event?.preventDefault();
				if (!isPaint(p)) return;
				next.stroke = p;
				restyle(this, next, { stroke: p });
			},
		},
		// Drawing, by coordinates.
		startAt: {
			args: [coord(), coord()],
			run(next, [x, y], ctx) {
				if (this.tool === "select") {
					next.selected = "";
					return;
				}
				// A polyline being drawn takes another point; its last one follows the pointer.
				if (this.current !== null && this.tool === "polyline") {
					next.current = apply(next.current, "addPoint", x, y);
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
				next.current = ctx.scope.make(kind, { id: newId(ctx), ...style, ...shape });
			},
		},
		moveTo: {
			args: [coord(), coord()],
			run(next, [x, y]) {
				next.cursor = `${Math.round(x)}, ${Math.round(y)}`;
				if (next.current !== null) next.current = apply(next.current, "dragTo", x, y);
				else if (this.dragFrom !== null && this.selection !== null) {
					const [x0, y0] = this.dragFrom;
					const i = this.selectedIndex;
					next.shapes[i] = apply(next.shapes[i], "moveBy", x - x0, y - y0);
					next.dragFrom = [x, y];
				}
			},
		},
		// Ends a drag; a polyline goes on until finish.
		end: {
			args: [],
			run(next) {
				next.dragFrom = null;
				if (this.current === null || this.tool === "polyline") return;
				commit(this, next, this.current);
			},
		},
		finish: {
			args: [],
			post: (_prev, next) => next.current === null,
			run(next, _args, ctx) {
				const shape = this.current;
				if (shape === null) return;
				if (shape.points === undefined) {
					commit(this, next, shape);
					return;
				}
				// Without the point following the pointer, and the repeats a double click adds.
				const points = shape.points.slice(0, -2);
				const kept = [];
				for (let i = 0; i < points.length; i += 2) {
					if (kept.at(-2) !== points[i] || kept.at(-1) !== points[i + 1])
						kept.push(points[i], points[i + 1]);
				}
				commit(this, next, ctx.scope.make("Polyline", { ...shape, points: kept }));
			},
		},
		cancel: {
			args: [],
			run(next) {
				next.current = null;
				next.dragFrom = null;
				next.selected = "";
			},
		},
		// Pointer events, turned into the messages above.
		down(next, _args, ctx) {
			const point = svgPoint(ctx.event);
			if (point === null || ctx.event.button > 0) return;
			capture(ctx.event);
			Drawing.on.startAt.run.call(this, next, point, ctx);
		},
		move(next, _args, ctx) {
			const point = svgPoint(ctx.event);
			if (point !== null) Drawing.on.moveTo.run.call(this, next, point, ctx);
		},
		up(next, _args, ctx) {
			Drawing.on.end.run.call(this, next, [], ctx);
		},
		// From a pressed shape: the select tool picks it up, the others draw over it.
		shapeDown: {
			args: [t.string(), coord(), coord()],
			run(next, [id, x, y], ctx) {
				ctx.stopNext();
				if (this.tool !== "select") {
					Drawing.on.startAt.run.call(this, next, [x, y], ctx);
					return;
				}
				if (!this.shapes.some((s) => s.id === id)) return;
				remember(this, next); // So moving it can be undone.
				next.selected = id;
				next.dragFrom = [x, y];
			},
		},
		shapeMove: {
			args: [coord(), coord()],
			run(next, point, ctx) {
				ctx.stopNext();
				Drawing.on.moveTo.run.call(this, next, point, ctx);
			},
		},
		shapeUp: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				Drawing.on.end.run.call(this, next, [], ctx);
			},
		},
		raise: {
			args: [],
			run(next) {
				const i = this.selectedIndex;
				if (i < 0 || i === this.shapes.length - 1) return;
				remember(this, next);
				[next.shapes[i], next.shapes[i + 1]] = [this.shapes[i + 1], this.shapes[i]];
			},
		},
		lower: {
			args: [],
			run(next) {
				const i = this.selectedIndex;
				if (i <= 0) return;
				remember(this, next);
				[next.shapes[i - 1], next.shapes[i]] = [this.shapes[i], this.shapes[i - 1]];
			},
		},
		// A copy a little down and right, above the original, which becomes the selection.
		duplicate: {
			args: [],
			run(next, _args, ctx) {
				const s = this.selection;
				if (s === null) return;
				remember(this, next);
				const copy = ctx.scope.make(specOf(s).name, { ...s, id: newId(ctx) });
				const at = this.selectedIndex + 1;
				next.shapes.splice(at, 0, copy);
				// Toward the side with room, so a copy at the edge still shows apart.
				const nudge = (far) => (far + 10 <= COORD_MAX ? 10 : -10);
				const [dx, dy] = [nudge(s.left + s.boxWidth), nudge(s.top + s.boxHeight)];
				next.shapes[at] = apply(next.shapes[at], "moveBy", dx, dy);
				next.selected = copy.id;
			},
		},
		remove: {
			args: [],
			run(next) {
				const i = this.selectedIndex;
				if (i < 0) return;
				remember(this, next);
				next.shapes.splice(i, 1);
				next.selected = "";
			},
		},
		// The agent's: shapes made and changed by id, each change undoable.
		add_shape: {
			args: [
				t.enum("rect", "ellipse", "line"),
				coord(),
				coord(),
				coord(),
				coord(),
				paintType("none"),
				paintType("#000000"),
				widthType(),
			],
			run(next, [kind, x0, y0, x1, y1, fill, stroke, width], ctx) {
				const name = { rect: "Rect", ellipse: "Ellipse", line: "Line" }[kind];
				remember(this, next);
				next.shapes.push(
					ctx.scope.make(name, { id: newId(ctx), x0, y0, x1, y1, fill, stroke, width }),
				);
			},
		},
		add_polyline: {
			args: [
				t
					.array(coord())
					.where((ps) => ps.length >= 4 && ps.length % 2 === 0, "at least two x, y pairs")
					.arb((fc) =>
						fc
							.array(fc.integer({ min: 0, max: 600 }), { minLength: 4, maxLength: 8 })
							.map((ps) => (ps.length % 2 === 0 ? ps : ps.slice(1))),
					),
				paintType("none"),
				paintType("#000000"),
				widthType(),
			],
			run(next, [points, fill, stroke, width], ctx) {
				remember(this, next);
				next.shapes.push(
					ctx.scope.make("Polyline", { id: newId(ctx), points, fill, stroke, width }),
				);
			},
		},
		move_shape: {
			pure: true,
			args: [t.string(), t.number(), t.number()],
			pre: (self, [id]) => hasShape(self, id),
			why: noShape,
			run(next, [id, dx, dy]) {
				const i = shapeAt(this, id);
				remember(this, next);
				next.shapes[i] = apply(next.shapes[i], "moveBy", dx, dy);
			},
		},
		style_shape: {
			pure: true,
			args: [t.string(), paintType("none"), paintType("#000000"), widthType()],
			pre: (self, [id]) => hasShape(self, id),
			why: noShape,
			run(next, [id, fill, stroke, width]) {
				const i = shapeAt(this, id);
				remember(this, next);
				next.shapes[i] = apply(next.shapes[i], "setStyle", fill, stroke, width);
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
				if (i === j) return;
				remember(this, next);
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
				remember(this, next);
				next.shapes.splice(shapeAt(this, id), 1);
				if (this.selected === id) next.selected = "";
			},
		},
		undo: {
			pure: true,
			args: [],
			run(next) {
				if (this.past.length === 0) return;
				next.future = [this.shapes, ...this.future];
				next.shapes = this.past.at(-1);
				next.past = this.past.slice(0, -1);
				deselectMissing(next);
			},
		},
		redo: {
			pure: true,
			args: [],
			run(next) {
				if (this.future.length === 0) return;
				next.past = [...this.past.slice(-(MAX_HISTORY - 1)), this.shapes];
				next.shapes = this.future[0];
				next.future = this.future.slice(1);
				deselectMissing(next);
			},
		},
		clear: {
			pure: true,
			args: [],
			post: (_prev, next) => next.shapes.length === 0,
			run(next) {
				next.current = null;
				next.selected = "";
				if (this.shapes.length === 0) return;
				remember(this, next);
				next.shapes = [];
			},
		},
		key(next, _args, ctx) {
			const e = ctx.event;
			const key = e?.key?.toLowerCase();
			if (key === undefined) return;
			const run = (name) => Drawing.on[name].run.call(this, next, [], ctx);
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
				Drawing.on.setTool.run.call(this, next, [TOOL_KEYS[key]], ctx);
			else return;
			e.preventDefault();
		},
		exportSvg: {
			args: [],
			emits: { ask: ["saveFile"] },
			run(_next, _args, ctx) {
				ctx.ask("saveFile", ["drawing.svg", this.toSvg(), "image/svg+xml"]);
			},
		},
	},
	answers: {
		saveFile: {
			ok() {},
			error() {},
			unhandled() {},
		},
	},
});
// Paint and width apply to the selection too, as one undoable change.
function restyle(self, next, changes) {
	const i = self.selectedIndex;
	if (i < 0) return;
	remember(self, next);
	const { fill, stroke, width } = self.shapes[i];
	const style = [changes.fill ?? fill, changes.stroke ?? stroke, changes.width ?? width];
	next.shapes[i] = apply(next.shapes[i], "setStyle", ...style);
}
function commit(self, next, shape) {
	next.current = null;
	if (shape.isEmpty()) return;
	remember(self, next);
	next.shapes.push(shape);
}
function hasUniqueIds(shapes) {
	return new Set(shapes.map((s) => s.id)).size === shapes.length;
}
function deselectMissing(next) {
	if (!next.shapes.some((s) => s.id === next.selected)) next.selected = "";
}

export const drawingComponents = { Drawing, Rect, Ellipse, Line, Polyline };

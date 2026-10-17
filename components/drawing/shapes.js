// The shapes a drawing holds (Rect, Ellipse, Line, Polyline), their paint and coordinate types,
// and how a pointer draws them.

import { component, field, send, t, tag } from "../../src/tutuca.js";

const { ellipse, line, polyline, rect } = tag;

export const PALETTE = [
	"#000000",
	"#7f7f7f",
	"#c3c3c3",
	"#ffffff",
	"#880015",
	"#ed1c24",
	"#ff7f27",
	"#fff200",
	"#22b14c",
	"#00a2e8",
	"#3f48cc",
	"#a349a4",
	"#b97a57",
	"#ffaec9",
	"#99d9ea",
	"#c8bfe7",
];
const COLOR = /^#[0-9a-f]{6}$/;
export const isPaint = (v) => v === "none" || COLOR.test(v);
// A color or "none", as SVG's fill and stroke take them.
export const paintType = (fallback) =>
	t
		.string(fallback)
		.where(isPaint, "colorOrNone")
		.arb((fc) => fc.constantFrom("none", ...PALETTE));
export const COORD_MAX = 10000;
export const coord = () => t.number().min(-COORD_MAX).max(COORD_MAX);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const fit = (v) => clamp(v, -COORD_MAX, COORD_MAX);
// The part of a move that keeps the whole shape within range, so it stops at the edge unchanged.
const moveInRange = (shape, dx, dy) => [
	clamp(dx, -COORD_MAX - shape.left, COORD_MAX - shape.left - shape.boxWidth),
	clamp(dy, -COORD_MAX - shape.top, COORD_MAX - shape.top - shape.boxHeight),
];
const round = (v) => Math.round(v * 10) / 10;

// The point of a pointer event in its svg's viewBox coordinates, or null without one.
export const svgPoint = (event) => {
	const target = event?.target;
	if (target === undefined || target === null || typeof event.clientX !== "number") return null;
	const canvas =
		target.tagName?.toLowerCase() === "svg"
			? target
			: (target.ownerSVGElement ?? target.closest?.("svg"));
	if (!canvas) return null;
	const ctm = canvas.getScreenCTM?.();
	if (ctm && typeof DOMPoint === "function") {
		const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
		return [round(p.x), round(p.y)];
	}
	const box = canvas.getBoundingClientRect();
	return [round(event.clientX - box.left), round(event.clientY - box.top)];
};

const shapeFields = (t) => ({
	id: t.string(),
	fill: paintType("none"),
	stroke: paintType("#000000"),
	width: t.enum(2, 1, 4, 8),
});
// Pressing a shape selects it or starts a new shape over it, as the tool says.
// The canvas captures the pointer, so a drag's moves and release reach it, not the shape.
// Where nothing captures it, shapes pass them on, so a drag always ends.
export const pointer = {
	down: {
		args: [],
		emits: { notify: ["shapeDown"] },
		run(_draft, _args, ctx) {
			const point = svgPoint(ctx.event);
			if (point === null) return;
			capture(ctx.event);
			ctx.notify("shapeDown", [this.id, ...point]);
		},
	},
	move: {
		args: [],
		emits: { notify: ["shapeMove"] },
		run(_draft, _args, ctx) {
			const point = svgPoint(ctx.event);
			if (point !== null) ctx.notify("shapeMove", point);
		},
	},
	up: {
		args: [],
		emits: { notify: ["shapeUp"] },
		run(_draft, _args, ctx) {
			ctx.notify("shapeUp");
		},
	},
};
const pointerEvents = {
	"@on.pointerdown": send("down"),
	"@on.pointermove": send("move"),
	"@on.pointerup": send("up"),
	"@on.pointercancel": send("up"),
};
export const paint = {
	fill: field("fill"),
	stroke: field("stroke"),
	"stroke-width": field("width"),
};
const attrs = (shape) =>
	`fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.width}"`;

// Rectangles, ellipses and lines are drawn from one corner to the other.
const corners = {
	get left() {
		return Math.min(this.x0, this.x1);
	},
	get top() {
		return Math.min(this.y0, this.y1);
	},
	get boxWidth() {
		return Math.abs(this.x1 - this.x0);
	},
	get boxHeight() {
		return Math.abs(this.y1 - this.y0);
	},
	isEmpty() {
		return this.boxWidth < 1 && this.boxHeight < 1;
	},
	dragTo(x, y) {
		this.x1 = x;
		this.y1 = y;
	},
	// fit only absorbs rounding: moveInRange already keeps the shape in range.
	moveBy(dx, dy) {
		[dx, dy] = moveInRange(this, dx, dy);
		this.x0 = fit(this.x0 + dx);
		this.x1 = fit(this.x1 + dx);
		this.y0 = fit(this.y0 + dy);
		this.y1 = fit(this.y1 + dy);
	},
};
// Getters stay getters: spreading would read them once.
const withCorners = (methods) =>
	Object.defineProperties(methods, Object.getOwnPropertyDescriptors(corners));
const cornerFields = () => ({ x0: coord(), y0: coord(), x1: coord(), y1: coord() });

export const Rect = component({
	name: "Rect",
	fields: (t) => ({ ...shapeFields(t), ...cornerFields() }),
	methods: withCorners({
		toSvg() {
			return `<rect x="${this.left}" y="${this.top}" width="${this.boxWidth}" height="${this.boxHeight}" ${attrs(this)}/>`;
		},
	}),
	view: rect({
		x: field("left"),
		y: field("top"),
		width: field("boxWidth"),
		height: field("boxHeight"),
		...paint,
		...pointerEvents,
	}),
	on: pointer,
});

export const Ellipse = component({
	name: "Ellipse",
	fields: (t) => ({ ...shapeFields(t), ...cornerFields() }),
	methods: withCorners({
		get cx() {
			return (this.x0 + this.x1) / 2;
		},
		get cy() {
			return (this.y0 + this.y1) / 2;
		},
		get rx() {
			return this.boxWidth / 2;
		},
		get ry() {
			return this.boxHeight / 2;
		},
		toSvg() {
			return `<ellipse cx="${this.cx}" cy="${this.cy}" rx="${this.rx}" ry="${this.ry}" ${attrs(this)}/>`;
		},
	}),
	view: ellipse({
		cx: field("cx"),
		cy: field("cy"),
		rx: field("rx"),
		ry: field("ry"),
		...paint,
		...pointerEvents,
	}),
	on: pointer,
});

export const Line = component({
	name: "Line",
	fields: (t) => ({ ...shapeFields(t), ...cornerFields() }),
	methods: withCorners({
		toSvg() {
			return `<line x1="${this.x0}" y1="${this.y0}" x2="${this.x1}" y2="${this.y1}" ${attrs(this)} stroke-linecap="round"/>`;
		},
	}),
	view: line({
		x1: field("x0"),
		y1: field("y0"),
		x2: field("x1"),
		y2: field("y1"),
		...paint,
		"stroke-linecap": "round",
		...pointerEvents,
	}),
	on: pointer,
});

const pointsType = () =>
	t
		.array(coord())
		.where((ps) => ps.length >= 2 && ps.length % 2 === 0, "pairs")
		.arb((fc) =>
			fc
				.array(fc.integer({ min: 0, max: 600 }), { minLength: 2, maxLength: 8 })
				.map((ps) => (ps.length % 2 === 0 ? ps : ps.slice(1))),
		);
// Built a point per click; while drawing, the last point follows the pointer.
export const Polyline = component({
	name: "Polyline",
	fields: (t) => ({ ...shapeFields(t), points: pointsType() }),
	methods: {
		get pointsAttr() {
			const pairs = [];
			for (let i = 0; i + 1 < this.points.length; i += 2)
				pairs.push(`${this.points[i]},${this.points[i + 1]}`);
			return pairs.join(" ");
		},
		get xs() {
			return this.points.filter((_, i) => i % 2 === 0);
		},
		get ys() {
			return this.points.filter((_, i) => i % 2 === 1);
		},
		get left() {
			return Math.min(...this.xs);
		},
		get top() {
			return Math.min(...this.ys);
		},
		get boxWidth() {
			return Math.max(...this.xs) - this.left;
		},
		get boxHeight() {
			return Math.max(...this.ys) - this.top;
		},
		isEmpty() {
			return this.points.length < 4 || (this.boxWidth < 1 && this.boxHeight < 1);
		},
		dragTo(x, y) {
			this.points.splice(-2, 2, x, y);
		},
		addPoint(x, y) {
			this.points.push(x, y);
		},
		moveBy(dx, dy) {
			[dx, dy] = moveInRange(this, dx, dy);
			this.points = this.points.map((v, i) => fit(v + (i % 2 === 0 ? dx : dy)));
		},
		toSvg() {
			return `<polyline points="${this.pointsAttr}" ${attrs(this)} stroke-linejoin="round"/>`;
		},
	},
	view: polyline({
		points: field("pointsAttr"),
		...paint,
		"stroke-linejoin": "round",
		...pointerEvents,
	}),
	on: pointer,
});

export function capture(event) {
	try {
		event?.target?.closest?.("svg")?.setPointerCapture?.(event.pointerId);
	} catch {} // A synthetic event has no pointer to capture.
}

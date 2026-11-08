// The canvas's shapes beyond the drawing's Rect, Ellipse and Line: an Arrow, a Line with a head
// at its far end, and a Text. They press, move and restyle like the drawing's shapes, so the
// canvas handles them all alike.

import { component, field, t, tag } from "../../src/tutuca.js";
import { mix } from "../common/util.js";
import {
	coord,
	cornerFields,
	cornerMethods,
	cornerOn,
	cornerQueries,
	paint,
	pointer,
	pointerEvents,
	shapeFields,
	styleOn,
} from "../drawing/shapes.js";

const { g, line, polygon, text } = tag;

// How far the head's sides open from the shaft, in radians.
const HEAD_ANGLE = 0.45;

export const Arrow = component({
	name: "Arrow",
	fields: { ...shapeFields(), ...cornerFields() },
	queries: mix(cornerQueries, {
		get headLength() {
			return 8 + 3 * this.width;
		},
		get headPoints() {
			const a = Math.atan2(this.y1 - this.y0, this.x1 - this.x0);
			const side = (turn) =>
				`${this.x1 - this.headLength * Math.cos(a + turn)},${this.y1 - this.headLength * Math.sin(a + turn)}`;
			return `${this.x1},${this.y1} ${side(-HEAD_ANGLE)} ${side(HEAD_ANGLE)}`;
		},
	}),
	methods: cornerMethods,
	view: g(
		pointerEvents,
		line({
			x1: field("x0"),
			y1: field("y0"),
			x2: field("x1"),
			y2: field("y1"),
			...paint,
			"stroke-linecap": "round",
		}),
		polygon({ points: field("headPoints"), fill: field("stroke"), stroke: "none" }),
	),
	on: cornerOn,
});

const SIZE = 20;

// One line of text with its baseline starting at x, y, in the stroke's color (the fill's when
// there's no stroke).
export const Text = component({
	name: "Text",
	fields: { ...shapeFields(), x: coord(), y: coord(), text: t.string("Text") },
	queries: {
		get color() {
			return this.stroke === "none" ? this.fill : this.stroke;
		},
		get left() {
			return this.x;
		},
		get top() {
			return this.y - SIZE * 0.8;
		},
		// Text isn't measured: an estimate is enough to show the selection.
		get boxWidth() {
			return Math.max(1, this.text.length) * SIZE * 0.6;
		},
		get boxHeight() {
			return SIZE;
		},
	},
	methods: {
		isEmpty() {
			return this.text === "";
		},
	},
	view: text(
		{
			x: field("x"),
			y: field("y"),
			fill: field("color"),
			"font-size": String(SIZE),
			"font-family": "sans-serif",
			style: "user-select:none;cursor:default",
			...pointerEvents,
		},
		field("text"),
	),
	on: {
		...pointer,
		...styleOn,
		moveBy: {
			pure: true,
			args: [t.number(), t.number()],
			run(next, [dx, dy]) {
				next.x = this.x + dx;
				next.y = this.y + dy;
			},
		},
		setText: {
			pure: true,
			args: [t.string()],
			run(next, [value]) {
				next.text = value;
			},
		},
	},
});

// The graphics a renders.ps can draw, as a table src/checked reads (its schema.js says how).
//
// It's a drawing, not PostScript's operators: a Document of Pages of Graphics (Group, Rect,
// Circle, Line, Polyline, Path, Text), which print.js prints as the operators that draw them (and
// tutuca/pdf as a PDF's). Coordinates are PostScript's: points (1/72 inch), the origin at the
// page's bottom left, y up. Its categories are Graphic and Segment (a Path's); Text is a literal.
import { empty, isColor, literal, oneOf, opt, parent, req, Schema } from "../checked/schema.js";

export { isColor };
export const GRAPHIC = "Graphic";
export const SEGMENT = "Segment";

export const LINE_CAPS = ["butt", "round", "square"];
export const LINE_JOINS = ["miter", "round", "bevel"];
export const ALIGNS = ["left", "center", "right"];

// How a shape strokes; what it says neither fill nor stroke for is in print.js's paint.
const strokeStyle = {
	stroke: opt("color"),
	lineWidth: opt("size"),
	dash: opt("dash"),
	lineCap: oneOf(LINE_CAPS),
	lineJoin: oneOf(LINE_JOINS),
};
const paint = { fill: opt("color"), ...strokeStyle };
const at = { x: req("number"), y: req("number") };

const G = [GRAPHIC];
const S = [SEGMENT];

export const SCHEMA = {
	// The pages a document has share its size, unless they say their own.
	Document: parent("document", [], ["Page"], {
		title: opt("string"),
		width: opt("positive"),
		height: opt("positive"),
	}),
	Page: parent("page", [], G, {
		width: opt("positive"),
		height: opt("positive"),
		label: opt("string"),
		background: opt("color"),
	}),
	// Its children drawn moved by x, y, then rotated (degrees, counterclockwise) and scaled. The
	// nth child (from 0) is moved n times stepX, stepY more: the items of an each in a row.
	Group: parent("group", G, G, {
		x: opt("number"),
		y: opt("number"),
		rotate: opt("number"),
		scale: opt("number"),
		scaleX: opt("number"),
		scaleY: opt("number"),
		stepX: opt("number"),
		stepY: opt("number"),
	}),
	Rect: empty("rect", G, { ...at, width: req("size"), height: req("size"), ...paint }),
	Circle: empty("circle", G, { cx: req("number"), cy: req("number"), r: req("size"), ...paint }),
	Line: empty("line", G, {
		x1: req("number"),
		y1: req("number"),
		x2: req("number"),
		y2: req("number"),
		...strokeStyle,
	}),
	// points: [[x, y], ...], two or more.
	Polyline: empty("polyline", G, { points: req("points"), closed: opt("boolean"), ...paint }),
	// Its segments, as PostScript's path operators; it starts with a MoveTo or an Arc.
	Path: parent("path", G, S, paint),
	MoveTo: empty("moveTo", S, at),
	LineTo: empty("lineTo", S, at),
	CurveTo: empty("curveTo", S, {
		x1: req("number"),
		y1: req("number"),
		x2: req("number"),
		y2: req("number"),
		...at,
	}),
	// Degrees, counterclockwise from the positive x axis, unless clockwise.
	Arc: empty("arc", S, {
		cx: req("number"),
		cy: req("number"),
		r: req("size"),
		from: req("number"),
		to: req("number"),
		clockwise: opt("boolean"),
	}),
	ClosePath: empty("closePath", S),
	// x, y is where its first line's baseline starts (align left), is centered (center) or ends
	// (right); a newline starts a line lineHeight (size × 1.2 by default) below.
	Text: literal("text", G, {
		...at,
		value: opt("string"),
		font: opt("font"),
		size: opt("positive"),
		lineHeight: opt("number"),
		align: oneOf(ALIGNS),
		fill: opt("color"),
	}),
};

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
// A PostScript name that needs no escaping: Helvetica, Times-Bold, NewCenturySchlbk-Roman.
const isFont = (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9._-]*$/.test(v);

export const PS = new Schema(SCHEMA, {
	name: "ps",
	render: "ps",
	categories: [GRAPHIC, SEGMENT],
	describeCategory: (c) => `a ${c}`,
	kinds: {
		font: (v) => (isFont(v) ? null : "a font name, as Helvetica or Times-Bold"),
		dash: (v) =>
			Array.isArray(v) &&
			v.every((d) => isNumber(d) && d >= 0) &&
			(v.length === 0 || v.some((d) => d > 0))
				? null
				: "an array of lengths, 0 or more, not all 0",
		points: (v) =>
			Array.isArray(v) &&
			v.length >= 2 &&
			v.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNumber))
				? null
				: "an array of two or more [x, y]",
	},
});

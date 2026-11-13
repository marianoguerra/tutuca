// What a drawing (a tree lower.js makes) means where it doesn't say, for everything that draws
// one: print.js's PostScript, tutuca/pdf's PDF and the Renders demo's SVG preview.
// - A Page or a Graphic at the root is put in a document, a Graphic in a page.
// - A page is A4 (595 × 842) unless it or its document says its size.
// - A shape that says neither fill nor stroke fills black if it encloses an area (Rect, Circle,
//   Path, a closed Polyline) and strokes black if it doesn't (Line, an open Polyline). Text is
//   black and Helvetica 12 unless it says otherwise, a line per newline, lineHeight (size × 1.2)
//   below the last.
// - A Group's nth child is moved n times stepX, stepY.
// - An Arc's angles are degrees; it sweeps counterclockwise (clockwise if it says so) from from
//   to to, adding 360 until it gets there, and starts with a line from the current point.

export const PAGE_SIZE = Object.freeze({ width: 595, height: 842 });
export const DEFAULT_FONT = "Helvetica";
export const DEFAULT_SIZE = 12;
export const BLACK = "#000";

export const asDocument = (tree) => {
	if (tree.type === "document") return tree;
	if (tree.type === "page") return { type: "document", children: [tree] };
	return { type: "document", children: [{ type: "page", children: [tree] }] };
};
export const pageSize = (doc, page) => ({
	width: page.width ?? doc.width ?? PAGE_SIZE.width,
	height: page.height ?? doc.height ?? PAGE_SIZE.height,
});

// Whether a shape encloses an area, which it fills when it says neither fill nor stroke.
const ENCLOSES = { rect: true, circle: true, path: true, line: false };
export const encloses = (node) =>
	node.type === "polyline" ? node.closed === true : ENCLOSES[node.type];
// Its fill and stroke, each a color or undefined.
export const paintOf = (node) => {
	const { fill, stroke } = node;
	if (fill !== undefined || stroke !== undefined) return { fill, stroke };
	return encloses(node) ? { fill: BLACK, stroke } : { fill, stroke: BLACK };
};

export const fontOf = (node) => node.font ?? DEFAULT_FONT;
// A Text's lines, each with its baseline's y; empty lines are left out.
export const textLines = (node) => {
	const size = node.size ?? DEFAULT_SIZE;
	const lineHeight = node.lineHeight ?? size * 1.2;
	return node.value
		.split("\n")
		.map((text, i) => ({ text, y: node.y - i * lineHeight }))
		.filter(({ text }) => text !== "");
};

export const groupTransform = (node) => {
	const { x = 0, y = 0, rotate = 0, scale = 1, stepX = 0, stepY = 0 } = node;
	const { scaleX = scale, scaleY = scale } = node;
	return { x, y, rotate, scaleX, scaleY, stepX, stepY };
};

// An Arc's start and end, in degrees, end - start being its sweep (negative clockwise).
export const arcSweep = ({ from, to, clockwise }) => {
	let end = to;
	if (clockwise) while (end > from) end -= 360;
	else while (end < from) end += 360;
	return { start: from, end };
};

// A color's red, green and blue, 0 to 1.
export const rgbOf = (color) => {
	const hex = color.slice(1);
	const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
	return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
};

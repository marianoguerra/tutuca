// What a layout unit is: the metrics layout, hit testing, the screen and painters agree on. A
// terminal lays out in cells (cellMetrics); a canvas can lay out in cells drawn as pixels (the
// same metrics, scaled by its painter) or in pixels with a proportional font (fontMetrics).
//
// A metrics object has:
// - unitX, unitY: the layout units one unit of an attribute is across and down (padding "1",
//   width "20", top "2"): 1 in cells, a cell's size in pixels, so a tree written for a terminal
//   keeps its proportions.
// - lineHeight: how tall a line of text is.
// - borderX, borderY: how much room a border takes on the left and right, top and bottom.
// - ruleX, ruleY: how thick a split line or a divider is, down a row and across a column.
// - caret: how wide the caret is, the room a textarea keeps for it past its longest line.
// - measureOf(node): the measure (text.js's measureWidth) of a text node's graphemes, by the
//   font its text and spans are in; undefined for cells.
// - scales: whether attributes need scaling from cells (unitX or unitY isn't 1).
import { spanAt } from "./props.js";
import { graphemes } from "./text.js";

export const cellMetrics = Object.freeze({
	unitX: 1,
	unitY: 1,
	lineHeight: 1,
	borderX: 1,
	borderY: 1,
	ruleX: 1,
	ruleY: 1,
	caret: 1,
	scales: false,
	measureOf: () => undefined,
});

// The font a text is drawn in: what of its style changes how wide it is.
export const fontOf = (style = {}) => ({ bold: !!style.bold, italic: !!style.italic });
const fontKey = (font) => (font.bold ? 1 : 0) + (font.italic ? 2 : 0);

// Metrics for text measured in pixels (or any unit): measure(text, font) is how wide text is in
// font ({ bold, italic }); the rest as above, rounded to whole units. Widths are cached by font
// and grapheme, so measure is called once per grapheme a font shows.
export function fontMetrics({
	measure,
	lineHeight,
	unitX = Math.max(1, Math.round(measure("0", fontOf()))),
	unitY = lineHeight,
	borderX = Math.max(1, Math.round(unitX / 2)),
	borderY = Math.max(1, Math.round(unitY / 2)),
	ruleX = borderX,
	ruleY = borderY,
	caret = Math.max(1, Math.round(unitX / 4)),
}) {
	if (typeof measure !== "function") throw new TypeError("fontMetrics needs measure(text, font)");
	const caches = new Map();
	const widthIn = (font, g) => {
		const key = fontKey(font);
		let cache = caches.get(key);
		if (cache === undefined) {
			cache = new Map();
			caches.set(key, cache);
		}
		let w = cache.get(g);
		if (w === undefined) {
			w = measure(g, font);
			if (cache.size >= 4096) cache.clear();
			cache.set(g, w);
		}
		return w;
	};
	const whole = (v, name) => {
		const n = Math.round(v);
		if (!Number.isFinite(n) || n < 1) throw new RangeError(`${name} must be at least 1`);
		return n;
	};
	return Object.freeze({
		unitX: whole(unitX, "unitX"),
		unitY: whole(unitY, "unitY"),
		lineHeight: whole(lineHeight, "lineHeight"),
		borderX: whole(borderX, "borderX"),
		borderY: whole(borderY, "borderY"),
		ruleX: whole(ruleX, "ruleX"),
		ruleY: whole(ruleY, "ruleY"),
		caret: whole(caret, "caret"),
		scales: true,
		// The width of text in font, grapheme by grapheme, as layout sums it.
		width: (text, font = fontOf()) => {
			let w = 0;
			for (const g of graphemes(text)) w += widthIn(font, g);
			return w;
		},
		measureOf(node) {
			const base = node.font ?? fontOf();
			if (!node.spans) return (g) => widthIn(base, g);
			const { spans } = node;
			const fonts = new Map();
			return (g, at) => {
				const span = spanAt(spans, at);
				let font = fonts.get(span);
				if (font === undefined) {
					font = fontOf({ ...base, ...span.style });
					fonts.set(span, font);
				}
				return widthIn(font, g);
			};
		},
	});
}

// Attributes in units of a cell, as a tree for a terminal is written, in m's units: each length
// across scaled by unitX, each down by unitY (shorthands resolved per side first); percentages
// and keywords as they are. row says whether the parent lays out in a row, for flexBasis.
const ACROSS = ["width", "minWidth", "maxWidth", "left", "right"];
const DOWN = ["height", "minHeight", "maxHeight", "top", "bottom"];
export function scaleProps(props, m, row = false) {
	if (!m.scales) return props;
	const out = { ...props };
	const scale = (v, unit) => (typeof v === "number" ? Math.round(v * unit) : v);
	for (const name of ACROSS) if (props[name] !== undefined) out[name] = scale(props[name], m.unitX);
	for (const name of DOWN) if (props[name] !== undefined) out[name] = scale(props[name], m.unitY);
	const sides = (prefix) => {
		const x = props[`${prefix}X`] ?? props[prefix];
		const y = props[`${prefix}Y`] ?? props[prefix];
		const each = {
			Top: [props[`${prefix}Top`] ?? y, m.unitY],
			Bottom: [props[`${prefix}Bottom`] ?? y, m.unitY],
			Left: [props[`${prefix}Left`] ?? x, m.unitX],
			Right: [props[`${prefix}Right`] ?? x, m.unitX],
		};
		for (const [side, [v, unit]] of Object.entries(each)) {
			if (v !== undefined) out[`${prefix}${side}`] = scale(v, unit);
		}
	};
	sides("padding");
	sides("margin");
	const columnGap = props.columnGap ?? props.gap;
	const rowGap = props.rowGap ?? props.gap;
	if (columnGap !== undefined) out.columnGap = scale(columnGap, m.unitX);
	if (rowGap !== undefined) out.rowGap = scale(rowGap, m.unitY);
	if (props.flexBasis !== undefined)
		out.flexBasis = scale(props.flexBasis, row ? m.unitX : m.unitY);
	return out;
}

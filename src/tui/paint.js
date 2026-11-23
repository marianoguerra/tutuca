// Paints a laid-out tree (layout.js, absolutized) with a painter: the walk every output shares,
// what to draw and in what order, styles and clipping; a painter says how. Text styles inherit
// down the tree as CSS's do: color, backgroundColor, bold, dim, italic, underline, inverse and
// strikethrough set on a box apply to the text in it. A focused element shows its focus style.
//
// A painter has bounds ({ x, y, w, h }, what it shows, in layout units) and draws, each inside
// clip (a rect in layout units):
// - box(layout, props, style, clip): a box's background, border and scrollbar; style is the text
//   style it passes down (its own over its parents').
// - split(layout, props, clip): the lines between a split box's children, joining its border.
// - divider(layout, style, clip): a divider's line and title.
// - text(layout, style, clip): a text's rows (layout.rows, its spans in theirs).
// - input(layout, style, focused, clip): an input's or textarea's value, placeholder, selection
//   and caret, scrolled to keep the caret in view (settling its scroll).
// paint-cells.js's CellPainter draws into a terminal's cells, paint-canvas.js's on a canvas.
import { clipsOf, contentOf, propsOf, TEXT_STYLE } from "./props.js";

// A focused element's focusColor, focusBold, ... replace its color, bold, ...; one with none of
// them shows inverted, except an input, whose caret shows it has focus.
const FOCUS_STYLE = {
	focusColor: "color",
	focusBackgroundColor: "backgroundColor",
	focusBold: "bold",
	focusInverse: "inverse",
	focusBorderColor: "borderColor",
};

export function ownStyle(props, focused, isInput) {
	if (!focused) return props;
	const out = { ...props };
	let any = false;
	for (const [from, to] of Object.entries(FOCUS_STYLE)) {
		if (props[from] === undefined) continue;
		out[to] = props[from] === "false" ? false : props[from];
		any = true;
	}
	if (!any && !isInput) out.inverse = true;
	return out;
}
export function inherit(parent, props) {
	let out = parent;
	for (const name of TEXT_STYLE) {
		if (props[name] === undefined) continue;
		if (out === parent) out = { ...parent };
		out[name] = props[name];
	}
	return out;
}

export const intersect = (a, b) => {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		x,
		y,
		w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
		h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
	};
};

// An input looks like a field: underlined across its width, so it shows where to type when
// it's empty too, unless it has a backgroundColor or underline of its own; its placeholder is dim
// and italic, a hint and not a value. underline "false" turns the line off.
export function fieldStyle(style, props) {
	const out = { ...style };
	if (props.underline === "false") out.underline = false;
	else if (props.underline === undefined && props.backgroundColor === undefined)
		out.underline = true;
	return out;
}

// layout: the root, absolutized; focused: the element with focus, or null.
export function paint(painter, layout, focused = null, text = {}, clip = painter.bounds) {
	const { node, rect } = layout;
	const isFocused = focused !== null && node.el === focused && !node.texts;
	const props = ownStyle(node.props, isFocused, node.input === true);
	const style = inherit(text, props);
	if (node.type === "text") {
		if (node.input) return painter.input(layout, fieldStyle(style, props), isFocused, clip);
		return painter.text(layout, style, clip);
	}
	if (node.type === "divider") return painter.divider(layout, style, clip);
	if (node.type !== "box" || rect.w <= 0 || rect.h <= 0) return;
	painter.box(layout, props, style, clip);
	const clips = clipsOf(props);
	let inner = clip;
	if (clips.x || clips.y) {
		const content = contentOf(layout);
		inner = intersect(clip, {
			x: clips.x ? content.x : clip.x,
			y: clips.y ? content.y : clip.y,
			w: clips.x ? content.w : clip.w,
			h: clips.y ? content.h : clip.h,
		});
	}
	for (const child of layout.children) paint(painter, child, focused, style, inner);
	if (props.split !== undefined && props.split !== "false") painter.split(layout, props, clip);
}

// The text style el's ancestors pass down to it, root first: where a layer starts from, since
// it isn't painted inside them.
function inheritedStyleOf(el) {
	const chain = [];
	for (let n = el.parentNode; n !== null && n.nodeType === 1; n = n.parentNode) chain.unshift(n);
	return chain.reduce((style, n) => inherit(style, propsOf(n)), {});
}

// The root layout, then its layers over it, bottom to top.
export function paintScreen(painter, layout, focused = null) {
	paint(painter, layout, focused);
	for (const layer of layout.layers ?? []) {
		paint(painter, layer, focused, layer.node.el ? inheritedStyleOf(layer.node.el) : {});
	}
}

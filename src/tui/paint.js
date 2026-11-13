// Draws a laid-out tree (layout.js, absolutized) into a CellBuffer. The box and text drawing are
// ported from tuiuiu.js (core/delta-render.ts renderBoxToBuffer/renderTextToBuffer and the
// BORDER_STYLES of utils/types.ts; MIT, see LICENSE.tuiuiu), without its draw-command cache,
// themes and graphics. Text styles inherit down the tree as CSS's do: color, backgroundColor,
// bold, dim, italic, underline, inverse and strikethrough set on a box apply to the text in it.
import { sgr } from "./buffer.js";
import { columnIn, lineIndexAt, linesOf } from "./editing.js";
import { borderOf, clipsOf, paddingOf, propsOf, TEXT_STYLE } from "./layout.js";
import {
	graphemes,
	graphemeWidth,
	padText,
	readGrapheme,
	sliceColumns,
	stringWidth,
	stripControls,
	truncateText,
} from "./text.js";

const border = (tl, tr, bl, br, t, b, l, r) => ({ tl, tr, bl, br, t, b, l, r });
// All of tuiuiu's border styles, by name; none (no border) isn't one, hidden and blank take the
// space with blanks.
export const BORDER_STYLES = {
	single: border("┌", "┐", "└", "┘", "─", "─", "│", "│"),
	double: border("╔", "╗", "╚", "╝", "═", "═", "║", "║"),
	round: border("╭", "╮", "╰", "╯", "─", "─", "│", "│"),
	bold: border("┏", "┓", "┗", "┛", "━", "━", "┃", "┃"),
	heavy: border("┏", "┓", "┗", "┛", "━", "━", "┃", "┃"),
	singleDouble: border("╓", "╖", "╙", "╜", "─", "─", "║", "║"),
	doubleSingle: border("╒", "╕", "╘", "╛", "═", "═", "│", "│"),
	classic: border("+", "+", "+", "+", "-", "-", "|", "|"),
	ascii: border("+", "+", "+", "+", "-", "-", "|", "|"),
	asciiDouble: border("+", "+", "+", "+", "=", "=", "|", "|"),
	markdown: border("|", "|", "|", "|", "-", "-", "|", "|"),
	arrow: border("↘", "↙", "↗", "↖", "↓", "↑", "→", "←"),
	dashed: border("┌", "┐", "└", "┘", "╌", "╌", "╎", "╎"),
	dashedHeavy: border("┏", "┓", "┗", "┛", "╍", "╍", "╏", "╏"),
	heavyHead: border("┎", "┒", "└", "┘", "━", "─", "│", "│"),
	doubleHead: border("╒", "╕", "└", "┘", "═", "─", "│", "│"),
	heavyEdge: border("┍", "┑", "┕", "┙", "─", "─", "┃", "┃"),
	doubleEdge: border("╓", "╖", "╙", "╜", "─", "─", "║", "║"),
	minimal: border("─", "─", "─", "─", "─", "─", " ", " "),
	minimalHeavy: border("━", "━", "━", "━", "━", "━", " ", " "),
	minimalDouble: border("═", "═", "═", "═", "═", "═", " ", " "),
	horizontals: border(" ", " ", " ", " ", "─", "─", " ", " "),
	inner: border("▗", "▖", "▝", "▘", "▄", "▀", "▐", "▌"),
	outer: border("▛", "▜", "▙", "▟", "▀", "▄", "▌", "▐"),
	thick: border("█", "█", "█", "█", "▀", "▄", "█", "█"),
	block: border("▄", "▄", "▀", "▀", "▄", "▀", "█", "█"),
	hkey: border("▔", "▔", "▁", "▁", "▔", "▁", " ", " "),
	vkey: border("▏", "▕", "▏", "▕", " ", " ", "▏", "▕"),
	tall: border("▊", "▎", "▊", "▎", "▔", "▁", "▊", "▎"),
	panel: border("▊", "▎", "▊", "▎", "█", "▁", "▊", "▎"),
	tab: border("▁", "▁", "▔", "▔", "▁", "▔", "▎", "▊"),
	wide: border("▁", "▁", "▔", "▔", "▁", "▔", "▎", "▊"),
	hidden: border(" ", " ", " ", " ", " ", " ", " ", " "),
	blank: border(" ", " ", " ", " ", " ", " ", " ", " "),
};
// Where a split's line meets the border, by the families of styles that have the pieces: down from
// the top, up from the bottom, right from the left, left from the right. Others join with their
// own line.
const TEES = {
	single: ["┬", "┴", "├", "┤"],
	round: ["┬", "┴", "├", "┤"],
	dashed: ["┬", "┴", "├", "┤"],
	double: ["╦", "╩", "╠", "╣"],
	bold: ["┳", "┻", "┣", "┫"],
	heavy: ["┳", "┻", "┣", "┫"],
	dashedHeavy: ["┳", "┻", "┣", "┫"],
	classic: ["+", "+", "+", "+"],
	ascii: ["+", "+", "+", "+"],
	asciiDouble: ["+", "+", "+", "+"],
};
const bordersOf = (name) => BORDER_STYLES[name] ?? BORDER_STYLES.single;

// A focused element's focusColor, focusBold, ... replace its color, bold, ...; one with none of
// them shows inverted, except an input, whose caret shows it has focus.
const FOCUS_STYLE = {
	focusColor: "color",
	focusBackgroundColor: "backgroundColor",
	focusBold: "bold",
	focusInverse: "inverse",
	focusBorderColor: "borderColor",
};

function ownStyle(props, focused, isInput) {
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
function inherit(parent, props) {
	let out = parent;
	for (const name of TEXT_STYLE) {
		if (props[name] === undefined) continue;
		if (out === parent) out = { ...parent };
		out[name] = props[name];
	}
	return out;
}

const intersect = (a, b) => {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		x,
		y,
		w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
		h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
	};
};
const inClip = (clip, x, y) =>
	x >= clip.x && y >= clip.y && x < clip.x + clip.w && y < clip.y + clip.h;

function put(buffer, clip, x, y, char, style) {
	const w = graphemeWidth(char);
	if (w <= 0 || !inClip(clip, x, y) || !inClip(clip, x + w - 1, y)) return;
	buffer.writeChar(x, y, char, style);
}
function putString(buffer, clip, x, y, text, style, maxX) {
	let col = x;
	for (const g of graphemes(text)) {
		const w = graphemeWidth(g);
		if (w <= 0) continue;
		if (col + w > maxX) break;
		put(buffer, clip, col, y, g, style);
		col += w;
	}
	return col - x;
}

// A side's style: its own color (borderTopColor, ...) or borderColor, dimmed by its own
// borderDimTop, ... or borderDim.
function sideStyle(props, side) {
	const dim = props[`borderDim${side}`] ?? props.borderDim;
	return sgr({
		color: props[`border${side}Color`] ?? props.borderColor,
		backgroundColor: props.backgroundColor,
		dim,
	});
}

function paintBorder(buffer, clip, rect, props) {
	const chars = bordersOf(props.borderStyle);
	const { x, y, w, h } = rect;
	const styles = {
		top: sideStyle(props, "Top"),
		bottom: sideStyle(props, "Bottom"),
		left: sideStyle(props, "Left"),
		right: sideStyle(props, "Right"),
	};
	const top = props.borderTop !== false;
	const bottom = props.borderBottom !== false;
	const left = props.borderLeft !== false;
	const right = props.borderRight !== false;
	// Corners take the color of the side across them, top or bottom.
	if (top) {
		put(buffer, clip, x, y, left ? chars.tl : chars.t, styles.top);
		for (let i = 1; i < w - 1; i++) put(buffer, clip, x + i, y, chars.t, styles.top);
		if (w > 1) put(buffer, clip, x + w - 1, y, right ? chars.tr : chars.t, styles.top);
		// A title in the top border: borderText, aligned by borderTextAlign (center by default).
		if (props.borderText && w > 4) {
			const label = ` ${truncateText(stripControls(String(props.borderText)).replace(/\n/g, " "), w - 4, { ellipsis: "" })} `;
			const lw = stringWidth(label);
			const align = props.borderTextAlign ?? "center";
			const start =
				align === "left"
					? x + 1
					: align === "right"
						? x + Math.max(1, w - 1 - lw)
						: x + Math.max(1, Math.floor((w - lw) / 2));
			const labelStyle = sgr({
				color: props.borderTextColor ?? props.borderTopColor ?? props.borderColor,
				bold: props.borderTextBold === "true" || props.borderTextBold === true,
			});
			putString(buffer, clip, start, y, label, labelStyle, x + w - 1);
		}
	}
	for (let j = 1; j < h - 1; j++) {
		if (left) put(buffer, clip, x, y + j, chars.l, styles.left);
		if (right && w > 1) put(buffer, clip, x + w - 1, y + j, chars.r, styles.right);
	}
	if (bottom && h > 1) {
		put(buffer, clip, x, y + h - 1, left ? chars.bl : chars.b, styles.bottom);
		for (let i = 1; i < w - 1; i++) put(buffer, clip, x + i, y + h - 1, chars.b, styles.bottom);
		if (w > 1) put(buffer, clip, x + w - 1, y + h - 1, right ? chars.br : chars.b, styles.bottom);
	}
}

// A split box draws a line in the gap between each two children (across a row, down a column)
// that joins its border where it meets it.
function paintSplit(buffer, clip, layout, props) {
	const { rect, children } = layout;
	const chars = bordersOf(props.borderStyle);
	const tees = TEES[props.borderStyle] ?? (borderOf(props) ? TEES.single : null);
	const b = borderOf(props);
	const row = (props.flexDirection ?? "column").startsWith("row");
	const flow = children.filter((c) => c.node.props.position === undefined);
	for (let i = 1; i < flow.length; i++) {
		const prev = flow[i - 1].rect;
		const next = flow[i].rect;
		if (row) {
			const col = prev.x + prev.w + Math.floor((next.x - (prev.x + prev.w)) / 2);
			const style = sideStyle(props, "Left");
			for (let yy = rect.y + b; yy < rect.y + rect.h - b; yy++)
				put(buffer, clip, col, yy, chars.l, style);
			if (b && tees) {
				if (props.borderTop !== false)
					put(buffer, clip, col, rect.y, tees[0], sideStyle(props, "Top"));
				if (props.borderBottom !== false) {
					put(buffer, clip, col, rect.y + rect.h - 1, tees[1], sideStyle(props, "Bottom"));
				}
			}
		} else {
			const line = prev.y + prev.h + Math.floor((next.y - (prev.y + prev.h)) / 2);
			const style = sideStyle(props, "Top");
			for (let xx = rect.x + b; xx < rect.x + rect.w - b; xx++)
				put(buffer, clip, xx, line, chars.t, style);
			if (b && tees) {
				if (props.borderLeft !== false)
					put(buffer, clip, rect.x, line, tees[2], sideStyle(props, "Left"));
				if (props.borderRight !== false) {
					put(buffer, clip, rect.x + rect.w - 1, line, tees[3], sideStyle(props, "Right"));
				}
			}
		}
	}
}

// A divider: a line across its parent (down it in a row), of a border style's line (dividerStyle,
// single by default) or char, with an optional title in the middle of a horizontal one.
function paintDivider(buffer, clip, layout, text) {
	const { rect, node } = layout;
	const props = node.props;
	const chars = bordersOf(props.dividerStyle);
	const vertical = node.vertical === true;
	const char = props.char ? [...graphemes(String(props.char))][0] : vertical ? chars.l : chars.t;
	const style = sgr({ ...text, color: props.color ?? text.color, dim: props.dim ?? text.dim });
	if (vertical) {
		for (let j = 0; j < rect.h; j++) put(buffer, clip, rect.x, rect.y + j, char, style);
		return;
	}
	for (let i = 0; i < rect.w; i++) put(buffer, clip, rect.x + i, rect.y, char, style);
	if (props.title && rect.w > 4) {
		const label = ` ${truncateText(stripControls(String(props.title)).replace(/\n/g, " "), rect.w - 4, { ellipsis: "…" })} `;
		const start = rect.x + Math.max(1, Math.floor((rect.w - stringWidth(label)) / 2));
		const labelStyle = sgr({ ...text, color: props.titleColor ?? props.color ?? text.color });
		putString(buffer, clip, start, rect.y, label, labelStyle, rect.x + rect.w - 1);
	}
}

function paintText(buffer, clip, layout, text, focused) {
	const { x, y, w, h } = layout.rect;
	if (layout.node.input) return paintInput(buffer, clip, layout, text, focused);
	if (layout.node.spans) return paintSpans(buffer, clip, layout, text);
	const style = sgr(text);
	const lines = layout.lines ?? [];
	for (let i = 0; i < Math.min(lines.length, h); i++) {
		putString(buffer, clip, x, y + i, lines[i], style, x + w);
	}
}

// The span an offset of a text's content is in.
export const spanAt = (spans, at) => spans.find((s) => at >= s.start && at < s.end) ?? spans.at(-1);

// A text whose elements style parts of it: each segment of each row drawn grapheme by grapheme,
// in the style of the span it's from over the text's own.
function paintSpans(buffer, clip, layout, text) {
	const { x, y, w, h } = layout.rect;
	const { spans, props } = layout.node;
	const content = props.children;
	const styles = new Map();
	const styleOf = (span) => {
		let style = styles.get(span);
		if (style === undefined) {
			style = sgr(inherit(text, span.style));
			styles.set(span, style);
		}
		return style;
	};
	layout.rows.slice(0, h).forEach((row, i) => {
		let col = x;
		for (const seg of row) {
			if (seg.text !== undefined) {
				col += putString(buffer, clip, col, y + i, seg.text, styleOf(spanAt(spans, seg.at)), x + w);
				continue;
			}
			for (let at = seg.start; at < seg.end; ) {
				const g = readGrapheme(content, at);
				if (g === null) break;
				const gw = graphemeWidth(g.segment);
				if (col + gw > x + w) return;
				if (gw > 0) put(buffer, clip, col, y + i, g.segment, styleOf(spanAt(spans, at)));
				col += gw;
				at = g.end;
			}
		}
	});
}

// An input looks like a field: underlined across its width, so it shows where to type when
// it's empty too, unless it has a backgroundColor or underline of its own; its placeholder is dim
// and italic, a hint and not a value. underline "false" turns the line off.
function fieldStyle(style, props) {
	const out = { ...style };
	if (props.underline === "false") out.underline = false;
	else if (props.underline === undefined && props.backgroundColor === undefined)
		out.underline = true;
	return out;
}

// An input shows the columns of its value from its scrollLeft on, which a focused one moves to
// keep its caret in view, and its caret as an inverted cell: on the placeholder's first letter
// when it's empty.
function paintInput(buffer, clip, layout, text, focused) {
	const { x, y, w, h } = layout.rect;
	const { el, empty, multiline } = layout.node;
	if (w <= 0 || h <= 0) return;
	const fieldStyle = sgr(text);
	if (empty) {
		// The placeholder is dim and italic, on the first row; the field is the whole box.
		const hint = sgr({ ...text, dim: true, italic: true });
		putString(buffer, clip, x, y, padText(sliceColumns(layout.lines[0], 0, w), w), hint, x + w);
		for (let row = 1; row < h; row++)
			putString(buffer, clip, x, y + row, " ".repeat(w), fieldStyle, x + w);
		if (focused) invert(buffer, clip, x, y, text);
		return;
	}
	const value = el.value;
	const lines = linesOf(value, multiline);
	const shown = (line) => stripControls(value.slice(line.start, line.end)).replace(/\n/g, " ");
	const caretLine = lineIndexAt(lines, el.caret);
	const caretCol = columnIn(value, lines[caretLine], el.caret);
	let left = el.scrollLeft;
	let top = multiline ? el._scrollTop : 0;
	if (focused) {
		// Scrolled to keep the caret in view, and no further than there's text to show.
		if (caretCol < left) left = caretCol;
		if (caretCol >= left + w) left = caretCol - w + 1;
		left = Math.max(0, Math.min(left, stringWidth(shown(lines[caretLine])) - w + 1));
		if (caretLine < top) top = caretLine;
		if (caretLine >= top + h) top = caretLine - h + 1;
		top = Math.max(0, Math.min(top, lines.length - h));
		// View state, written past the setters: it needs no other paint.
		el._scrollLeft = left;
		el._scrollTop = top;
	}
	const [start, end] = [el.selectionStart, el.selectionEnd];
	for (let row = 0; row < h; row++) {
		const line = lines[top + row];
		const rowText = line ? shown(line) : "";
		putString(
			buffer,
			clip,
			x,
			y + row,
			padText(sliceColumns(rowText, left, left + w), w),
			fieldStyle,
			x + w,
		);
		if (!focused || !line || start === end) continue;
		// The selection on this row, inverted; a selected newline shows as one cell past the text.
		const from = Math.max(start, line.start);
		const to = Math.min(end, line.end);
		const pastEnd = end > line.end && start <= line.end;
		if (from > to || (from === to && !pastEnd)) continue;
		const a = columnIn(value, line, from) - left;
		const b = columnIn(value, line, to) - left + (pastEnd ? 1 : 0);
		for (let col = Math.max(0, a); col < Math.min(w, b); col++)
			invert(buffer, clip, x + col, y + row, text);
	}
	// The caret, when nothing is selected: an inverted cell, on what's under it.
	if (focused && start === end && caretLine >= top && caretLine < top + h) {
		invert(buffer, clip, x + caretCol - left, y + caretLine - top, text);
	}
}
// The cell at x, y drawn again inverted, without the field's underline.
function invert(buffer, clip, x, y, text) {
	const under = buffer.get(x, y);
	const char = under && !under.wide && under.char ? under.char : " ";
	put(buffer, clip, x, y, char, sgr({ ...text, underline: false, inverse: !text.inverse }));
}

// A scroll container with more than it shows draws a thumb on its right border (or in its right
// padding): as tall as the share it shows, as far down as it's scrolled.
function paintScrollbar(buffer, clip, el, rect, props) {
	const { scrollHeight, clientHeight, viewport } = el;
	if (!viewport || scrollHeight <= clientHeight || clientHeight <= 0) return;
	const pad = paddingOf(props);
	const b = borderOf(props);
	if (!(b && props.borderRight !== false) && pad.right < 1) return;
	const col = b && props.borderRight !== false ? rect.x + rect.w - 1 : viewport.x + viewport.w;
	const size = Math.max(1, Math.round((clientHeight * clientHeight) / scrollHeight));
	const at = Math.round((el.scrollTop / (scrollHeight - clientHeight)) * (clientHeight - size));
	const style = sgr({ color: props.borderColor, backgroundColor: props.backgroundColor });
	for (let i = 0; i < size; i++) put(buffer, clip, col, viewport.y + at + i, "┃", style);
}

// layout: the root, absolutized; focused: the element with focus, or null.
export function paint(
	buffer,
	layout,
	focused = null,
	text = {},
	clip = { x: 0, y: 0, w: buffer.width, h: buffer.height },
) {
	const { node, rect } = layout;
	const isFocused = focused !== null && node.el === focused && !node.texts;
	const props = ownStyle(node.props, isFocused, node.input === true);
	const style = inherit(text, props);
	if (node.type === "text") {
		return paintText(
			buffer,
			clip,
			layout,
			node.input ? fieldStyle(style, props) : style,
			isFocused,
		);
	}
	if (node.type === "divider") return paintDivider(buffer, clip, layout, style);
	if (node.type !== "box" || rect.w <= 0 || rect.h <= 0) return;
	const b = borderOf(props);
	if (props.backgroundColor !== undefined) {
		const fill = intersect(clip, {
			x: rect.x + b,
			y: rect.y + b,
			w: rect.w - 2 * b,
			h: rect.h - 2 * b,
		});
		const bg = sgr({ backgroundColor: props.backgroundColor });
		buffer.fill(fill.x, fill.y, fill.w, fill.h, " ", bg);
	}
	if (b) paintBorder(buffer, clip, rect, props);
	if (layout.scrollHeight !== undefined) paintScrollbar(buffer, clip, node.el, rect, props);
	const clips = clipsOf(props);
	let inner = clip;
	if (clips.x || clips.y) {
		const pad = paddingOf(props);
		const content = {
			x: rect.x + b + pad.left,
			y: rect.y + b + pad.top,
			w: rect.w - 2 * b - pad.left - pad.right,
			h: rect.h - 2 * b - pad.top - pad.bottom,
		};
		inner = intersect(clip, {
			x: clips.x ? content.x : clip.x,
			y: clips.y ? content.y : clip.y,
			w: clips.x ? content.w : clip.w,
			h: clips.y ? content.h : clip.h,
		});
	}
	for (const child of layout.children) paint(buffer, child, focused, style, inner);
	if (props.split !== undefined && props.split !== "false") paintSplit(buffer, clip, layout, props);
}

// The text style el's ancestors pass down to it, root first: where a layer starts from, since
// it isn't painted inside them.
export function inheritedStyleOf(el) {
	const chain = [];
	for (let n = el.parentNode; n !== null && n.nodeType === 1; n = n.parentNode) chain.unshift(n);
	return chain.reduce((style, n) => inherit(style, propsOf(n)), {});
}

// The root layout, then its layers over it, bottom to top.
export function paintScreen(buffer, layout, focused = null) {
	paint(buffer, layout, focused);
	for (const layer of layout.layers ?? []) {
		paint(buffer, layer, focused, layer.node.el ? inheritedStyleOf(layer.node.el) : {});
	}
}

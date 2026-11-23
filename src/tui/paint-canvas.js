// A painter (paint.js) that draws on a Canvas 2D context: the browser's, or any that implements
// it (Skia-backed ones in Node, OffscreenCanvas in a worker). What a terminal draws as characters
// it draws as what they are: a border's box drawing as lines (light, heavy, double, dashed,
// rounded corners) and its block elements as filled parts of their cells, so every border style
// (borders.js) has its look without depending on a font having the glyphs.
//
// It paints a layout in the metrics it was laid out in (metrics.js), scaled to pixels by scaleX
// and scaleY: in cells (cellMetrics, scaled by a cell's size; grid draws text a grapheme a cell,
// as a terminal does, and box drawing in text as lines too) or in pixels (fontMetrics measured on
// the same context, scale 1, text drawn as runs in a proportional font).
//
// Colors: the 16 named ones and 0-255 are the theme's palette (and the 256-color cube), #rrggbb
// is itself, and anything else is passed to the canvas as a CSS color. theme.fg and theme.bg are
// what text and the screen have without one.
import { bordersOf, TEES } from "./borders.js";
import { COLOR_NAMES, rgbOf256 } from "./buffer.js";
import { cellMetrics } from "./metrics.js";
import { inherit, intersect } from "./paint.js";
import { borderWidthOf, paddingOf, spanAt } from "./props.js";
import {
	columnIn,
	fitSegments,
	graphemes,
	graphemeWidth,
	lineIndexAt,
	linesOf,
	measureWidth,
	segmentsText,
	stripControls,
} from "./text.js";
import { DEFAULT_THEME } from "./theme.js";

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
// What text is drawn in: family, size (pixels) and lineHeight (a factor of size).
export const DEFAULT_TYPEFACE = Object.freeze({
	family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
	size: 13,
	lineHeight: 1.3,
});

// The CSS font of a typeface, in font ({ bold, italic }).
export const fontString = (typeface, font = {}) =>
	`${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${typeface.size}px ${typeface.family}`;

const truthy = (v) => v !== undefined && v !== false && v !== "false" && v !== "";

// A color as CSS, or null for none.
export function cssColor(color, theme = DEFAULT_THEME) {
	if (color == null || color === "" || color === false) return null;
	const named = COLOR_NAMES[color];
	if (named !== undefined) return theme.palette[named];
	if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) return color;
	const n = Number(color);
	if (Number.isInteger(n) && n >= 0 && n <= 255) {
		return n < 16 ? theme.palette[n] : hex(rgbOf256(n));
	}
	return String(color);
}

// --- glyphs ----------------------------------------------------------------------------------
// A box-drawing glyph as arms from its cell's center to its edges: left, right, up, down, each
// light (1), heavy (2) or double (3); arc for a rounded corner, dash for a dashed line.
const arms = (l, r, u, d, extra = {}) => ({ l, r, u, d, ...extra });
const LINES = {
	"─": arms(1, 1, 0, 0),
	"│": arms(0, 0, 1, 1),
	"━": arms(2, 2, 0, 0),
	"┃": arms(0, 0, 2, 2),
	"═": arms(3, 3, 0, 0),
	"║": arms(0, 0, 3, 3),
	"╌": arms(1, 1, 0, 0, { dash: true }),
	"╎": arms(0, 0, 1, 1, { dash: true }),
	"╍": arms(2, 2, 0, 0, { dash: true }),
	"╏": arms(0, 0, 2, 2, { dash: true }),
	"-": arms(1, 1, 0, 0),
	"|": arms(0, 0, 1, 1),
	"=": arms(3, 3, 0, 0),
	"┌": arms(0, 1, 0, 1),
	"┐": arms(1, 0, 0, 1),
	"└": arms(0, 1, 1, 0),
	"┘": arms(1, 0, 1, 0),
	"╭": arms(0, 1, 0, 1, { arc: true }),
	"╮": arms(1, 0, 0, 1, { arc: true }),
	"╰": arms(0, 1, 1, 0, { arc: true }),
	"╯": arms(1, 0, 1, 0, { arc: true }),
	"┏": arms(0, 2, 0, 2),
	"┓": arms(2, 0, 0, 2),
	"┗": arms(0, 2, 2, 0),
	"┛": arms(2, 0, 2, 0),
	"╔": arms(0, 3, 0, 3),
	"╗": arms(3, 0, 0, 3),
	"╚": arms(0, 3, 3, 0),
	"╝": arms(3, 0, 3, 0),
	"╓": arms(0, 1, 0, 3),
	"╖": arms(1, 0, 0, 3),
	"╙": arms(0, 1, 3, 0),
	"╜": arms(1, 0, 3, 0),
	"╒": arms(0, 3, 0, 1),
	"╕": arms(3, 0, 0, 1),
	"╘": arms(0, 3, 1, 0),
	"╛": arms(3, 0, 1, 0),
	"┎": arms(0, 1, 0, 2),
	"┒": arms(1, 0, 0, 2),
	"┍": arms(0, 2, 0, 1),
	"┑": arms(2, 0, 0, 1),
	"┕": arms(0, 2, 1, 0),
	"┙": arms(2, 0, 1, 0),
	"┬": arms(1, 1, 0, 1),
	"┴": arms(1, 1, 1, 0),
	"├": arms(0, 1, 1, 1),
	"┤": arms(1, 0, 1, 1),
	"┼": arms(1, 1, 1, 1),
	"╦": arms(3, 3, 0, 3),
	"╩": arms(3, 3, 3, 0),
	"╠": arms(0, 3, 3, 3),
	"╣": arms(3, 0, 3, 3),
	"┳": arms(2, 2, 0, 2),
	"┻": arms(2, 2, 2, 0),
	"┣": arms(0, 2, 2, 2),
	"┫": arms(2, 0, 2, 2),
	"+": arms(1, 1, 1, 1),
};
// A block element as the parts of its cell it fills: [x0, y0, x1, y1], fractions of the cell.
const BLOCKS = {
	"█": [[0, 0, 1, 1]],
	"▀": [[0, 0, 1, 0.5]],
	"▄": [[0, 0.5, 1, 1]],
	"▌": [[0, 0, 0.5, 1]],
	"▐": [[0.5, 0, 1, 1]],
	"▁": [[0, 0.875, 1, 1]],
	"▔": [[0, 0, 1, 0.125]],
	"▏": [[0, 0, 0.125, 1]],
	"▕": [[0.875, 0, 1, 1]],
	"▎": [[0, 0, 0.25, 1]],
	"▊": [[0, 0, 0.75, 1]],
	"▗": [[0.5, 0.5, 1, 1]],
	"▖": [[0, 0.5, 0.5, 1]],
	"▝": [[0.5, 0, 1, 0.5]],
	"▘": [[0, 0, 0.5, 0.5]],
	"▛": [
		[0, 0, 1, 0.5],
		[0, 0.5, 0.5, 1],
	],
	"▜": [
		[0, 0, 1, 0.5],
		[0.5, 0.5, 1, 1],
	],
	"▙": [
		[0, 0, 0.5, 0.5],
		[0, 0.5, 1, 1],
	],
	"▟": [
		[0.5, 0, 1, 0.5],
		[0, 0.5, 1, 1],
	],
};
// The corner each position of a border joins with when its character isn't box drawing (an
// arrow, a +): arms toward the box only.
const CORNERS = { tl: "┌", tr: "┐", bl: "└", br: "┘" };
const STRAIGHT = { across: "─", down: "│" };
// Whether a canvas draws g itself, rather than with the font: Unicode's box drawing and block
// elements it knows (not the ASCII a border style uses, which in text is text).
export const isDrawnGlyph = (g) =>
	g.length === 1 &&
	g >= "\u2500" &&
	g <= "\u259f" &&
	(LINES[g] !== undefined || BLOCKS[g] !== undefined);

// What a border character at a position draws: itself when it's box drawing or a block, nothing
// for a space, and otherwise (an arrow, a + in a corner) the plain line or corner it stands for.
function glyphAt(g, position) {
	if (g === " " || g === "") return null;
	if (BLOCKS[g] !== undefined) return g;
	const line = LINES[g];
	if (line !== undefined && !(g === "+" && CORNERS[position])) return g;
	return CORNERS[position] ?? STRAIGHT[position];
}

// A box's border sides, for a layout made without them.
const bordersOfLayout = (m) => ({
	top: m.borderY,
	bottom: m.borderY,
	left: m.borderX,
	right: m.borderX,
});

// --- the painter -----------------------------------------------------------------------------

export { DEFAULT_THEME };

export class CanvasPainter {
	// context: a CanvasRenderingContext2D; width and height: what it shows, in layout units;
	// metrics: the ones the layout is in; scaleX, scaleY: pixels per layout unit; grid: whether
	// text is drawn a grapheme a cell (cells by default); typeface and theme as above.
	constructor(
		context,
		{
			width,
			height,
			metrics = cellMetrics,
			scaleX = 1,
			scaleY = 1,
			grid = metrics === cellMetrics,
			typeface = DEFAULT_TYPEFACE,
			theme = DEFAULT_THEME,
			pixelRatio = 1,
		} = {},
	) {
		this.context = context;
		this.metrics = metrics;
		this.sx = scaleX;
		this.sy = scaleY;
		this.grid = grid;
		this.typeface = typeface;
		this.theme = theme;
		this.pixelRatio = pixelRatio;
		this.bounds = { x: 0, y: 0, w: width, h: height };
		// The line width box drawing has, and how far apart a double line's two are.
		const cell = Math.min(metrics.borderX * scaleX, metrics.borderY * scaleY);
		this.lineWidth = Math.max(1, Math.round(cell / 8));
		this.gap = Math.max(this.lineWidth * 1.5, cell / 4);
	}
	// Clears what it shows to the theme's background.
	begin() {
		const ctx = this.context;
		const r = this.pixelRatio;
		ctx.setTransform?.(r, 0, 0, r, 0, 0);
		if ("fontKerning" in ctx) ctx.fontKerning = "none"; // So text measures as layout summed it.
		ctx.textBaseline = "middle";
		ctx.textAlign = "left";
		ctx.globalAlpha = 1;
		ctx.fillStyle = this.theme.bg;
		ctx.fillRect(0, 0, this.bounds.w * this.sx, this.bounds.h * this.sy);
		return this;
	}

	// --- helpers, in layout units --------------------------------------------------------
	px(r) {
		return { x: r.x * this.sx, y: r.y * this.sy, w: r.w * this.sx, h: r.h * this.sy };
	}
	clipped(clip, draw) {
		if (!(clip.w > 0 && clip.h > 0)) return;
		const ctx = this.context;
		const c = this.px(clip);
		ctx.save();
		ctx.beginPath();
		ctx.rect(c.x, c.y, c.w, c.h);
		ctx.clip();
		try {
			draw();
		} finally {
			ctx.restore();
		}
	}
	color(c, fallback = this.theme.fg) {
		return cssColor(c, this.theme) ?? fallback;
	}
	// The colors text in style is drawn with: { fg, bg } (bg null for none), inverse swapped.
	colorsOf(style) {
		let fg = this.color(style.color);
		let bg = cssColor(style.backgroundColor, this.theme);
		if (truthy(style.inverse)) [fg, bg] = [bg ?? this.theme.bg, fg];
		return { fg, bg };
	}
	fill(r, color) {
		const ctx = this.context;
		const p = this.px(r);
		ctx.fillStyle = color;
		ctx.fillRect(p.x, p.y, p.w, p.h);
	}

	// Draws g in r (layout units), stretched to it: a box-drawing glyph's arms from r's center
	// to its edges, a block's parts of r.
	glyph(g, r, color, dim = false) {
		const ctx = this.context;
		const p = this.px(r);
		ctx.globalAlpha = dim ? 0.5 : 1;
		const block = BLOCKS[g];
		if (block !== undefined) {
			ctx.fillStyle = color;
			for (const [x0, y0, x1, y1] of block) {
				ctx.fillRect(p.x + x0 * p.w, p.y + y0 * p.h, (x1 - x0) * p.w, (y1 - y0) * p.h);
			}
			ctx.globalAlpha = 1;
			return;
		}
		const a = LINES[g];
		if (a === undefined) return;
		const lw = this.lineWidth;
		const d = this.gap;
		// Centers snapped so a thin line is crisp.
		const snap = (v, w) => (Math.round(w) % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v));
		const cx = snap(p.x + p.w / 2, lw);
		const cy = snap(p.y + p.h / 2, lw);
		const x1 = p.x + p.w;
		const y1 = p.y + p.h;
		ctx.strokeStyle = color;
		ctx.lineCap = "butt";
		ctx.setLineDash?.(a.dash ? [lw * 3, lw * 2] : []);
		const width = (w) => (w === 2 ? lw * 2 : lw);
		// How far an arm across reaches into the center past the arms down, and the other way.
		const reach = (one, other) => {
			const w = Math.max(one, other);
			return w === 0 ? 0 : w === 3 ? d + lw / 2 : width(w) / 2;
		};
		const line = (w, ax, ay, bx, by) => {
			ctx.lineWidth = width(w);
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.stroke();
		};
		if (a.arc) {
			// A light corner, rounded: from the arm across to the arm down.
			const toX = a.r ? x1 : p.x;
			const toY = a.d ? y1 : p.y;
			const r = Math.max(0, Math.min(Math.abs(toX - cx), Math.abs(toY - cy)));
			ctx.lineWidth = lw;
			ctx.beginPath();
			ctx.moveTo(toX, cy);
			ctx.arcTo(cx, cy, cx, toY, r);
			ctx.lineTo(cx, toY);
			ctx.stroke();
			ctx.globalAlpha = 1;
			return;
		}
		// An arm across: one line, or a double's two, each stopped where the arms down meet it.
		const across = (w, edge, dir) => {
			if (w === 0) return;
			const v = reach(a.u, a.d);
			if (w !== 3) {
				const from = a.u || a.d ? cx - dir * v : cx;
				return line(w, from, cy, edge, cy);
			}
			for (const side of [-1, 1]) {
				const same = side < 0 ? a.u : a.d;
				const any = a.u || a.d;
				const dv = (arm) => (arm === 3 ? d : width(arm) / 2);
				const from = same ? cx + dir * dv(same) : any ? cx - dir * dv(a.u || a.d) : cx;
				line(1, from, cy + side * d, edge, cy + side * d);
			}
		};
		const down = (w, edge, dir) => {
			if (w === 0) return;
			const v = reach(a.l, a.r);
			if (w !== 3) {
				const from = a.l || a.r ? cy - dir * v : cy;
				return line(w, cx, from, cx, edge);
			}
			for (const side of [-1, 1]) {
				const same = side < 0 ? a.l : a.r;
				const any = a.l || a.r;
				const dv = (arm) => (arm === 3 ? d : width(arm) / 2);
				const from = same ? cy + dir * dv(same) : any ? cy - dir * dv(a.l || a.r) : cy;
				line(1, cx + side * d, from, cx + side * d, edge);
			}
		};
		across(a.l, p.x, -1);
		across(a.r, x1, 1);
		down(a.u, p.y, -1);
		down(a.d, y1, 1);
		ctx.setLineDash?.([]);
		ctx.globalAlpha = 1;
	}

	// A run of text at x, y (layout units, the top of its line) in style, measured by measure
	// (text.js's; cells without one) from offset at of its text: its background, its glyphs and
	// its lines. fill, when given, is how wide its background and underline go (an input's field).
	// Returns how wide it is.
	run(x, y, text, style, measure, fill = undefined) {
		const ctx = this.context;
		const m = this.metrics;
		const w = measureWidth(text, measure);
		const { fg, bg } = this.colorsOf(style);
		const top = y * this.sy;
		const h = m.lineHeight * this.sy;
		const spread = Math.max(w, fill ?? 0) * this.sx;
		if (bg !== null) {
			ctx.fillStyle = bg;
			ctx.fillRect(x * this.sx, top, spread, h);
		}
		const bold = truthy(style.bold);
		const italic = truthy(style.italic);
		ctx.font = fontString(this.typeface, { bold, italic });
		ctx.fillStyle = fg;
		ctx.globalAlpha = truthy(style.dim) ? 0.6 : 1;
		const mid = top + h / 2;
		if (this.grid) {
			let col = x;
			for (const g of graphemes(text)) {
				const gw = graphemeWidth(g);
				if (gw <= 0) continue;
				if (g !== " ") {
					if (isDrawnGlyph(g)) {
						this.glyph(g, { x: col, y, w: gw, h: m.lineHeight }, fg, truthy(style.dim));
						ctx.globalAlpha = truthy(style.dim) ? 0.6 : 1;
					} else ctx.fillText(g, col * this.sx, mid);
				}
				col += gw;
			}
		} else if (text !== "") ctx.fillText(text, x * this.sx, mid);
		const underline = style.underline;
		if (truthy(underline) || truthy(style.strikethrough)) {
			ctx.strokeStyle = fg;
			ctx.lineWidth = Math.max(1, Math.round(this.typeface.size / 14));
			const x0 = x * this.sx;
			const stroke = (yy, dash = []) => {
				ctx.setLineDash?.(dash);
				ctx.beginPath();
				ctx.moveTo(x0, yy);
				ctx.lineTo(x0 + spread, yy);
				ctx.stroke();
			};
			if (truthy(underline)) {
				const base = top + h * 0.5 + this.typeface.size * 0.6;
				const kind = String(underline);
				if (kind === "double") {
					stroke(base - 1);
					stroke(base + 1.5);
				} else if (kind === "dotted") stroke(base, [1, 2]);
				else if (kind === "dashed") stroke(base, [4, 3]);
				else if (kind === "curly") {
					ctx.setLineDash?.([]);
					ctx.beginPath();
					for (let i = 0; i <= spread; i += 2) {
						const yy = base + Math.sin(i / 2) * 1.5;
						if (i === 0) ctx.moveTo(x0 + i, yy);
						else ctx.lineTo(x0 + i, yy);
					}
					ctx.stroke();
				} else stroke(base);
			}
			if (truthy(style.strikethrough)) stroke(mid);
			ctx.setLineDash?.([]);
		}
		ctx.globalAlpha = 1;
		return w;
	}
	// text cut to fit room (layout units) with an ellipsis, as a label in a border or a divider.
	label(text, room, measure, ellipsis = "…") {
		const clean = stripControls(String(text)).replace(/\n/g, " ");
		const [row] = fitSegments(clean, room, "truncate", measure);
		const fitted = segmentsText(clean, row);
		return ellipsis === "" && fitted !== clean ? fitted.replace(/…$/, "") : fitted;
	}
	labelMeasure(font) {
		return this.metrics.measureOf({ font });
	}

	// --- what paint.js asks of a painter -------------------------------------------------
	box(layout, props, style, clip) {
		this.clipped(clip, () => {
			const { rect } = layout;
			if (props.backgroundColor !== undefined) this.fill(rect, this.color(props.backgroundColor));
			if (borderWidthOf(props)) this.border(layout, props, style);
			if (layout.scrollHeight !== undefined) this.scrollbar(layout, props);
		});
	}
	// A side's color and dimming: its own (borderTopColor, borderDimTop, ...) or borderColor's.
	side(props, side) {
		return {
			color: this.color(props[`border${side}Color`] ?? props.borderColor),
			dim: truthy(props[`borderDim${side}`] ?? props.borderDim),
		};
	}
	// A border as a terminal draws it, its corners, sides and title, each part what its
	// character is: corners take the color of the side across them, top or bottom.
	border(layout, props, style) {
		const { rect } = layout;
		const sides = layout.border ?? bordersOfLayout(this.metrics);
		const chars = bordersOf(props.borderStyle);
		const { x, y, w, h } = rect;
		const bx = Math.min(sides.left, w);
		const bt = Math.min(sides.top, h);
		const by = Math.min(sides.bottom, h);
		const top = props.borderTop !== false;
		const bottom = props.borderBottom !== false;
		const left = props.borderLeft !== false;
		const right = props.borderRight !== false;
		const draw = (g, position, r, side) => {
			const glyph = glyphAt(g, position);
			if (glyph === null || !(r.w > 0 && r.h > 0)) return;
			const { color, dim } = this.side(props, side);
			this.glyph(glyph, r, color, dim);
		};
		const innerW = { x: x + bx, w: w - 2 * bx };
		const innerH = { y: y + bt, h: h - bt - by };
		if (top) {
			draw(left ? chars.tl : chars.t, left ? "tl" : "across", { x, y, w: bx, h: bt }, "Top");
			draw(chars.t, "across", { ...innerW, y, h: bt }, "Top");
			if (w > bx) {
				const r = { x: x + w - bx, y, w: bx, h: bt };
				draw(right ? chars.tr : chars.t, right ? "tr" : "across", r, "Top");
			}
			if (props.borderText) this.title(rect, bt, props, style);
		}
		if (left) draw(chars.l, "down", { x, ...innerH, w: bx }, "Left");
		if (right && w > bx) draw(chars.r, "down", { x: x + w - bx, ...innerH, w: bx }, "Right");
		if (bottom && h > by) {
			const yb = y + h - by;
			draw(left ? chars.bl : chars.b, left ? "bl" : "across", { x, y: yb, w: bx, h: by }, "Bottom");
			draw(chars.b, "across", { ...innerW, y: yb, h: by }, "Bottom");
			if (w > bx) {
				const r = { x: x + w - bx, y: yb, w: bx, h: by };
				draw(right ? chars.br : chars.b, right ? "br" : "across", r, "Bottom");
			}
		}
	}
	// A title in the top border: borderText, aligned by borderTextAlign (center by default), over
	// the line, centered on it.
	title(rect, band, props, style) {
		const m = this.metrics;
		const { x, y, w } = rect;
		if (w <= 4 * m.unitX) return;
		const bold = props.borderTextBold === "true" || props.borderTextBold === true;
		const measure = this.labelMeasure({ bold, italic: false });
		const text = ` ${this.label(props.borderText, w - 4 * m.unitX, measure, "")} `;
		const lw = measureWidth(text, measure);
		const align = props.borderTextAlign ?? "center";
		const start =
			align === "left"
				? x + m.borderX
				: align === "right"
					? x + Math.max(m.borderX, w - m.borderX - lw)
					: x + Math.max(m.borderX, Math.floor((w - lw) / 2));
		const ty = y + band / 2 - m.lineHeight / 2;
		const bg = props.backgroundColor ?? style.backgroundColor;
		this.fill({ x: start, y: ty, w: lw, h: m.lineHeight }, this.color(bg, this.theme.bg));
		this.run(
			start,
			ty,
			text,
			{
				color: props.borderTextColor ?? props.borderTopColor ?? props.borderColor,
				bold,
			},
			measure,
		);
	}
	// The thumb of a scroll container with more than it shows, on its right border (or in its
	// right padding): as tall as the share it shows, as far down as it's scrolled.
	scrollbar(layout, props) {
		const m = this.metrics;
		const { el } = layout.node;
		const { rect } = layout;
		const { scrollHeight, clientHeight, viewport } = el;
		if (!viewport || scrollHeight <= clientHeight || clientHeight <= 0) return;
		const pad = paddingOf(props);
		const onBorder = borderWidthOf(props) && props.borderRight !== false;
		if (!onBorder && pad.right < 1) return;
		const band = onBorder
			? {
					x: rect.x + rect.w - (layout.border?.right ?? m.borderX),
					w: layout.border?.right ?? m.borderX,
				}
			: { x: viewport.x + viewport.w, w: Math.min(pad.right, m.unitX) };
		const size = Math.max(m.lineHeight, Math.round((clientHeight * clientHeight) / scrollHeight));
		const at = Math.round((el.scrollTop / (scrollHeight - clientHeight)) * (clientHeight - size));
		const ctx = this.context;
		const p = this.px({ x: band.x, y: viewport.y + at, w: band.w, h: size });
		const tw = Math.max(2, Math.round(p.w * 0.5));
		ctx.fillStyle = this.color(props.borderColor);
		ctx.beginPath();
		const tx = p.x + (p.w - tw) / 2;
		if (ctx.roundRect) ctx.roundRect(tx, p.y, tw, p.h, tw / 2);
		else ctx.rect(tx, p.y, tw, p.h);
		ctx.fill();
	}
	// A split box's lines, in the gap between each two children, joining its border with its
	// tees: down a row, across a column.
	split(layout, props, clip) {
		this.clipped(clip, () => {
			const m = this.metrics;
			const { rect, children } = layout;
			const chars = bordersOf(props.borderStyle);
			const b = borderWidthOf(props);
			const tees = TEES[props.borderStyle] ?? (b ? TEES.single : null);
			const sides = layout.border ?? bordersOfLayout(m);
			const bx = b * sides.left;
			const bt = b * sides.top;
			const by = b * sides.bottom;
			const row = (props.flexDirection ?? "column").startsWith("row");
			const flow = children.filter((c) => c.node.props.position === undefined);
			const draw = (g, position, r, side) => {
				const glyph = glyphAt(g, position);
				if (glyph === null || !(r.w > 0 && r.h > 0)) return;
				const { color, dim } = this.side(props, side);
				this.glyph(glyph, r, color, dim);
			};
			for (let i = 1; i < flow.length; i++) {
				const prev = flow[i - 1].rect;
				const next = flow[i].rect;
				if (row) {
					const gap = next.x - (prev.x + prev.w);
					const col = prev.x + prev.w + Math.floor((gap - m.ruleX) / 2);
					const strip = { x: col, w: m.ruleX };
					draw(chars.l, "down", { ...strip, y: rect.y + bt, h: rect.h - bt - by }, "Left");
					if (b && tees) {
						if (props.borderTop !== false)
							draw(tees[0], "tee", { ...strip, y: rect.y, h: bt }, "Top");
						if (props.borderBottom !== false) {
							draw(tees[1], "tee", { ...strip, y: rect.y + rect.h - by, h: by }, "Bottom");
						}
					}
				} else {
					const gap = next.y - (prev.y + prev.h);
					const line = prev.y + prev.h + Math.floor((gap - m.ruleY) / 2);
					const strip = { y: line, h: m.ruleY };
					draw(chars.t, "across", { ...strip, x: rect.x + bx, w: rect.w - 2 * bx }, "Top");
					if (b && tees) {
						if (props.borderLeft !== false)
							draw(tees[2], "tee", { ...strip, x: rect.x, w: bx }, "Left");
						if (props.borderRight !== false) {
							draw(tees[3], "tee", { ...strip, x: rect.x + rect.w - bx, w: bx }, "Right");
						}
					}
				}
			}
		});
	}
	// A divider: a line across its parent (down it in a row), of a border style's line
	// (dividerStyle, single by default) or char, with an optional title in the middle.
	divider(layout, text, clip) {
		this.clipped(clip, () => {
			const m = this.metrics;
			const { rect, node } = layout;
			const props = node.props;
			const chars = bordersOf(props.dividerStyle);
			const vertical = node.vertical === true;
			const style = { ...text, color: props.color ?? text.color, dim: props.dim ?? text.dim };
			const color = this.color(style.color);
			const char = props.char ? [...graphemes(String(props.char))][0] : null;
			const g = char ?? (vertical ? chars.l : chars.t);
			if (char === null || isDrawnGlyph(char)) {
				this.glyph(glyphAt(g, vertical ? "down" : "across") ?? g, rect, color, truthy(style.dim));
			} else {
				// Any other character, repeated along it as text.
				const measure = this.metrics.measureOf({ font: { bold: !!style.bold } });
				const step = Math.max(1e-6, measureWidth(char, measure));
				if (vertical) {
					for (let yy = rect.y; yy < rect.y + rect.h; yy += m.lineHeight)
						this.run(rect.x, yy, char, style, measure);
				} else {
					const n = Math.floor(rect.w / step);
					this.run(rect.x, rect.y, char.repeat(n), style, measure);
				}
			}
			if (!vertical && props.title && rect.w > 4 * m.unitX) {
				const measure = this.labelMeasure({ bold: !!style.bold });
				const label = ` ${this.label(props.title, rect.w - 4 * m.unitX, measure)} `;
				const lw = measureWidth(label, measure);
				const start = rect.x + Math.max(m.unitX, Math.floor((rect.w - lw) / 2));
				const ty = rect.y + (rect.h - m.lineHeight) / 2;
				this.fill(
					{ x: start, y: ty, w: lw, h: m.lineHeight },
					this.color(text.backgroundColor, this.theme.bg),
				);
				this.run(
					start,
					ty,
					label,
					{ ...text, color: props.titleColor ?? props.color ?? text.color },
					measure,
				);
			}
		});
	}
	// A text's rows, each segment in the style of the span it's from over the text's own.
	text(layout, style, clip) {
		const { rect, node } = layout;
		this.clipped(intersect(clip, rect), () => {
			const m = this.metrics;
			const measure = m.measureOf(node);
			const rows = layout.rows ?? (layout.lines ?? []).map((l) => [{ text: l, at: 0 }]);
			const count = Math.min(rows.length, Math.floor(rect.h / m.lineHeight));
			const content = node.props.children ?? "";
			const { spans } = node;
			const styles = new Map();
			const styleAt = (at) => {
				if (!spans) return style;
				const span = spanAt(spans, at);
				let s = styles.get(span);
				if (s === undefined) {
					s = inherit(style, span.style);
					styles.set(span, s);
				}
				return s;
			};
			for (let i = 0; i < count; i++) {
				let col = rect.x;
				const y = rect.y + i * m.lineHeight;
				for (const seg of rows[i]) {
					if (seg.text !== undefined) {
						const at = seg.at;
						col += this.run(col, y, seg.text, styleAt(at), measure && ((g) => measure(g, at)));
						continue;
					}
					// A range, a run per span it crosses.
					let from = seg.start;
					while (from < seg.end) {
						const span = spans ? spanAt(spans, from) : null;
						const to = span ? Math.min(seg.end, Math.max(span.end, from + 1)) : seg.end;
						const piece = content.slice(from, to);
						const base = from;
						col += this.run(
							col,
							y,
							piece,
							styleAt(from),
							measure && ((g, at) => measure(g, base + at)),
						);
						from = to;
					}
				}
			}
		});
	}
	// An input's or textarea's value from its scroll on, which a focused one moves to keep its
	// caret in view, and its caret (m.caret wide) and selection shown inverted; its placeholder
	// dim and italic when empty.
	input(layout, style, focused, clip) {
		const { rect, node } = layout;
		const { el, empty, multiline } = node;
		const m = this.metrics;
		if (rect.w <= 0 || rect.h <= 0) return;
		const measure = m.measureOf(node);
		const lh = m.lineHeight;
		const shownRows = Math.max(1, Math.floor(rect.h / lh));
		const { x, y, w } = rect;
		const inverted = { ...style, underline: false, inverse: !truthy(style.inverse) };
		this.clipped(intersect(clip, rect), () => {
			// What's drawn inverted over [from, to) of a row: the selection, or the caret.
			const invert = (row, from, to, draw) => {
				const r = { x: x + from, y: y + row * lh, w: to - from, h: lh };
				this.clipped(intersect(intersect(clip, rect), r), () => draw(inverted));
			};
			if (empty) {
				const hint = { ...style, dim: true, italic: true };
				this.run(x, y, layout.lines[0] ?? "", hint, measure, w);
				for (let row = 1; row < shownRows; row++) this.run(x, y + row * lh, "", style, measure, w);
				if (focused)
					invert(0, 0, m.caret, (s) => this.run(x, y, layout.lines[0] ?? "", s, measure, w));
				return;
			}
			const value = el.value;
			const lines = linesOf(value, multiline);
			const shown = (line) => stripControls(value.slice(line.start, line.end)).replace(/\n/g, " ");
			const caretLine = lineIndexAt(lines, el.caret);
			const caretX = columnIn(value, lines[caretLine], el.caret, measure);
			let left = el.scrollLeft;
			let top = multiline ? el.scrollTop : 0;
			if (focused) {
				// Scrolled to keep the caret in view, and no further than there's text to show.
				if (caretX < left) left = caretX;
				if (caretX + m.caret > left + w) left = caretX + m.caret - w;
				const widest = measureWidth(shown(lines[caretLine]), measure);
				left = Math.max(0, Math.min(left, widest + m.caret - w));
				if (caretLine < top) top = caretLine;
				if (caretLine >= top + shownRows) top = caretLine - shownRows + 1;
				top = Math.max(0, Math.min(top, lines.length - shownRows));
				el.settleScroll({ left, top });
			}
			const [start, end] = [el.selectionStart, el.selectionEnd];
			for (let row = 0; row < shownRows; row++) {
				const line = lines[top + row];
				const text = line ? shown(line) : "";
				const ry = y + row * lh;
				const draw = (s) => this.run(x - left, ry, text, s, measure, w + left);
				draw(style);
				if (!focused || !line || start === end) continue;
				const from = Math.max(start, line.start);
				const to = Math.min(end, line.end);
				const pastEnd = end > line.end && start <= line.end;
				if (from > to || (from === to && !pastEnd)) continue;
				const a = columnIn(value, line, from, measure) - left;
				const b = columnIn(value, line, to, measure) - left + (pastEnd ? m.caret : 0);
				invert(row, Math.max(0, a), Math.min(w, b), draw);
			}
			if (focused && start === end && caretLine >= top && caretLine < top + shownRows) {
				const row = caretLine - top;
				const text = shown(lines[caretLine]);
				const at = caretX - left;
				invert(row, at, at + m.caret, (s) =>
					this.run(x - left, y + row * lh, text, s, measure, w + left),
				);
			}
		});
	}
}

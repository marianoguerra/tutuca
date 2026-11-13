// A grid of terminal cells, the diff between two of them and the ANSI that draws it. Ported from
// tuiuiu.js (core/buffer.ts; MIT, see LICENSE.tuiuiu). A cell's style is its SGR parameters as
// one string ("1;36", "" for none), worked out once per style by sgr(), so two cells are equal
// when their char, style and wide flag are; tuiuiu compares structured colors and attrs instead.
import { graphemes, graphemeWidth, stringWidth } from "./text.js";

const NAMED = {
	black: 0,
	red: 1,
	green: 2,
	yellow: 3,
	blue: 4,
	magenta: 5,
	cyan: 6,
	white: 7,
	gray: 8,
	grey: 8,
	blackBright: 8,
	redBright: 9,
	greenBright: 10,
	yellowBright: 11,
	blueBright: 12,
	magentaBright: 13,
	cyanBright: 14,
	whiteBright: 15,
};
const UNDERLINES = { single: "4:1", double: "4:2", curly: "4:3", dotted: "4:4", dashed: "4:5" };
const MAX_CELLS = 4_000_000;

// The SGR parameters of a color: a name above, #rrggbb or 0-255 (the 256-color palette).
export function colorToSgr(color, background = false) {
	if (color == null || color === "") return "";
	const n = NAMED[color];
	if (n !== undefined) return String((background ? 40 : 30) + (n < 8 ? n : n + 52));
	const code = background ? 48 : 38;
	if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
		const v = (i) => parseInt(color.slice(i, i + 2), 16);
		return `${code};2;${v(1)};${v(3)};${v(5)}`;
	}
	const i = Number(color);
	if (Number.isInteger(i) && i >= 0 && i <= 255) return `${code};5;${i}`;
	return "";
}

const sgrCache = new Map();
// The style string of { color, backgroundColor, bold, dim, italic, underline, inverse,
// strikethrough }: the SGR parameters joined with ;.
export function sgr(style) {
	const { color, backgroundColor, bold, dim, italic, underline, inverse, strikethrough } = style;
	const key = `${color}|${backgroundColor}|${+!!bold}${+!!dim}${+!!italic}${underline || 0}${+!!inverse}${+!!strikethrough}`;
	let out = sgrCache.get(key);
	if (out !== undefined) return out;
	const codes = [];
	if (bold) codes.push("1");
	if (dim) codes.push("2");
	if (italic) codes.push("3");
	if (underline) codes.push(UNDERLINES[underline] ?? "4");
	if (inverse) codes.push("7");
	if (strikethrough) codes.push("9");
	const fg = colorToSgr(color);
	const bg = colorToSgr(backgroundColor, true);
	if (fg) codes.push(fg);
	if (bg) codes.push(bg);
	out = codes.join(";");
	if (sgrCache.size >= 512) sgrCache.delete(sgrCache.keys().next().value);
	sgrCache.set(key, out);
	return out;
}

const EMPTY = Object.freeze({ char: " ", style: "", wide: false });
// wide marks the cell right of a two-cell grapheme: it holds nothing and draws nothing.
const cell = (char, style, wide = false) => ({ char, style, wide });
const cellEquals = (a, b) => a.char === b.char && a.style === b.style && a.wide === b.wide;

export class CellBuffer {
	constructor(width, height) {
		if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) {
			throw new RangeError("CellBuffer dimensions must be non-negative integers");
		}
		if (width * height > MAX_CELLS)
			throw new RangeError(`CellBuffer holds at most ${MAX_CELLS} cells`);
		this.width = width;
		this.height = height;
		this.rows = Array.from({ length: height }, () => new Array(width).fill(EMPTY));
		this.signatures = new Array(height).fill(null);
	}
	inside(x, y) {
		return (
			Number.isInteger(x) &&
			Number.isInteger(y) &&
			x >= 0 &&
			y >= 0 &&
			x < this.width &&
			y < this.height
		);
	}
	get(x, y) {
		return this.inside(x, y) ? this.rows[y][x] : undefined;
	}
	// Clears both halves of a wide grapheme when either is overwritten: a half never stays.
	clearWide(x, y) {
		if (!this.inside(x, y)) return;
		const row = this.rows[y];
		const c = row[x];
		if (c.wide) {
			row[x] = EMPTY;
			if (x > 0 && !row[x - 1].wide && stringWidth(row[x - 1].char) > 1) row[x - 1] = EMPTY;
			return;
		}
		const w = stringWidth(c.char);
		if (w <= 1) return;
		row[x] = EMPTY;
		for (let i = 1; i < w && x + i < this.width; i++) if (row[x + i].wide) row[x + i] = EMPTY;
	}
	// One grapheme at x, y; a wide one also takes the cell to its right, and is dropped when
	// that cell is past the edge.
	writeChar(x, y, char, style = "") {
		if (!this.inside(x, y)) return;
		const w = graphemeWidth(char);
		if (w <= 0 || x + w > this.width) return;
		for (let i = 0; i < w; i++) this.clearWide(x + i, y);
		this.rows[y][x] = cell(char, style);
		if (w === 2) this.rows[y][x + 1] = cell("", style, true);
		this.signatures[y] = null;
	}
	// text from x on row y, up to maxX (the buffer's width by default); returns the columns used.
	writeString(x, y, text, style = "", maxX = this.width) {
		if (!Number.isInteger(x) || !Number.isInteger(y)) return 0;
		let col = x;
		const end = Math.min(maxX, this.width);
		for (const g of graphemes(text)) {
			if (g === "\n") continue;
			const w = graphemeWidth(g);
			if (w <= 0) continue;
			if (col + w > end) break;
			if (col >= 0) this.writeChar(col, y, g, style);
			col += w;
		}
		return col - x;
	}
	fill(x, y, width, height, char = " ", style = "") {
		const x1 = Math.max(0, x);
		const y1 = Math.max(0, y);
		const x2 = Math.min(this.width, x + width);
		const y2 = Math.min(this.height, y + height);
		const w = graphemeWidth(char);
		for (let row = y1; row < y2; row++) {
			if (w === 1) {
				for (let col = x1; col < x2; col++) {
					this.clearWide(col, row);
					this.rows[row][col] = cell(char, style);
				}
				this.signatures[row] = null;
			} else if (w > 1) {
				for (let col = x1; col + w <= x2; col += w) this.writeChar(col, row, char, style);
			}
		}
	}
	clear() {
		for (let y = 0; y < this.height; y++) {
			this.rows[y].fill(EMPTY);
			this.signatures[y] = null;
		}
	}
	// What a row holds as one string, so equal rows are skipped with one comparison.
	signature(y) {
		let s = this.signatures[y];
		if (s !== null) return s;
		s = "";
		for (const c of this.rows[y]) s += `${c.char}\u0001${c.wide ? 1 : 0}${c.style}\u0002`;
		this.signatures[y] = s;
		return s;
	}
	// The cells of target that differ from this buffer, as [{ x, y, cell }], row by row.
	diff(target) {
		const patches = [];
		const maxX = Math.min(this.width, target.width);
		const maxY = Math.min(this.height, target.height);
		for (let y = 0; y < maxY; y++) {
			if (this.signature(y) === target.signature(y)) continue;
			const a = this.rows[y];
			const b = target.rows[y];
			for (let x = 0; x < maxX; x++)
				if (!cellEquals(a[x], b[x])) patches.push({ x, y, cell: b[x] });
		}
		return patches;
	}
	// The text of the buffer, without styles, its trailing blanks trimmed: for tests and logs.
	toString() {
		const lines = this.rows.map((row) =>
			row
				.filter((c) => !c.wide)
				.map((c) => c.char)
				.join("")
				.trimEnd(),
		);
		while (lines.length > 0 && lines.at(-1) === "") lines.pop();
		return lines.join("\n");
	}
}

// --- what the terminal can show --------------------------------------------------------------

// The 16 colors' usual RGB (xterm's), for picking the nearest.
const PALETTE16 = [
	[0, 0, 0],
	[205, 0, 0],
	[0, 205, 0],
	[205, 205, 0],
	[0, 0, 238],
	[205, 0, 205],
	[0, 205, 205],
	[229, 229, 229],
	[127, 127, 127],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[92, 92, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];
const CUBE = [0, 95, 135, 175, 215, 255];
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const nearest = (rgb, colors) => {
	let best = 0;
	for (let i = 1; i < colors.length; i++)
		if (distance(rgb, colors[i]) < distance(rgb, colors[best])) best = i;
	return best;
};
// The RGB of a 256-palette index.
export function rgbOf256(n) {
	if (n < 16) return PALETTE16[n];
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return [v, v, v];
	}
	const i = n - 16;
	return [CUBE[Math.floor(i / 36)], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]];
}
// The nearest 256-palette index to an RGB: the 6×6×6 cube's or the gray ramp's.
function to256(rgb) {
	const level = (v) =>
		nearest(
			[v, 0, 0],
			CUBE.map((c) => [c, 0, 0]),
		);
	const [r, g, b] = rgb.map(level);
	const cube = 16 + 36 * r + 6 * g + b;
	const gray = Math.min(23, Math.max(0, Math.round(((rgb[0] + rgb[1] + rgb[2]) / 3 - 8) / 10)));
	return distance(rgb, rgbOf256(cube)) <= distance(rgb, rgbOf256(232 + gray)) ? cube : 232 + gray;
}
// A 16-color SGR code (30-37, 90-97; 40-47, 100-107 for a background) for an RGB.
function to16(rgb, background) {
	const n = nearest(rgb, PALETTE16);
	return String((background ? 40 : 30) + (n < 8 ? n : n + 52));
}
const isColorCode = (n) =>
	(n >= 30 && n <= 39) || (n >= 40 && n <= 49) || (n >= 90 && n <= 97) || (n >= 100 && n <= 107);

const reduced = new Map();
// style (SGR parameters) as a terminal with colors ("truecolor", 256, 16 or 0) shows it: 24-bit
// and 256-palette colors become the nearest it has, and with 0 colors go and attributes stay.
export function reduceStyle(style, colors) {
	if (colors === "truecolor" || style === "") return style;
	const key = `${colors}|${style}`;
	let out = reduced.get(key);
	if (out !== undefined) return out;
	const params = style.split(";");
	const kept = [];
	for (let i = 0; i < params.length; i++) {
		const p = params[i];
		const n = Number(p);
		if (p === "38" || p === "48" || p === "58") {
			const background = p === "48";
			let rgb;
			let index = null;
			if (params[i + 1] === "2") {
				rgb = params.slice(i + 2, i + 5).map(Number);
				i += 4;
			} else {
				index = Number(params[i + 2]);
				rgb = rgbOf256(index);
				i += 2;
			}
			if (colors === 0 || p === "58") continue; // Underline color needs 24-bit, mostly.
			if (colors === 256) kept.push(`${p};5;${index ?? to256(rgb)}`);
			else kept.push(to16(rgb, background));
			continue;
		}
		if (colors === 0 && isColorCode(n)) continue;
		kept.push(p);
	}
	out = kept.join(";");
	if (reduced.size >= 512) reduced.delete(reduced.keys().next().value);
	reduced.set(key, out);
	return out;
}

// What a terminal without Unicode draws instead of box drawing, blocks and the ellipsis: one
// cell each, as the originals take.
const ASCII = {};
for (const [chars, to] of [
	["┌┐└┘╭╮╰╯╔╗╚╝┏┓┗┛", "+"],
	["─━═╌", "-"],
	["│┃║╎", "|"],
	["█▀▄▐▌", "#"],
	["…", "~"],
	["✕", "x"],
	["−", "-"],
]) {
	for (const ch of chars) ASCII[ch] = to;
}
export const asciiOf = (char) => ASCII[char] ?? char;

// A terminal's colors and Unicode; the defaults show everything.
const FULL = { colors: "truecolor", unicode: true };
const styleFor = (style, terminal) => reduceStyle(style, terminal.colors);
const charFor = (char, terminal) => (terminal.unicode ? char : asciiOf(char));

// The whole buffer as ANSI lines, for printing it once (renderToString), as terminal shows it.
export function bufferToAnsi(buffer, terminal = FULL) {
	const lines = buffer.rows.map((row) => {
		let out = "";
		let last = "";
		for (const c of row) {
			if (c.wide) continue;
			const style = styleFor(c.style, terminal);
			if (style !== last) {
				out += style ? `\x1b[0;${style}m` : "\x1b[0m";
				last = style;
			}
			out += charFor(c.char, terminal);
		}
		return last ? `${out}\x1b[0m` : out.trimEnd();
	});
	while (lines.length > 0 && lines.at(-1) === "") lines.pop();
	return lines.join("\n");
}

// The ANSI that applies patches (from diff, sorted by row then column) on terminal: a cursor
// move only where a run of changed cells breaks, a style change only where the style does.
export function patchesToAnsi(patches, width, terminal = FULL) {
	let out = "";
	let lastX = -1;
	let lastY = -1;
	let last = "";
	for (const { x, y, cell: c } of patches) {
		if (c.wide || x < 0 || x >= width || y < 0) continue;
		if (y !== lastY || x !== lastX + 1) out += `\x1b[${y + 1};${x + 1}H`;
		const style = styleFor(c.style, terminal);
		if (style !== last) {
			out += style ? `\x1b[0;${style}m` : "\x1b[0m";
			last = style;
		}
		out += charFor(c.char, terminal);
		lastX = x + Math.max(1, graphemeWidth(c.char)) - 1;
		lastY = y;
	}
	return last ? `${out}\x1b[0m` : out;
}

// Terminal text: graphemes, their cell widths, wrapping and truncation. Ported from tuiuiu.js
// (utils/grapheme.ts, utils/text-utils.ts, utils/terminal-sanitize.ts; MIT, see LICENSE.tuiuiu).
// Text here is plain: styling is attributes on elements, so stripControls removes every escape
// sequence and control character from what the state holds before it reaches a cell, and the
// helpers below need not carry ANSI across slices as tuiuiu's do.

const ESC = "\x1b";
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

// --- graphemes -------------------------------------------------------------------------------

const segmenter =
	typeof Intl !== "undefined" && Intl.Segmenter
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

const isContinuation = (code) =>
	code === 0x200d ||
	(code >= 0x0300 && code <= 0x036f) ||
	(code >= 0x1ab0 && code <= 0x1aff) ||
	(code >= 0x1dc0 && code <= 0x1dff) ||
	(code >= 0x20d0 && code <= 0x20ff) ||
	(code >= 0xfe00 && code <= 0xfe0f) ||
	(code >= 0xfe20 && code <= 0xfe2f) ||
	(code >= 0x1f3fb && code <= 0x1f3ff) ||
	(code >= 0xe0020 && code <= 0xe007f) ||
	(code >= 0xe0100 && code <= 0xe01ef);
const MARK = /\p{M}/u;
const isRegionalIndicator = (code) => code >= 0x1f1e6 && code <= 0x1f1ff;
const isHangulJamo = (code) =>
	(code >= 0x1100 && code <= 0x11ff) ||
	(code >= 0xa960 && code <= 0xa97f) ||
	(code >= 0xd7b0 && code <= 0xd7ff);
const isPrepend = (code) =>
	(code >= 0x0600 && code <= 0x0605) ||
	[0x06dd, 0x070f, 0x0890, 0x0891, 0x08e2, 0x0d4e, 0x110bd, 0x110cd].includes(code);
const isMark = (code) => MARK.test(String.fromCodePoint(code));

// Whether the code point at a string offset is a whole grapheme, decided without a segmenter.
function standsAlone(text, code, end) {
	if (isMark(code) || isPrepend(code) || isHangulJamo(code)) return false;
	const next = text.codePointAt(end);
	if (next === undefined) return true;
	return !(
		isContinuation(next) ||
		isMark(next) ||
		isHangulJamo(next) ||
		(isRegionalIndicator(code) && isRegionalIndicator(next)) ||
		(code === 0x0d && next === 0x0a)
	);
}

// The grapheme starting at position, { segment, index, end } in UTF-16 offsets, or null. Reads
// one cluster, not the rest of the string, since painting reads one per cell.
export function readGrapheme(text, position) {
	if (position < 0 || position >= text.length) return null;
	const code = text.codePointAt(position);
	const codeEnd = position + (code > 0xffff ? 2 : 1);
	if (standsAlone(text, code, codeEnd)) {
		return { segment: text.slice(position, codeEnd), index: position, end: codeEnd };
	}
	if (segmenter !== null) {
		const entry = segmenter.segment(text).containing(position);
		if (!entry) return null;
		return { segment: entry.segment, index: entry.index, end: entry.index + entry.segment.length };
	}
	let end = codeEnd;
	let joinNext = false;
	while (end < text.length) {
		const next = text.codePointAt(end);
		if (!joinNext && !isContinuation(next)) break;
		end += next > 0xffff ? 2 : 1;
		joinNext = next === 0x200d;
	}
	return { segment: text.slice(position, end), index: position, end };
}

export function* graphemes(text) {
	for (let i = 0; i < text.length; ) {
		// ASCII followed by ASCII (or the end) is a grapheme on its own: the common case.
		const next = text.charCodeAt(i + 1);
		if (text.charCodeAt(i) <= 0x7f && (Number.isNaN(next) || next <= 0x7f)) {
			yield text[i++];
			continue;
		}
		const g = readGrapheme(text, i);
		if (g === null) return;
		yield g.segment;
		i = g.end;
	}
}

// --- widths ----------------------------------------------------------------------------------

const isZeroWidth = (code) =>
	(code >= 0xfe00 && code <= 0xfe0f) ||
	(code >= 0xe0100 && code <= 0xe01ef) ||
	code === 0x200b ||
	code === 0x200c ||
	code === 0x200d ||
	code === 0x2060 ||
	code === 0xfeff ||
	(code >= 0x0300 && code <= 0x036f) ||
	(code >= 0x1ab0 && code <= 0x1aff) ||
	(code >= 0x1dc0 && code <= 0x1dff) ||
	(code >= 0xfe20 && code <= 0xfe2f) ||
	code === 0x00ad;
// Dingbats and miscellaneous symbols most terminals draw as two-cell emoji. Ambiguous-width
// symbols (✓ ✗ ⚠ ℹ) stay one cell, as in most Western terminals.
const EMOJI_PRESENTATION = new Set([
	0x2702, 0x2705, 0x2708, 0x2709, 0x270a, 0x270b, 0x270c, 0x270d, 0x270f, 0x2712, 0x2714, 0x2716,
	0x2728, 0x2733, 0x2734, 0x2744, 0x2747, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2763,
	0x2764, 0x2795, 0x2796, 0x2797, 0x27a1, 0x27b0, 0x2600, 0x2601, 0x2602, 0x2603, 0x2604, 0x260e,
	0x2611, 0x2614, 0x2615, 0x2618, 0x261d, 0x2620, 0x2622, 0x2623, 0x2626, 0x262a, 0x262e, 0x262f,
	0x2638, 0x2639, 0x263a, 0x2640, 0x2642, 0x2648, 0x2649, 0x264a, 0x264b, 0x264c, 0x264d, 0x264e,
	0x264f, 0x2650, 0x2651, 0x2652, 0x2653, 0x265f, 0x2660, 0x2663, 0x2665, 0x2666, 0x2668, 0x267b,
	0x267e, 0x267f, 0x2692, 0x2693, 0x2694, 0x2695, 0x2696, 0x2697, 0x2699, 0x269b, 0x269c, 0x26a1,
	0x26aa, 0x26ab, 0x26b0, 0x26b1, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2,
	0x26f3, 0x26f5, 0x26fa, 0x26fd,
]);
const isWide = (code) =>
	(code >= 0x4e00 && code <= 0x9fff) ||
	(code >= 0x3400 && code <= 0x4dbf) ||
	(code >= 0x20000 && code <= 0x2a6df) ||
	(code >= 0x2a700 && code <= 0x2ceaf) ||
	(code >= 0xff00 && code <= 0xff60) ||
	(code >= 0xffe0 && code <= 0xffe6) ||
	(code >= 0x3040 && code <= 0x30ff) ||
	(code >= 0xac00 && code <= 0xd7a3) ||
	(code >= 0x1f300 && code <= 0x1f9ff) ||
	(code >= 0x1fa00 && code <= 0x1faff) ||
	EMOJI_PRESENTATION.has(code);
const isControl = (code) => code <= 0x1f || (code >= 0x7f && code <= 0x9f);
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

const codeWidthCache = new Map();
function codeWidth(code) {
	let width = codeWidthCache.get(code);
	if (width !== undefined) return width;
	if (isControl(code) || isZeroWidth(code)) width = 0;
	else width = isWide(code) || PICTOGRAPHIC.test(String.fromCodePoint(code)) ? 2 : 1;
	if (codeWidthCache.size >= 256) codeWidthCache.clear();
	codeWidthCache.set(code, width);
	return width;
}

// The cells one grapheme takes: 0, 1 or 2.
export function graphemeWidth(grapheme) {
	if (!grapheme) return 0;
	const codes = [...grapheme].map((ch) => ch.codePointAt(0));
	if (codes.length === 1) return codeWidth(codes[0]);
	if (codes.every((c) => isControl(c) || isZeroWidth(c))) return 0;
	const emoji =
		codes.filter(isRegionalIndicator).length >= 2 ||
		codes.includes(0xfe0f) ||
		codes.includes(0x20e3) ||
		PICTOGRAPHIC.test(grapheme);
	return emoji || codes.some(isWide) ? 2 : 1;
}

// The cells text takes on one line.
export function stringWidth(text) {
	if (PRINTABLE_ASCII.test(text)) return text.length;
	let width = 0;
	for (const g of graphemes(text)) width += graphemeWidth(g);
	return width;
}

// --- sanitizing ------------------------------------------------------------------------------

// The end of the escape sequence at start (CSI, the string protocols OSC/DCS/SOS/PM/APC up to
// BEL or ST, or a two-byte Fe). An unterminated one runs to the end: failing closed.
function sequenceEnd(text, start) {
	const intro = text[start + 1];
	if (intro === undefined) return start + 1;
	if (intro === "[") {
		let end = start + 2;
		while (end < text.length) {
			const c = text.charCodeAt(end);
			if (c >= 0x40 && c <= 0x7e) return end + 1;
			end++;
		}
		return text.length;
	}
	if ("]PX^_".includes(intro)) {
		for (let i = start + 2; i < text.length; i++) {
			if (text[i] === "\x07") return i + 1;
			if (text[i] === ESC && text[i + 1] === "\\") return i + 2;
		}
		return text.length;
	}
	return Math.min(text.length, start + 2);
}

// text without escape sequences or control characters, but with its newlines; tabs become a
// space, since a cell grid has no tab stops.
export function stripControls(text) {
	if (PRINTABLE_ASCII.test(text)) return text;
	let out = "";
	for (let i = 0; i < text.length; ) {
		if (text[i] === ESC) {
			i = sequenceEnd(text, i);
			continue;
		}
		const c = text.charCodeAt(i);
		if (text[i] === "\n") out += "\n";
		else if (text[i] === "\t") out += " ";
		else if (!isControl(c)) out += text[i];
		i++;
	}
	return out;
}

// --- slicing, truncating, wrapping -----------------------------------------------------------

// The graphemes of text from column start up to column end. A wide grapheme cut by either edge
// is left out, so the result never takes more than end - start cells.
export function sliceColumns(text, start, end = Infinity) {
	let out = "";
	let col = 0;
	for (const g of graphemes(text)) {
		const w = graphemeWidth(g);
		if (col >= start && col + w <= end) out += g;
		col += w;
		if (col >= end) break;
	}
	return out;
}

// text in at most columns cells, cut at position (start, middle or end) and marked with
// ellipsis.
export function truncateText(text, columns, { position = "end", ellipsis = "…" } = {}) {
	const width = stringWidth(text);
	if (width <= columns) return text;
	const ew = stringWidth(ellipsis);
	if (columns < ew) return sliceColumns(ellipsis, 0, columns);
	const room = columns - ew;
	if (position === "start") return ellipsis + sliceColumns(text, width - room);
	if (position === "middle") {
		const head = Math.ceil(room / 2);
		return sliceColumns(text, 0, head) + ellipsis + sliceColumns(text, width - (room - head));
	}
	return sliceColumns(text, 0, room) + ellipsis;
}

// --- fitting lines, as ranges ----------------------------------------------------------------
// A fitted line is a list of segments: { start, end }, a range of the text's UTF-16 offsets, or
// { text, at }, text that isn't in it (the ellipsis of a truncation), styled as offset at is. So
// styled spans keep their styles across wraps and cuts.

// The offset in text, from start, where column cells end (a grapheme cut is left out).
function offsetAt(text, start, end, columns) {
	let col = 0;
	let at = start;
	while (at < end) {
		const g = readGrapheme(text, at);
		if (g === null) break;
		const w = graphemeWidth(g.segment);
		if (col + w > columns) break;
		col += w;
		at = g.end;
	}
	return at;
}
// The offset in text, back from end, where the last columns cells start.
function offsetFromEnd(text, start, end, columns) {
	const bounds = graphemeBounds(text.slice(start, end)).map((b) => b + start);
	let col = 0;
	let i = bounds.length - 1;
	while (i > 0) {
		const w = graphemeWidth(text.slice(bounds[i - 1], bounds[i]));
		if (col + w > columns) break;
		col += w;
		i--;
	}
	return bounds[i];
}
const widthOf = (text, start, end) => stringWidth(text.slice(start, end));

// The rows text from start to end (one paragraph, no newlines) wraps to: words whole when they
// fit, split by grapheme when wider than the line; the spaces a row breaks at are left out.
function wrapRange(text, start, end, columns) {
	if (widthOf(text, start, end) <= columns) return [[{ start, end }]];
	const rows = [];
	let row = null; // { start, end, width }
	let i = start;
	while (i < end) {
		let spaces = i;
		while (spaces < end && text[spaces] === " ") spaces++;
		let wordEnd = spaces;
		while (wordEnd < end && text[wordEnd] !== " ") wordEnd++;
		// Spaces leading the paragraph are part of its first word.
		const wordStart = row === null && rows.length === 0 ? i : spaces;
		const gap = row === null ? 0 : widthOf(text, i, spaces);
		const word = widthOf(text, wordStart, wordEnd);
		if (wordEnd === spaces && row !== null) break; // Trailing spaces.
		if (row !== null && row.width + gap + word <= columns) {
			row.end = wordEnd;
			row.width += gap + word;
		} else {
			if (row !== null) rows.push([{ start: row.start, end: row.end }]);
			row = { start: wordStart, end: wordStart, width: 0 };
			let from = wordStart;
			while (widthOf(text, from, wordEnd) > columns) {
				const cut = Math.max(nextBoundary(text, from), offsetAt(text, from, wordEnd, columns));
				rows.push([{ start: from, end: cut }]);
				from = cut;
			}
			row = { start: from, end: wordEnd, width: widthOf(text, from, wordEnd) };
		}
		i = wordEnd;
	}
	if (row !== null) rows.push([{ start: row.start, end: row.end }]);
	return rows.length > 0 ? rows : [[{ start, end: start }]];
}

// One row of text from start to end, cut at position with an ellipsis when it doesn't fit.
function truncateRange(text, start, end, columns, position, ellipsis = "…") {
	if (widthOf(text, start, end) <= columns) return [{ start, end }];
	const ew = stringWidth(ellipsis);
	if (columns < ew) return [{ text: sliceColumns(ellipsis, 0, columns), at: start }];
	const room = columns - ew;
	if (position === "start") {
		const from = offsetFromEnd(text, start, end, room);
		return [
			{ text: ellipsis, at: from },
			{ start: from, end },
		];
	}
	if (position === "middle") {
		const head = offsetAt(text, start, end, Math.ceil(room / 2));
		const tail = offsetFromEnd(text, head, end, Math.floor(room / 2));
		return [
			{ start, end: head },
			{ text: ellipsis, at: head },
			{ start: tail, end },
		];
	}
	const cut = offsetAt(text, start, end, room);
	return [
		{ start, end: cut },
		{ text: ellipsis, at: Math.max(start, cut - 1) },
	];
}

// The rows text shows as in columns cells, as segments, by mode: wrap (the default), truncate (as
// truncate-end), truncate-start or truncate-middle. Layout measures with this and paint draws
// with it, so a text is as tall as it's measured.
export function fitSegments(text, columns, mode = "wrap") {
	const rows = [];
	let start = 0;
	for (;;) {
		const nl = text.indexOf("\n", start);
		const end = nl === -1 ? text.length : nl;
		if (columns <= 0 || !Number.isFinite(columns)) rows.push([{ start, end }]);
		else if (mode === "wrap") rows.push(...wrapRange(text, start, end, columns));
		else {
			const position =
				mode === "truncate-start" ? "start" : mode === "truncate-middle" ? "middle" : "end";
			rows.push(truncateRange(text, start, end, columns, position));
		}
		if (nl === -1) return rows;
		start = nl + 1;
	}
}
// A row of segments as the text it shows.
export const segmentsText = (text, row) =>
	row.map((s) => (s.text !== undefined ? s.text : text.slice(s.start, s.end))).join("");

// The lines text shows as in columns cells, by mode (as fitSegments), as strings.
export function fitText(text, columns, mode = "wrap") {
	return fitSegments(text, columns, mode).map((row) => segmentsText(text, row));
}

// text cut or padded to exactly columns cells, aligned left, center or right.
export function padText(text, columns, align = "left") {
	const n = Math.max(0, Math.trunc(columns) || 0);
	if (n === 0) return "";
	const fitted = sliceColumns(text, 0, n);
	const pad = n - stringWidth(fitted);
	if (align === "right") return " ".repeat(pad) + fitted;
	if (align === "center") {
		const left = Math.floor(pad / 2);
		return " ".repeat(left) + fitted + " ".repeat(pad - left);
	}
	return fitted + " ".repeat(pad);
}

// --- carets ----------------------------------------------------------------------------------
// A caret is a UTF-16 offset into text, as an input's selectionStart is, always on a grapheme
// boundary.

// The offsets where text's graphemes start, and its length.
export function graphemeBounds(text) {
	const bounds = [0];
	let at = 0;
	for (const g of graphemes(text)) {
		at += g.length;
		bounds.push(at);
	}
	return bounds;
}
// The boundary before at, or 0; the one after at, or the end.
export const previousBoundary = (text, at) => graphemeBounds(text).findLast((b) => b < at) ?? 0;
export const nextBoundary = (text, at) => graphemeBounds(text).find((b) => b > at) ?? text.length;
const isSpace = (g) => /^\s$/u.test(g);
// Where a word left of at starts and where one right of at ends, past the spaces between, as
// Ctrl+Left and Ctrl+Right move.
export function previousWord(text, at) {
	const bounds = graphemeBounds(text);
	let i = bounds.findLastIndex((b) => b < at) + 1;
	while (i > 0 && isSpace(text.slice(bounds[i - 1], bounds[i]))) i--;
	while (i > 0 && !isSpace(text.slice(bounds[i - 1], bounds[i]))) i--;
	return bounds[i];
}
export function nextWord(text, at) {
	const bounds = graphemeBounds(text);
	let i = Math.max(
		0,
		bounds.findIndex((b) => b >= at),
	);
	const last = bounds.length - 1;
	while (i < last && isSpace(text.slice(bounds[i], bounds[i + 1]))) i++;
	while (i < last && !isSpace(text.slice(bounds[i], bounds[i + 1]))) i++;
	return bounds[i];
}
// The column a caret is at, and the caret nearest a column (a click on the right half of a wide
// grapheme puts it after).
export const columnOf = (text, at) => stringWidth(text.slice(0, at));
export function caretAtColumn(text, column) {
	let col = 0;
	let at = 0;
	for (const g of graphemes(text)) {
		const w = graphemeWidth(g);
		if (col + w / 2 > column) return at;
		col += w;
		at += g.length;
	}
	return at;
}

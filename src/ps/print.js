// The PostScript program that draws a drawing lower.js made: a DSC conforming document
// (%!PS-Adobe-3.0, LanguageLevel 2, 7 bit clean), a page per Page, which a printer, Ghostscript
// (gs, ps2pdf) or a viewer reads.
//
// What the drawing doesn't say is drawing.js's. PostScript adds:
// - Text is ISO Latin-1, its fonts reencoded for it (but Symbol and ZapfDingbats, whose
//   characters are their own): typographic quotes, dashes and ellipses are their Latin-1
//   look-alikes, and other characters outside it are ?.
// - Colors are RGB, or gray when the three are equal.
import {
	asDocument,
	BLACK,
	DEFAULT_SIZE,
	fontOf,
	groupTransform,
	pageSize,
	paintOf,
	rgbOf,
	textLines,
} from "./drawing.js";
import { isColor } from "./schema.js";

// Fonts with their own encoding, which reencoding to Latin-1 would break.
const OWN_ENCODING = new Set(["Symbol", "ZapfDingbats"]);

// Defined once per document: the procedures the pages use.
const PROLOG = [
	"% x y w h rectpath: a rectangle's path, from its bottom left corner",
	"/rectpath { 4 2 roll moveto 1 index 0 rlineto 0 exch rlineto neg 0 rlineto closepath } bind def",
	"% string centershow, string rightshow: show centered on, or ending at, the current point",
	"/centershow { dup stringwidth pop 2 div neg 0 rmoveto show } bind def",
	"/rightshow { dup stringwidth pop neg 0 rmoveto show } bind def",
	"% /New /Old latin1font: defines New, Old reencoded to ISO Latin-1",
	"/latin1font { findfont dup length dict begin",
	"  { 1 index /FID ne { def } { pop pop } ifelse } forall",
	"  /Encoding ISOLatin1Encoding def currentdict end definefont pop } bind def",
];

// Numbers as PostScript reads them: at most 3 decimals, no exponent, no -0.
export const num = (n) => {
	const r = Math.round(n * 1000) / 1000;
	return Object.is(r, -0) ? "0" : r.toFixed(3).replace(/\.?0+$/, "");
};

// Characters outside Latin-1 that have a look-alike in it.
const LOOK_ALIKES = {
	"‘": "'",
	"’": "'",
	"‚": ",",
	"“": '"',
	"”": '"',
	"„": '"',
	"–": "-",
	"—": "-",
	"−": "-",
	"…": "...",
	"•": "·",
	" ": " ",
};
// A PostScript string literal of text, 7 bit clean: ( ) \ escaped, the rest of Latin-1 in octal.
// For a font reencoded to Latin-1 (latin1), - is its hyphen: ISOLatin1Encoding's - is a minus.
export const psString = (text, { latin1 = false } = {}) => {
	let out = "(";
	for (const ch of text.normalize("NFC")) {
		const alike = LOOK_ALIKES[ch];
		if (alike !== undefined) {
			out += psString(alike, { latin1 }).slice(1, -1);
			continue;
		}
		const code = ch.codePointAt(0);
		if (latin1 && ch === "-") out += "\\255";
		else if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
		else if (code > 0xff) out += "?";
		else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
		else out += ch;
	}
	return `${out})`;
};

// "r g b setrgbcolor", or "g setgray" when they're equal.
export const setColor = (color) => {
	if (!isColor(color)) throw new TypeError(`not a color: ${JSON.stringify(color)}`);
	const [r, g, b] = rgbOf(color);
	return r === g && g === b ? `${num(r)} setgray` : `${num(r)} ${num(g)} ${num(b)} setrgbcolor`;
};

const fontName = (font) => (OWN_ENCODING.has(font) ? font : `${font}-Latin1`);

const LINE_CAP = { butt: 0, round: 1, square: 2 };
const LINE_JOIN = { miter: 0, round: 1, bevel: 2 };

// Draws a path (ops, after newpath) with node's fill and stroke.
const paint = (node, ops, out) => {
	const { fill, stroke } = paintOf(node);
	const style = [];
	if (stroke !== undefined) {
		if (node.lineWidth !== undefined) style.push(`${num(node.lineWidth)} setlinewidth`);
		if (node.dash !== undefined) style.push(`[${node.dash.map(num).join(" ")}] 0 setdash`);
		if (node.lineCap !== undefined) style.push(`${LINE_CAP[node.lineCap]} setlinecap`);
		if (node.lineJoin !== undefined) style.push(`${LINE_JOIN[node.lineJoin]} setlinejoin`);
	}
	// What it sets that the next graphic doesn't, it sets between gsave and grestore.
	if (style.length > 0) out.open("gsave", ...style);
	out.line(`newpath ${ops}`);
	if (fill !== undefined && stroke !== undefined) {
		out.line(`gsave ${setColor(fill)} fill grestore`, `${setColor(stroke)} stroke`);
	} else if (fill !== undefined) out.line(`${setColor(fill)} fill`);
	else out.line(`${setColor(stroke)} stroke`);
	if (style.length > 0) out.close("grestore");
};

const pointsPath = (points, closed) =>
	points.map(([x, y], i) => `${num(x)} ${num(y)} ${i === 0 ? "moveto" : "lineto"}`).join(" ") +
	(closed ? " closepath" : "");

const SEGMENTS = {
	moveTo: ({ x, y }) => `${num(x)} ${num(y)} moveto`,
	lineTo: ({ x, y }) => `${num(x)} ${num(y)} lineto`,
	curveTo: (s) => `${[s.x1, s.y1, s.x2, s.y2, s.x, s.y].map(num).join(" ")} curveto`,
	arc: (s) =>
		`${[s.cx, s.cy, s.r, s.from, s.to].map(num).join(" ")} ${s.clockwise ? "arcn" : "arc"}`,
	closePath: () => "closepath",
};

const TEXT_SHOW = { left: "show", center: "centershow", right: "rightshow" };

const GRAPHICS = {
	group: (node, out) => {
		const transform = [];
		const { x, y, rotate, scaleX, scaleY, stepX, stepY } = groupTransform(node);
		if (x !== 0 || y !== 0) transform.push(`${num(x)} ${num(y)} translate`);
		if (rotate !== 0) transform.push(`${num(rotate)} rotate`);
		if (scaleX !== 1 || scaleY !== 1) transform.push(`${num(scaleX)} ${num(scaleY)} scale`);
		out.open("gsave", ...transform);
		const stepped = stepX !== 0 || stepY !== 0;
		node.children.forEach((child, i) => {
			// Each child leaves the transform as it found it, so the step adds up.
			if (stepped && i > 0) out.line(`${num(stepX)} ${num(stepY)} translate`);
			graphic(child, out);
		});
		out.close("grestore");
	},
	rect: (node, out) =>
		paint(node, `${[node.x, node.y, node.width, node.height].map(num).join(" ")} rectpath`, out),
	circle: (node, out) =>
		paint(node, `${num(node.cx)} ${num(node.cy)} ${num(node.r)} 0 360 arc closepath`, out),
	line: (node, out) =>
		paint(
			node,
			`${num(node.x1)} ${num(node.y1)} moveto ${num(node.x2)} ${num(node.y2)} lineto`,
			out,
		),
	polyline: (node, out) => paint(node, pointsPath(node.points, node.closed === true), out),
	path: (node, out) => paint(node, node.children.map((s) => SEGMENTS[s.type](s)).join(" "), out),
	text: (node, out) => {
		const lines = textLines(node);
		if (lines.length === 0) return;
		const show = TEXT_SHOW[node.align ?? "left"];
		const latin1 = !OWN_ENCODING.has(fontOf(node));
		out.line(
			`/${fontName(fontOf(node))} findfont ${num(node.size ?? DEFAULT_SIZE)} scalefont setfont`,
			setColor(node.fill ?? BLACK),
		);
		for (const { text, y } of lines) {
			out.line(`${num(node.x)} ${num(y)} moveto ${psString(text, { latin1 })} ${show}`);
		}
	},
};
const graphic = (node, out) => GRAPHICS[node.type](node, out);

// Lines, indented a level per gsave.
class Out {
	constructor() {
		this.lines = [];
		this.depth = 0;
	}
	line(...lines) {
		for (const l of lines) this.lines.push("  ".repeat(this.depth) + l);
	}
	open(first, ...rest) {
		this.line(first);
		this.depth += 1;
		this.line(...rest);
	}
	close(last) {
		this.depth -= 1;
		this.line(last);
	}
}

const fontsIn = (node, fonts = new Set()) => {
	if (node.type === "text" && textLines(node).length > 0) fonts.add(fontOf(node));
	for (const child of node.children ?? []) fontsIn(child, fonts);
	return fonts;
};

// The PostScript program that draws tree, a Document, a Page or a Graphic as lower makes them.
export const printPs = (tree) => {
	const doc = asDocument(tree);
	const sizes = doc.children.map((page) => pageSize(doc, page));
	const fonts = [...fontsIn(doc)].sort();
	const bbox = (s) => `0 0 ${Math.ceil(s.width)} ${Math.ceil(s.height)}`;
	const out = new Out();
	out.line("%!PS-Adobe-3.0", "%%Creator: tutuca");
	if (doc.title !== undefined) out.line(`%%Title: ${psString(doc.title)}`);
	out.line(
		`%%Pages: ${doc.children.length}`,
		`%%BoundingBox: ${bbox({
			width: Math.max(0, ...sizes.map((s) => s.width)),
			height: Math.max(0, ...sizes.map((s) => s.height)),
		})}`,
	);
	fonts.forEach((font, i) => {
		out.line(`${i === 0 ? "%%DocumentNeededResources:" : "%%+"} font ${font}`);
	});
	out.line("%%LanguageLevel: 2", "%%DocumentData: Clean7Bit", "%%EndComments");
	out.line("%%BeginProlog", ...PROLOG, "%%EndProlog");
	out.line("%%BeginSetup");
	for (const font of fonts) {
		out.line(`%%IncludeResource: font ${font}`);
		if (!OWN_ENCODING.has(font)) out.line(`/${fontName(font)} /${font} latin1font`);
	}
	out.line("%%EndSetup");
	doc.children.forEach((page, i) => {
		const { width, height } = sizes[i];
		const label = page.label === undefined ? String(i + 1) : psString(page.label);
		out.line(`%%Page: ${label} ${i + 1}`, `%%PageBoundingBox: ${bbox(sizes[i])}`);
		out.line(
			"%%BeginPageSetup",
			`<< /PageSize [${num(width)} ${num(height)}] >> setpagedevice`,
			"%%EndPageSetup",
		);
		if (page.background !== undefined) {
			out.line(`${setColor(page.background)} 0 0 ${num(width)} ${num(height)} rectfill`);
		}
		for (const child of page.children) graphic(child, out);
		out.line("showpage");
	});
	out.line("%%Trailer", "%%EOF");
	return `${out.lines.join("\n")}\n`;
};

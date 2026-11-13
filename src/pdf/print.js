// A drawing (what a renders.ps renders to, tutuca/ps's lower) as a PDF, made with PDFKit
// (vendored as deps/pdfkit.js, its browser build with the 14 standard fonts registered): the same
// pages printPs prints, in browsers and node alike.
//
// What the drawing doesn't say is src/ps/drawing.js's, as for PostScript. PDF adds:
// - A font is one of the 14 every PDF reader has (Helvetica, Times-Roman, Courier and their bold
//   and italic, Symbol, ZapfDingbats), or one given in fonts, by name: the bytes of a TrueType or
//   OpenType font, embedded. Any other is an error: a PDF can't ask the printer for one, as
//   PostScript does.
// - Text in a standard font is Windows-1252 (Latin-1, with typographic quotes, dashes, € and …);
//   an embedded font has the characters it has.
import { PDFDocument, toBytes } from "../../deps/pdfkit.js";
import {
	arcSweep,
	asDocument,
	BLACK,
	DEFAULT_SIZE,
	fontOf,
	groupTransform,
	pageSize,
	paintOf,
	rgbOf,
	textLines,
} from "../ps/drawing.js";

export const STANDARD_FONTS = Object.freeze([
	"Courier",
	"Courier-Bold",
	"Courier-BoldOblique",
	"Courier-Oblique",
	"Helvetica",
	"Helvetica-Bold",
	"Helvetica-BoldOblique",
	"Helvetica-Oblique",
	"Symbol",
	"Times-Bold",
	"Times-BoldItalic",
	"Times-Italic",
	"Times-Roman",
	"ZapfDingbats",
]);

// Colors as PDFKit takes them: 0 to 255.
const rgb = (color) => rgbOf(color).map((c) => c * 255);
const rad = (deg) => (deg * Math.PI) / 180;

// An arc as Bézier curves of a quarter turn at most, from a line to its start when the path has a
// current point, as PostScript's arc and arcn draw it.
const arc = (doc, { cx, cy, r }, sweep, started) => {
	const { start, end } = sweep;
	const turns = Math.max(1, Math.ceil(Math.abs(end - start) / 90));
	const step = (end - start) / turns;
	const at = (a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
	// A curve's control points are along the tangents at its ends, this far for a circle.
	const handle = (4 / 3) * Math.tan(rad(step) / 4) * r;
	const [x0, y0] = at(start);
	if (started) doc.lineTo(x0, y0);
	else doc.moveTo(x0, y0);
	for (let i = 0; i < turns; i++) {
		const a0 = start + i * step;
		const a1 = a0 + step;
		const [ax, ay] = at(a0);
		const [bx, by] = at(a1);
		doc.bezierCurveTo(
			ax - handle * Math.sin(rad(a0)),
			ay + handle * Math.cos(rad(a0)),
			bx + handle * Math.sin(rad(a1)),
			by - handle * Math.cos(rad(a1)),
			bx,
			by,
		);
	}
};

// Lays out a path's segments; Path checks it starts with a MoveTo or an Arc.
const segments = (doc, children) => {
	let started = false;
	for (const s of children) {
		if (s.type === "moveTo") doc.moveTo(s.x, s.y);
		else if (s.type === "lineTo") doc.lineTo(s.x, s.y);
		else if (s.type === "curveTo") doc.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y);
		else if (s.type === "arc") arc(doc, s, arcSweep(s), started);
		else doc.closePath();
		started = true;
	}
};

// Draws the path layOut lays out with node's fill and stroke, its stroke style between save and
// restore.
const paint = (doc, node, layOut) => {
	const { fill, stroke } = paintOf(node);
	doc.save();
	if (stroke !== undefined) {
		if (node.lineWidth !== undefined) doc.lineWidth(node.lineWidth);
		// Not PDFKit's dash, which takes no 0 lengths; a PDF does.
		if (node.dash !== undefined) doc.addContent(`[${node.dash.join(" ")}] 0 d`);
		if (node.lineCap !== undefined) doc.lineCap(node.lineCap);
		if (node.lineJoin !== undefined) doc.lineJoin(node.lineJoin);
	}
	layOut();
	if (fill !== undefined && stroke !== undefined) doc.fillAndStroke(rgb(fill), rgb(stroke));
	else if (fill !== undefined) doc.fill(rgb(fill));
	else doc.stroke(rgb(stroke));
	doc.restore();
};

const GRAPHICS = {
	group: (doc, node) => {
		const { x, y, rotate, scaleX, scaleY, stepX, stepY } = groupTransform(node);
		doc.save();
		doc.translate(x, y);
		doc.rotate(rotate);
		doc.scale(scaleX, scaleY);
		node.children.forEach((child, i) => {
			if (i > 0) doc.translate(stepX, stepY);
			graphic(doc, child);
		});
		doc.restore();
	},
	rect: (doc, node) => paint(doc, node, () => doc.rect(node.x, node.y, node.width, node.height)),
	circle: (doc, node) => paint(doc, node, () => doc.circle(node.cx, node.cy, node.r)),
	line: (doc, node) =>
		paint(doc, node, () => doc.moveTo(node.x1, node.y1).lineTo(node.x2, node.y2)),
	polyline: (doc, node) =>
		paint(doc, node, () => {
			const [[x0, y0], ...rest] = node.points;
			doc.moveTo(x0, y0);
			for (const [x, y] of rest) doc.lineTo(x, y);
			if (node.closed === true) doc.closePath();
		}),
	path: (doc, node) => paint(doc, node, () => segments(doc, node.children)),
	text: (doc, node) => {
		const lines = textLines(node);
		if (lines.length === 0) return;
		doc.font(fontOf(node)).fontSize(node.size ?? DEFAULT_SIZE);
		doc.fillColor(rgb(node.fill ?? BLACK));
		for (const { text, y } of lines) {
			const width = doc.widthOfString(text);
			const dx = { left: 0, center: -width / 2, right: -width }[node.align ?? "left"];
			// Upright in the page's y up: PDFKit's text is drawn for y down.
			doc.save();
			doc.translate(node.x, y);
			doc.scale(1, -1);
			doc.text(text, dx, 0, { lineBreak: false, baseline: "alphabetic" });
			doc.restore();
		}
	},
};
const graphic = (doc, node) => GRAPHICS[node.type](doc, node);

const fontsIn = (node, fonts = new Set()) => {
	if (node.type === "text" && textLines(node).length > 0) fonts.add(fontOf(node));
	for (const child of node.children ?? []) fontsIn(child, fonts);
	return fonts;
};

// The PDF that draws tree, a Document, a Page or a Graphic as tutuca/ps's lower makes them: its
// bytes, when PDFKit has written them. fonts: font bytes (Uint8Array or ArrayBuffer) by the name
// Text's font says.
export const printPdf = async (tree, { fonts = {} } = {}) => {
	const doc = asDocument(tree);
	const missing = [...fontsIn(doc)].filter(
		(font) => !STANDARD_FONTS.includes(font) && fonts[font] === undefined,
	);
	if (missing.length > 0) {
		throw new Error(
			`a PDF has no font ${missing.join(", ")}: give its bytes in fonts, or use one of ${STANDARD_FONTS.join(", ")}`,
		);
	}
	const pdf = new PDFDocument({
		autoFirstPage: false,
		info: { Creator: "tutuca", Producer: "tutuca", ...(doc.title && { Title: doc.title }) },
	});
	for (const [name, bytes] of Object.entries(fonts)) pdf.registerFont(name, bytes);
	const bytes = toBytes(pdf);
	for (const page of doc.children) {
		const { width, height } = pageSize(doc, page);
		pdf.addPage({ size: [width, height], margin: 0 });
		// PDFKit's pages are y down from the top left; a drawing's are PostScript's.
		pdf.save();
		pdf.transform(1, 0, 0, -1, 0, height);
		if (page.background !== undefined) pdf.rect(0, 0, width, height).fill(rgb(page.background));
		for (const child of page.children) graphic(pdf, child);
		pdf.restore();
	}
	pdf.end();
	return await bytes;
};

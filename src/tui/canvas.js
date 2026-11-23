// tutuca/tui/canvas: a tutuca app's renders.tui on a canvas (the Canvas 2D API: a page's
// <canvas>, an OffscreenCanvas, or a Skia-backed one in Node). The same Screen a terminal shows,
// with its hit testing, focus, inputs, scrolling and layers, painted by paint-canvas.js's
// CanvasPainter instead of into cells. Two modes:
//
// - grid: laid out in cells, as a terminal does, each cell a monospace typeface's cell in pixels;
//   box drawing and blocks drawn as lines and shapes, so borders join and scale.
// - text (the default): laid out in pixels, text measured in the typeface (proportional ones
//   too). Attributes stay in cells (padding "1", width "20", gap "1"), scaled to the typeface's
//   cell, so a tree written for a terminal keeps its proportions; borders and rules take half a
//   cell, the caret a thin bar.
//
// A mouse event's x and y, the screen's width and height, scrollTop and an element's rect are in
// the screen's layout units: cells in grid, pixels in text. pointAt turns a pixel into them.
import { cellMetrics, fontMetrics } from "./metrics.js";
import { CanvasPainter, DEFAULT_THEME, DEFAULT_TYPEFACE, fontString } from "./paint-canvas.js";
import { Screen } from "./screen.js";
import { mirrorTui, startTui } from "./terminal.js";
import { bindScreen } from "./web.js";

export {
	CanvasPainter,
	cssColor,
	DEFAULT_THEME,
	DEFAULT_TYPEFACE,
	fontString,
} from "./paint-canvas.js";

// A cell of a monospace typeface on context, in pixels: a digit's advance by a line.
export function cellSize(context, typeface = DEFAULT_TYPEFACE) {
	context.font = fontString(typeface);
	const width = context.measureText("0000000000").width / 10;
	return { width: width > 0 ? width : typeface.size * 0.6, height: lineHeightOf(typeface) };
}
const lineHeightOf = (typeface) => Math.max(1, Math.round(typeface.size * typeface.lineHeight));

// Metrics (metrics.js) in pixels, text measured in typeface on context; options are fontMetrics'
// (unitX, borderX, caret, ...) to change what it works out.
export function canvasMetrics(context, typeface = DEFAULT_TYPEFACE, options = {}) {
	if ("fontKerning" in context) context.fontKerning = "none";
	const measure = (text, font) => {
		context.font = fontString(typeface, font);
		return context.measureText(text).width;
	};
	return fontMetrics({ measure, lineHeight: lineHeightOf(typeface), ...options });
}

export class CanvasScreen extends Screen {
	// context: a 2D context; mode: "text" or "grid"; width and height: its size in pixels (CSS
	// pixels, drawn at pixelRatio device pixels each); metrics: text mode's, canvasMetrics' by
	// default; onPaint() hears each paint. The rest is what Screen takes.
	constructor({
		context,
		mode = "text",
		width = 640,
		height = 384,
		typeface = DEFAULT_TYPEFACE,
		theme = DEFAULT_THEME,
		pixelRatio = 1,
		metrics,
		onPaint = null,
		...options
	} = {}) {
		if (mode !== "text" && mode !== "grid") throw new RangeError(`no canvas mode ${mode}`);
		const grid = mode === "grid";
		const cell = grid ? cellSize(context, typeface) : { width: 1, height: 1 };
		const m = grid ? cellMetrics : (metrics ?? canvasMetrics(context, typeface));
		const units = (px, size) => Math.max(1, Math.floor(px / size));
		super({
			write: () => {},
			...options,
			metrics: m,
			width: units(width, cell.width),
			height: units(height, cell.height),
		});
		this.context = context;
		this.mode = mode;
		this.cell = cell;
		this.typeface = typeface;
		this.theme = theme;
		this.pixelRatio = pixelRatio;
		this.onPaint = onPaint;
	}
	// The point under a pixel (CSS pixels from its top left), in layout units, on the screen.
	pointAt(px, py) {
		const clamp = (v, max) => Math.min(max - 1, Math.max(0, Number.isFinite(v) ? v : 0));
		return {
			x: clamp(Math.floor(px / this.cell.width), this.width),
			y: clamp(Math.floor(py / this.cell.height), this.height),
		};
	}
	// How tall a line is in pixels: what a wheel's pixels scroll by.
	get linePixels() {
		return this.metrics.lineHeight * this.cell.height;
	}
	// Its size in CSS pixels.
	get pixelWidth() {
		return this.width * this.cell.width;
	}
	get pixelHeight() {
		return this.height * this.cell.height;
	}
	// A canvas this many CSS pixels big now: as many units as fit.
	resizePixels(width, height) {
		const units = (px, size) => Math.max(1, Math.floor(px / size));
		const w = units(width, this.cell.width);
		const h = units(height, this.cell.height);
		if (w !== this.width || h !== this.height) this.resize(w, h);
	}
	painter() {
		return new CanvasPainter(this.context, {
			width: this.width,
			height: this.height,
			metrics: this.metrics,
			scaleX: this.cell.width,
			scaleY: this.cell.height,
			grid: this.mode === "grid",
			typeface: this.typeface,
			theme: this.theme,
			pixelRatio: this.pixelRatio,
		});
	}
	// Lays out and paints, if anything changed.
	flush() {
		if (!this.document.dirty) return;
		this.document.dirty = false;
		this.layOut();
		this.paint(this.painter().begin());
		this.onPaint?.();
	}
	resize(width, height) {
		this.width = width;
		this.height = height;
		this.document.dirty = true;
		this.flush();
	}
}

// startTui's app, on a canvas: options are CanvasScreen's (context, mode, width, height,
// typeface, theme, pixelRatio) and startTui's (components, root and what Host takes).
export function startCanvas({
	context,
	mode,
	width,
	height,
	typeface,
	theme,
	pixelRatio,
	metrics,
	...options
}) {
	const screen = new CanvasScreen({
		context,
		mode,
		width,
		height,
		typeface,
		theme,
		pixelRatio,
		metrics,
	});
	return startTui({ ...options, screen });
}

// mirrorTui on a canvas: another host's app (one on the page), its events sent there; options
// are CanvasScreen's.
export const mirrorCanvas = (source, options) =>
	mirrorTui(source, { screen: new CanvasScreen(options) });

// Sends what's done on canvas (an element, focusable: it gets a tabIndex) to screen, as web.js's
// bindScreen does for a terminal's cells; returns what stops it.
export function bindCanvas(canvas, screen) {
	if (canvas.tabIndex < 0) canvas.tabIndex = 0;
	return bindScreen(canvas, screen, {
		cellAt: (e) => {
			const rect = canvas.getBoundingClientRect();
			return screen.pointAt(e.clientX - rect.left, e.clientY - rect.top);
		},
		rowHeight: () => screen.linePixels,
	});
}

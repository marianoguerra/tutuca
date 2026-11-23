// The Screen on a canvas (tutuca/tui/canvas): grid mode lays out in cells, as a terminal does,
// and text mode in pixels with a proportional font, attributes scaled from cells; both find what's
// under a pixel by the same hit test, and route it by tutuca's marker walk.
import assert from "node:assert/strict";
import test from "node:test";
import { Counter } from "../../demos/renders/examples/counter.js";
import {
	CanvasPainter,
	CanvasScreen,
	canvasMetrics,
	cssColor,
	startCanvas,
} from "../../src/tui/canvas.js";
import { startTui, TDocument, tuiTarget } from "../../src/tui/index.js";
import { scaleProps } from "../../src/tui/metrics.js";
import { enableTargets } from "../../src/tutuca.js";

enableTargets(tuiTarget);

// A 2D context that keeps what's drawn: fillText as { text, x, y, font, fillStyle }, the rest as
// [name, ...args]. A monospace font is 8px a character; any other is proportional: i is 3, m is
// 10, a space 4 and the rest 6, a pixel more in bold.
class FakeContext {
	constructor() {
		this.calls = [];
		this.texts = [];
		this.font = "10px sans-serif";
		this.fillStyle = "#000";
		this.strokeStyle = "#000";
		this.lineWidth = 1;
		this.globalAlpha = 1;
		this.fontKerning = "auto";
	}
	measureText(text) {
		if (this.font.includes("monospace")) return { width: [...text].length * 8 };
		const bold = this.font.includes("bold") ? 1 : 0;
		let width = 0;
		for (const ch of text) width += ({ i: 3, m: 10, " ": 4 }[ch] ?? 6) + bold;
		return { width };
	}
	fillText(text, x, y) {
		this.texts.push({ text, x, y, font: this.font, fillStyle: this.fillStyle });
	}
	reset() {
		this.calls = [];
		this.texts = [];
	}
}
for (const name of [
	"fillRect",
	"save",
	"restore",
	"beginPath",
	"rect",
	"clip",
	"moveTo",
	"lineTo",
	"arcTo",
	"stroke",
	"fill",
	"setLineDash",
	"setTransform",
	"roundRect",
]) {
	FakeContext.prototype[name] = function (...args) {
		this.calls.push([name, ...args]);
	};
}
const MONO = { family: "monospace", size: 16, lineHeight: 1 };
const SANS = { family: "sans-serif", size: 16, lineHeight: 1.25 };

const start = (mode, typeface, { width = 480, height = 160 } = {}) => {
	const context = new FakeContext();
	const { host, screen } = startCanvas({
		context,
		mode,
		width,
		height,
		typeface,
		components: { Counter },
		root: (C) => C.Counter(),
		schedule: () => () => {},
	});
	const drain = () => {
		while (host.tasks.length > 0) host.handleTasks();
		context.reset();
		screen.flush();
	};
	// The pixel a text was drawn at, a pixel in from its left.
	const pixelOf = (text) => {
		const drawn = context.texts.find((t) => t.text === text);
		assert.ok(drawn, `${text} isn't drawn: ${context.texts.map((t) => t.text).join(", ")}`);
		return [drawn.x + 1, drawn.y];
	};
	const clickPixel = ([px, py]) => {
		const { x, y } = screen.pointAt(px, py);
		screen.click(x, y);
		drain();
	};
	return { context, host, screen, drain, pixelOf, clickPixel };
};

test("grid mode lays out in cells as the terminal does, drawn in pixels", () => {
	const { screen, context } = start("grid", MONO, { width: 60 * 8, height: 14 * 16 });
	assert.equal(screen.width, 60);
	assert.equal(screen.height, 14);
	const { screen: terminal } = startTui({
		components: { Counter },
		root: (C) => C.Counter(),
		width: 60,
		height: 14,
		schedule: () => () => {},
	});
	// The same cells: grid mode's layout is the terminal's.
	assert.equal(screen.toString(), terminal.toString());
	// Borders are lines, not characters; the text is drawn a grapheme a cell.
	assert.ok(!context.texts.some((t) => /[╭─╮│╰╯]/.test(t.text)));
	assert.ok(
		context.calls.some(([name]) => name === "arcTo"),
		"round corners are arcs",
	);
	const zero = context.texts.find((t) => t.text === "0");
	assert.equal(zero.x % 8, 0);
});

test("a click at a pixel in grid mode reaches the handler under it", () => {
	const { host, pixelOf, clickPixel, context } = start("grid", MONO);
	clickPixel(pixelOf("+"));
	clickPixel(pixelOf("+"));
	assert.equal(host.root.count, 2);
	assert.ok(context.texts.some((t) => t.text === "2"));
	clickPixel(pixelOf("−"));
	assert.equal(host.root.count, 1);
});

test("text mode lays out in pixels: attributes scaled from cells, text measured in its font", () => {
	const { screen, host, pixelOf, clickPixel } = start("text", SANS);
	const m = screen.metrics;
	assert.equal(m.lineHeight, 20);
	assert.equal(m.unitX, 6); // A digit, in the fake proportional font.
	// The − box: paddingX "1" is a cell across, its round border half one.
	const minus = screen.layout.children[0].children[0];
	assert.deepEqual(minus.inset, {
		top: m.borderY,
		bottom: m.borderY,
		left: m.borderX + m.unitX,
		right: m.borderX + m.unitX,
	});
	assert.equal(minus.rect.h, m.lineHeight + 2 * m.borderY);
	clickPixel(pixelOf("+"));
	assert.equal(host.root.count, 1);
});

test("scaleProps scales each length by its axis, and leaves percentages and keywords", () => {
	const m = { scales: true, unitX: 8, unitY: 20 };
	assert.deepEqual(scaleProps({ padding: 1, paddingX: 2, width: "50%", gap: 1, top: 2 }, m), {
		padding: 1,
		paddingX: 2,
		paddingTop: 20,
		paddingBottom: 20,
		paddingLeft: 16,
		paddingRight: 16,
		width: "50%",
		gap: 1,
		columnGap: 8,
		rowGap: 20,
		top: 40,
	});
	assert.deepEqual(scaleProps({ margin: "auto", flexBasis: 3 }, m, true), {
		margin: "auto",
		marginTop: "auto",
		marginBottom: "auto",
		marginLeft: "auto",
		marginRight: "auto",
		flexBasis: 24,
	});
});

// A CanvasScreen on a tree made by hand, painted.
const screenOf = (build, { mode = "text", width = 300, height = 100 } = {}) => {
	const context = new FakeContext();
	const document = new TDocument();
	const screen = new CanvasScreen({ context, mode, width, height, typeface: SANS, document });
	build(document, screen.rootNode);
	screen.flush();
	return { context, screen };
};
const make = (document, tag, attrs = {}, ...children) => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	for (const c of children) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
	return el;
};

test("text mode hit tests a span by its measured width", () => {
	let word;
	const { screen } = screenOf((doc, root) => {
		word = make(doc, "text", { color: "red" }, "mmmm");
		root.appendChild(make(doc, "text", {}, "iiii", word));
	});
	// iiii is 12px: x 13 is on mmmm, as it wouldn't be in cells.
	assert.equal(screen.hitAt(13, 5), word);
	assert.notEqual(screen.hitAt(11, 5), word);
	// Past its 52px, the box it's in.
	assert.equal(screen.hitAt(60, 5), screen.rootNode);
});

test("a click in text mode puts an input's caret at the grapheme nearest the pixel", () => {
	let input;
	const { screen } = screenOf((doc, root) => {
		input = make(doc, "input", { width: "20" });
		input.value = "iiimmm";
		root.appendChild(input);
	});
	const r = input.rect;
	// iii ends at 9; the first m is 9 to 19, its middle 14.
	screen.click(r.x + 15, r.y + 1);
	assert.equal(screen.focused, input);
	assert.equal(input.selectionStart, 4);
	screen.click(r.x + 13, r.y + 1);
	assert.equal(input.selectionStart, 3);
});

test("the wheel and arrows scroll a scroll container by lines, in pixels", () => {
	let list;
	const { screen } = screenOf(
		(doc, root) => {
			list = make(doc, "box", { height: "3", overflow: "scroll", focusable: "true" });
			for (let i = 0; i < 20; i++) list.appendChild(make(doc, "text", {}, `row ${i}`));
			root.appendChild(list);
		},
		{ height: 200 },
	);
	const line = screen.metrics.lineHeight;
	assert.equal(list.clientHeight, 3 * line);
	screen.wheel(list.rect.x + 1, list.rect.y + 1);
	screen.flush();
	assert.equal(list.scrollTop, 3 * line);
	screen.focus(list);
	screen.key({ key: "ArrowDown" });
	assert.equal(list.scrollTop, 4 * line);
});

test("border styles draw as what their characters are: lines, doubles and blocks", () => {
	const strokes = (context) => context.calls.filter(([n]) => n === "stroke").length;
	const blocks = (context) => context.calls.filter(([n]) => n === "fillRect").length;
	const boxed = (borderStyle) =>
		screenOf((doc, root) => {
			root.appendChild(
				make(doc, "box", { borderStyle, width: "10", height: "3", borderText: "hi" }),
			);
		}).context;
	const single = boxed("single");
	const double = boxed("double");
	assert.ok(strokes(double) > strokes(single), "a double line is two");
	assert.ok(
		single.texts.some((t) => t.text === " hi "),
		"the title is in the top border",
	);
	const thick = boxed("thick");
	assert.ok(blocks(thick) > blocks(single), "block styles fill their cells' parts");
	assert.ok(!thick.texts.some((t) => /[█▀▄]/.test(t.text)));
});

test("colors: names and 0-255 from the theme's palette, hex and CSS as they are", () => {
	assert.equal(cssColor("red"), "#cd3131");
	assert.equal(cssColor(9), "#f14c4c");
	assert.equal(cssColor("196"), "#ff0000");
	assert.equal(cssColor("#123456"), "#123456");
	assert.equal(cssColor("rebeccapurple"), "rebeccapurple");
	assert.equal(cssColor(undefined), null);
});

test("a painter draws in the metrics it's given: canvasMetrics measures its context", () => {
	const context = new FakeContext();
	const m = canvasMetrics(context, SANS);
	assert.equal(m.measureOf({ font: { bold: false } })("m", 0), 10);
	assert.equal(m.measureOf({ font: { bold: true } })("m", 0), 11);
	const painter = new CanvasPainter(context, { width: 10, height: 10, metrics: m, typeface: SANS });
	painter.begin();
	assert.deepEqual(context.calls.at(-1), ["fillRect", 0, 0, 10, 10]);
});

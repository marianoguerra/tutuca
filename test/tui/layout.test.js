import assert from "node:assert/strict";
import test from "node:test";
import { absolutize, calculateLayout, layoutTree, TDocument } from "../../src/tui/index.js";

// A layout input from a compact description: [props, ...children], strings as text.
const box = (props = {}, ...children) => ({
	type: "box",
	props,
	children: children.map((c) =>
		typeof c === "string" ? { type: "text", props: { children: c }, children: [] } : c,
	),
});
const rects = (layout) => layout.children.map(({ x, y, width, height }) => [x, y, width, height]);

test("a row places children side by side with gap; flexGrow shares what's left", () => {
	const l = calculateLayout(
		box({ flexDirection: "row", gap: 1 }, "ab", box({ flexGrow: 1 }), "cd"),
		20,
		5,
	);
	assert.deepEqual(rects(l), [
		[0, 0, 2, 1],
		[3, 0, 14, 0],
		[18, 0, 2, 1],
	]);
});

test("justifyContent spreads a row, alignItems places on the cross axis", () => {
	const row = (justify) =>
		rects(
			calculateLayout(
				box({ flexDirection: "row", justifyContent: justify, width: 10 }, "a", "b"),
				10,
				3,
			),
		);
	assert.deepEqual(
		row("space-between").map((r) => r[0]),
		[0, 9],
	);
	assert.deepEqual(
		row("center").map((r) => r[0]),
		[4, 5],
	);
	assert.deepEqual(
		row("flex-end").map((r) => r[0]),
		[8, 9],
	);
	const col = calculateLayout(box({ alignItems: "center", width: 10 }, "abcd"), 10, 3);
	assert.deepEqual(rects(col), [[3, 0, 4, 1]]);
});

test("borders and padding take space; children are relative to the content box", () => {
	const l = calculateLayout(box({ borderStyle: "single", padding: 1 }, "hi"), 20, 10);
	assert.equal(l.width, 6);
	assert.equal(l.height, 5);
	assert.deepEqual(rects(l), [[0, 0, 2, 1]]);
	absolutize(l, 0, 0);
	assert.deepEqual(l.children[0].rect, { x: 2, y: 2, w: 2, h: 1 });
});

test("overflowing rows shrink by whole columns, the wider sibling first", () => {
	const l = calculateLayout(
		box({ flexDirection: "row" }, box({ width: 8 }), box({ width: 2 })),
		9,
		1,
	);
	assert.deepEqual(
		l.children.map((c) => c.width),
		[7, 2],
	);
});

test("flexWrap moves what doesn't fit to the next line", () => {
	const l = calculateLayout(
		box({ flexDirection: "row", flexWrap: "wrap", columnGap: 1 }, "aaa", "bbb", "ccc"),
		8,
		5,
	);
	assert.deepEqual(rects(l), [
		[0, 0, 3, 1],
		[4, 0, 3, 1],
		[0, 1, 3, 1],
	]);
});

test("sizes take percentages and fill; absolute children sit by their offsets and take no space", () => {
	const l = calculateLayout(
		box(
			{ width: 20, height: 10 },
			box({ width: "50%", height: 2 }),
			box({ position: "absolute", right: 0, bottom: 0 }, "x"),
		),
		20,
		10,
	);
	assert.deepEqual(rects(l), [
		[0, 0, 10, 2],
		[19, 9, 1, 1],
	]);
});

test("text wraps to its box, and a column grows to hold it", () => {
	const l = calculateLayout(box({ width: 6 }, "aaa bbb ccc"), 20, 10);
	assert.equal(l.height, 3);
	assert.deepEqual(l.children[0].lines, ["aaa", "bbb", "ccc"]);
});

test("layoutTree reads the terminal DOM: attributes parsed, comments skipped, bare text runs merged", () => {
	const doc = new TDocument();
	const el = doc.createElement("box");
	el.setAttribute("flexDirection", "row");
	el.setAttribute("padding", "1");
	el.setAttribute("borderTop", "false");
	const nodes = [
		doc.createComment("§{}§"),
		doc.createTextNode("Count: "),
		doc.createTextNode("3"),
		doc.createElement("text"),
	];
	for (const node of nodes) el.appendChild(node);
	el.childNodes[3].appendChild(doc.createTextNode("\x1b[31mred"));
	const tree = layoutTree(el);
	assert.deepEqual(tree.props, { flexDirection: "row", padding: 1, borderTop: false });
	assert.deepEqual(
		tree.children.map((c) => [c.type, c.props.children]),
		[
			["text", "Count: 3"],
			["text", "red"],
		],
	);
	assert.throws(() => {
		el.setAttribute("gap", "wide");
		layoutTree(el);
	}, /gap must be a number/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canvas, canvasComponents } from "../../components/canvas/index.js";
import { Driver } from "../../src/testing/driver.js";
import { idOf, Selector, scopeOf } from "../../src/tutuca.js";
import { document, scopeWith, tick } from "../helpers.js";

const start = () => {
	const C = scopeWith(canvasComponents).components;
	return new Driver({ root: canvas(C, [[40, 60, "kanban", "Board"]]), document });
};
const clone = (d, key) => {
	const card = d.rootNode.querySelectorAll("foreignObject > .canvas-card")[
		d.state.order.indexOf(key)
	];
	card.querySelector('[aria-label="Clone"]').click();
	d.drain();
};

test("clone adds a copy of the item, a little down and right of it, in front", () => {
	const d = start();
	clone(d, "item-1");
	const [first, key] = d.state.order;
	assert.equal(first, "item-1");
	const original = d.state.items[first];
	const copied = d.state.items[key];
	assert.deepEqual([copied.x, copied.y], [original.x + 24, original.y + 24]);
	assert.deepEqual(
		[copied.width, copied.label, copied.title],
		[original.width, original.label, original.title],
	);
	assert.notEqual(idOf(copied), idOf(original));
	assert.notEqual(idOf(copied.content), idOf(original.content));
	// Everything in it is new too: the board's columns.
	const columnOf = (item) => item.content.columns[0];
	assert.notEqual(idOf(columnOf(copied)), idOf(columnOf(original)));
	assert.equal(columnOf(copied).title, columnOf(original).title);
	assert.deepEqual(d.problems, []);
});

test("a clone changes on its own", () => {
	const d = start();
	clone(d, "item-1");
	const key = d.state.order[1];
	d.host.apply("moveTo", [300, 300], { to: (p) => p.field("items").item(key) });
	d.drain();
	assert.deepEqual([d.state.items[key].x, d.state.items["item-1"].x], [300, 40]);
	assert.deepEqual(d.problems, []);
});

const toolLabels = (d) =>
	[...d.rootNode.querySelectorAll('[role="toolbar"] button')].map((b) => b.title);
const hasGroup = (d, label) =>
	d.rootNode.querySelector(`[role="group"][aria-label="${label}"]`) !== null;
const press = (d, title) => {
	d.rootNode.querySelector(`[role="toolbar"] button[title="${title}"]`).click();
	d.drain();
};

test("with the hole or select tool, only those and the drawing toggle show", () => {
	const d = start();
	assert.deepEqual(toolLabels(d), [
		"Add a component (H)",
		"Select and move shapes (V)",
		"Draw: lines, arrows, shapes and text",
	]);
	assert.equal(hasGroup(d, "Fill"), false);
	assert.equal(hasGroup(d, "Stroke"), false);
	press(d, "Select and move shapes (V)");
	assert.equal(toolLabels(d).length, 3);
	assert.equal(hasGroup(d, "Fill"), false);
});

test("the drawing toggle shows the drawing tools, fill and stroke, and hides them again", () => {
	const d = start();
	press(d, "Draw: lines, arrows, shapes and text");
	assert.deepEqual(toolLabels(d).length, 8);
	assert.equal(hasGroup(d, "Fill"), true);
	assert.equal(hasGroup(d, "Stroke"), true);
	press(d, "Rectangle, Shift for a square (R)");
	assert.equal(d.state.tool, "rect");
	// Hiding them leaves the drawing tool for select.
	press(d, "Hide the drawing tools");
	assert.equal(d.state.tool, "select");
	assert.equal(toolLabels(d).length, 3);
	assert.equal(hasGroup(d, "Fill"), false);
	assert.deepEqual(d.problems, []);
});

test("picking a drawing tool by its key shows them; the hole tool hides them", () => {
	const d = start();
	const root = d.rootNode.querySelector(".canvas-root");
	const key = (k) => {
		root.dispatchEvent(
			new document.defaultView.KeyboardEvent("keydown", { key: k, bubbles: true }),
		);
		d.drain();
	};
	key("l");
	assert.equal(d.state.tool, "line");
	assert.equal(hasGroup(d, "Fill"), true);
	key("h");
	assert.equal(hasGroup(d, "Fill"), false);
	assert.equal(toolLabels(d).length, 3);
});

// An item holding what says its data (DATA_META): the board, which loads a board's JSON.
const itemCard = (d, key) =>
	d.rootNode.querySelectorAll("foreignObject > .canvas-card")[d.state.order.indexOf(key)];
const itemAt = (key) => new Selector().item("items", key);

test("an item whose content says its data downloads it as JSON", async () => {
	const d = start();
	const saved = [];
	scopeOf(d.state).registerAskHandlers({ saveFile: (args) => saved.push(args) });
	itemCard(d, "item-1").querySelector('[aria-label="Download as JSON"]').click();
	d.drain();
	await tick();
	assert.equal(saved.length, 1);
	const [name, text] = saved[0];
	assert.equal(name, "board.json");
	assert.deepEqual(JSON.parse(text), d.state.items["item-1"].content.domain);
	assert.deepEqual(d.problems, []);
});

test("a JSON file dropped on an item's content loads into it, or says why not", () => {
	const d = start();
	const board = { columns: [{ title: "Only", cards: [{ id: "x", title: "One" }] }] };
	d.answer(itemAt("item-1"), "readText", "ok", [JSON.stringify(board)]);
	assert.equal(d.state.items["item-1"].content.columns[0].title, "Only");
	assert.equal(d.state.items["item-1"].dropError, "");
	d.answer(itemAt("item-1"), "readText", "ok", ['{ "columns": 3 }']);
	assert.match(d.state.items["item-1"].dropError, /isn't/);
	assert.equal(d.state.items["item-1"].content.columns[0].title, "Only", "the board kept");
	d.answer(itemAt("item-1"), "readText", "ok", ["nope"]);
	assert.match(d.state.items["item-1"].dropError, /is not JSON/);
	assert.deepEqual(d.problems, []);
});

test("an item whose content says no data has no download button", () => {
	const C = scopeWith(canvasComponents).components;
	const d = new Driver({ root: canvas(C, [[40, 60, "notes", "Notes"]]), document });
	assert.notEqual(d.rootNode.querySelector('[aria-label="Clone"]'), null);
	assert.equal(d.rootNode.querySelector('[aria-label="Download as JSON"]'), null);
});

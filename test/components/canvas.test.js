import assert from "node:assert/strict";
import test from "node:test";
import { canvas, canvasComponents } from "../../components/canvas/index.js";
import { Driver } from "../../src/test/driver.js";
import { idOf } from "../../src/tutuca.js";
import { document, scopeWith } from "../helpers.js";

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

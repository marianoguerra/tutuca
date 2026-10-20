import assert from "node:assert/strict";
import test from "node:test";
import { kanbanComponents } from "../../components/kanban/index.js";
import { sampleBoard } from "../../components/kanban/stories.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { document, scopeWith, testGenericProperties } from "../helpers.js";

testGenericProperties(kanbanComponents, { numRuns: 25 });

const start = () =>
	new Driver({ root: sampleBoard(scopeWith(kanbanComponents).components), document });
const titles = (d, column) => d.state.columns[column].cards.map((card) => card.title);

test("a card dropped on a card of another column goes where the drop lands", () => {
	const d = start();
	const [todo, doing] = d.rootNode.querySelectorAll(".grid > div");
	const [first] = todo.querySelectorAll('[data-dragtype="card"]');
	const [target] = doing.querySelectorAll('[data-dragtype="card"]');
	// The target card spans 100–140, so a drop at 110 is above its middle.
	target.getBoundingClientRect = () => ({ top: 100, height: 40 });
	const Event = document.defaultView.Event;
	first.dispatchEvent(new Event("dragstart", { bubbles: true }));
	const drop = Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {});
	Object.defineProperty(drop, "clientY", { value: 110 });
	target.querySelector("span").dispatchEvent(drop);
	first.dispatchEvent(new Event("dragend", { bubbles: true }));
	d.drain();
	assert.deepEqual(titles(d, 1), ["Write the drag and drop docs", "Review the event routing"]);
	assert.deepEqual(d.problems, []);
});

test("a drag that isn't a card changes nothing", () => {
	const d = start();
	const before = d.state;
	const [, doing] = d.rootNode.querySelectorAll(".grid > div");
	dispatchDrag(doing.querySelector("h2"), doing);
	d.drain();
	assert.equal(d.state, before);
});

import assert from "node:assert/strict";
import test from "node:test";
import { kanbanComponents } from "../../components/kanban/index.js";
import { sampleBoard } from "../../components/kanban/stories.js";
import { Driver } from "../../src/testing/driver.js";
import { document, scopeWith, testGenericProperties, testRendersItsCode } from "../helpers.js";

testRendersItsCode(kanbanComponents);

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
	d.drag(doing.querySelector("h2"), doing);
	assert.equal(d.state, before);
});

test("in a terminal, a card's → and ← shift it a column, and stay at the board's ends", async () => {
	const { startTui } = await import("../../src/tui/index.js");
	const { host, screen } = startTui({
		components: kanbanComponents,
		root: sampleBoard,
		width: 72,
		height: 20,
		write: () => {},
		schedule: () => () => {},
	});
	const drain = () => {
		while (host.tasks.length > 0) host.handleTasks();
		screen.flush();
	};
	drain();
	// The arrow on the row of the card's title.
	const press = (title, arrow) => {
		const rows = screen.toString().split("\n");
		const y = rows.findIndex((r) => r.includes(title));
		const x = rows[y].indexOf(title);
		screen.click(rows[y].indexOf(arrow, arrow === "←" ? x - 3 : x), y);
		drain();
	};
	const titlesOf = (column) => host.root.columns[column].cards.map((card) => card.title);
	press("Review the", "→");
	assert.deepEqual(titlesOf(1), []);
	assert.deepEqual(titlesOf(2), ["Review the event routing"]);
	press("Review the", "→");
	assert.deepEqual(titlesOf(2), ["Review the event routing"], "Done is the last column");
	press("Port the", "←");
	assert.deepEqual(titlesOf(0).length, 3, "To do is the first");
});

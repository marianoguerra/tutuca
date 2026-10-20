import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { compositionComponents, notebook, Picker } from "../../components/composition/index.js";
import { NOW } from "../../components/thing-tracker/fixtures.js";
import { Driver } from "../../src/test/driver.js";
import { arbitraries, eventCommands, runCommands } from "../../src/test/pbt.js";
import { specOf } from "../../src/tutuca.js";
import { document, scopeWith, testGenericProperties } from "../helpers.js";

// A cell can hold any component, so random notebooks are too big to generate: the stress test
// below drives a notebook of every kind instead.
testGenericProperties({ Picker }, { registered: compositionComponents, numRuns: 15 });

const ALL = ["notes", "todos", "kanban", "drawing", "tracker", "notebook"];
const start = (kinds = ALL) =>
	new Driver({
		root: notebook(scopeWith(compositionComponents).components, { kinds, now: NOW }),
		document,
	});
const cells = (state) => state.order.map((key) => state.entries[key]);

test("the libraries' components share one scope without name collisions", () => {
	const d = start();
	assert.deepEqual(
		cells(d.state).map((cell) => specOf(cell.content).name),
		["Notes", "TodoApp", "Board", "Drawing", "TrackerCell", "Notebook"],
	);
});

test("ctrl+click on a cell's toggle collapses every cell, and expands them again", () => {
	const d = start();
	const { MouseEvent } = document.defaultView;
	const ctrlClick = (el) => {
		el.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
		d.drain();
	};
	const toggles = () =>
		d.rootNode.querySelectorAll(':scope > div > div [title^="Collapse or expand"]');
	ctrlClick(toggles()[2]);
	assert.deepEqual(
		cells(d.state).map((c) => c.collapsed),
		ALL.map(() => true),
	);
	// The inner notebook's cells are its own: they stay as they were.
	assert.equal(cells(cells(d.state)[5].content)[0].collapsed, false);
	ctrlClick(toggles()[0]);
	assert.deepEqual(
		cells(d.state).map((c) => c.collapsed),
		ALL.map(() => false),
	);
	assert.deepEqual(d.problems, []);
});

test("a cell of an inner notebook dropped between outer cells stays where it is", () => {
	const d = start(["notes", "notebook"]);
	const before = d.state;
	const inner = d.rootNode.querySelectorAll("header")[2]; // The inner notebook's picker cell.
	const { Event } = document.defaultView;
	inner.dispatchEvent(new Event("dragstart", { bubbles: true }));
	const gap = d.rootNode.querySelector(":scope > div > div:last-child");
	gap.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
	inner.dispatchEvent(new Event("dragend", { bubbles: true }));
	d.drain();
	assert.equal(d.state, before);
});

test("events in every kind of cell keep the notebook valid, and no notify leaks out of one", () => {
	const scope = scopeWith(compositionComponents);
	const A = arbitraries({ fc, scope });
	const root = notebook(scope.components, { kinds: ALL, now: NOW });
	const warn = console.warn;
	const warnings = [];
	console.warn = (...args) => warnings.push(args.slice(0, 2).join(" "));
	try {
		fc.assert(
			fc.property(eventCommands(A, { maxCommands: 15 }), (cmds) =>
				runCommands(A, root, cmds, { document }),
			),
			{ numRuns: 10, seed: 7 },
		);
	} finally {
		console.warn = warn;
	}
	assert.deepEqual(warnings, []);
});

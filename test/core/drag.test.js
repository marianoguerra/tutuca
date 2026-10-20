// Drag and drop: the host's drag, dragKey(), drop events bubbling to enclosing components.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Planets } from "../../site/examples/drag-and-drop.js";
import { Driver } from "../../src/test/driver.js";
import {
	arbitraries,
	dispatchDrag,
	dispatchOn,
	eventCommands,
	runCommands,
} from "../../src/test/pbt.js";
import {
	component,
	DispatchPath,
	Drag,
	dragKey,
	each,
	Frame,
	field,
	h,
	renderEach,
	renderIt,
	Scope,
	send,
	sourceKey,
	t,
} from "../../src/tutuca.js";
import { document } from "../helpers.js";

const start = (specs, make) => {
	const scope = new Scope(() => {});
	scope.register(specs);
	return new Driver({ root: make(scope.components), document });
};

const List = component({
	name: "List",
	fields: { items: t.array(), dropped: t.any(null), seen: t.any(null) },
	view: h(
		"ul",
		{},
		each(
			field("items"),
			h(
				"li",
				{
					draggable: "true",
					"data-dragtype": "item",
					"@on.drop": send("move", dragKey(), sourceKey()),
					"@on.dragstart": send("started", dragKey()),
				},
				field("label"),
			),
		),
	),
	on: {
		move(draft, [from, to], ctx) {
			draft.dropped = [from, to, ctx.drag?.type ?? null];
			const [item] = draft.items.splice(from, 1);
			draft.items.splice(to, 0, item);
		},
		started(draft, [key]) {
			draft.seen = key;
		},
	},
});
const items = ["a", "b", "c"].map((label) => ({ label }));

test("dropping an item on another moves it, with dragKey the dragged one's key", () => {
	const d = start({ List }, (C) => C.List({ items }));
	const lis = () => [...d.rootNode.querySelectorAll("li")];
	dispatchDrag(lis()[0], lis()[2]);
	d.drain();
	assert.deepEqual(d.state.dropped, [0, 2, "item"]);
	assert.equal(d.state.seen, 0, "dragKey is set in dragstart too");
	assert.deepEqual(
		lis().map((li) => li.textContent),
		["b", "c", "a"],
	);
	assert.deepEqual(d.problems, []);
});

test("the dragged element and the drop target under it are marked until the drag ends", () => {
	const d = start({ List }, (C) => C.List({ items }));
	const [first, , third] = d.rootNode.querySelectorAll("li");
	dispatchOn(first, "dragstart");
	assert.equal(first.dataset.dragging, "");
	const over = new document.defaultView.Event("dragover", { bubbles: true, cancelable: true });
	third.dispatchEvent(over);
	assert.equal(over.defaultPrevented, true, "a drop target accepts the drop");
	assert.equal(third.dataset.draggingover, "item");
	dispatchOn(first, "dragend");
	assert.equal(first.dataset.dragging, undefined);
	assert.equal(third.dataset.draggingover, undefined);
	assert.equal(d.host.drag, null);
});

test("dragover outside any drop target doesn't accept the drop", () => {
	const Plain = component({
		name: "Plain",
		fields: { n: t.number() },
		view: h("div", {}, h("p", { class: "away" }, "x"), h("p", { "@on.drop": send("d") }, "y")),
		on: { d() {} },
	});
	const d = start({ Plain }, (C) => C.Plain());
	const over = new document.defaultView.Event("dragover", { bubbles: true, cancelable: true });
	d.rootNode.querySelector(".away").dispatchEvent(over);
	assert.equal(over.defaultPrevented, false);
});

// A board of columns, each a component with draggable cards; only the board handles drops.
const Card = component({
	name: "Card",
	fields: { id: t.string() },
	view: h("p", { draggable: "true", "data-dragtype": "card" }, h("span", {}, field("id"))),
});
const Column = component({
	name: "Column",
	fields: { cards: t.array(t.component("Card")) },
	view: h(
		"section",
		{},
		h("button", { "@on.focus": send("noop") }, "·"),
		renderEach(field("cards")),
	),
	on: { noop() {} },
});
const Board = component({
	name: "Board",
	fields: { columns: t.array(t.component("Column")), log: t.array(), clicks: t.number() },
	view: h(
		"div",
		{},
		each(
			field("columns"),
			h(
				"div",
				{
					class: "col",
					"@on.drop": send("dropCard", sourceKey(), dragKey()),
					"@on.click": send("clicked"),
				},
				renderIt(),
			),
		),
	),
	on: {
		dropCard(draft, [to, from], ctx) {
			draft.log.push([to, from, ctx.drag.value.id]);
		},
		clicked(draft) {
			draft.clicks++;
		},
	},
});
const board = (C) =>
	C.Board({
		columns: [
			C.Column({ cards: [C.Card({ id: "x" }), C.Card({ id: "y" })] }),
			C.Column({ cards: [] }),
		],
	});

test("a drop on a child component's elements reaches the enclosing component's handler", () => {
	const d = start({ Card, Column, Board }, board);
	const [, y] = d.rootNode.querySelectorAll("p");
	const [, second] = d.rootNode.querySelectorAll("section");
	dispatchDrag(y.querySelector("span"), second);
	d.drain();
	// The drop came through the second column; the card was dragged from the first.
	assert.deepEqual(d.state.log, [[1, 0, "y"]]);
	assert.deepEqual(d.problems, []);
});

test("other events stay in the component they happen in", () => {
	const d = start({ Card, Column, Board }, board);
	d.rootNode.querySelector("p").click();
	d.drain();
	assert.equal(d.state.clicks, 0);
});

test("Drag.keyIn is the child of the receiver the drag came from, null from elsewhere", () => {
	const item = (keys, key, isComponent = true) => new Frame(keys, key, null, isComponent);
	const drag = new Drag(
		new DispatchPath([item(["columns"], 0), item(["cards"], 1)]),
		null,
		null,
		null,
	);
	assert.equal(drag.keyIn(new DispatchPath()), 0);
	assert.equal(drag.keyIn(new DispatchPath([item(["columns"], 0)])), 1);
	assert.equal(drag.keyIn(new DispatchPath([item(["columns"], 1)])), null);
});

test("generated drags keep the state valid and the patched DOM equal to a fresh render", () => {
	const scope = new Scope(() => {});
	scope.register({ Planets });
	const A = arbitraries({ fc, scope });
	const root = scope.components.Planets({ items: ["a", "b", "c", "d"] });
	fc.assert(
		fc.property(eventCommands(A), (cmds) => runCommands(A, root, cmds, { document })),
		{ numRuns: 30 },
	);
});

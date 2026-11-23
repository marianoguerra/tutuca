// A component's page as an outline, rendered without a document: what a model that drives it
// reads instead of seeing it.
import assert from "node:assert/strict";
import test from "node:test";
import { pageOutline, pageOutlineText } from "../../src/meta/index.js";
import {
	component,
	each,
	field,
	h,
	renderEach,
	Scope,
	send,
	sourceKey,
	t,
	targetValue,
} from "../../src/tutuca.js";

const Item = component({
	name: "Item",
	fields: { title: t.string(), done: t.boolean() },
	on: {
		toggle(next) {
			next.done = !next.done;
		},
	},
	view: h(
		"li",
		{ class: "flex gap-2" },
		h("input", { type: "checkbox", checked: field("done"), "on:change": send("toggle") }),
		field("title"),
	),
});
const List = component({
	name: "List",
	fields: { items: t.array(t.component("Item")), draft: t.string() },
	queries: {
		left() {
			return `${this.items.filter((i) => !i.done).length} left`;
		},
	},
	on: { add() {}, remove() {}, setDraft() {} },
	view: h(
		"div",
		{ class: "p-4" },
		h("h2", {}, field("left")),
		h("input", {
			placeholder: "What to do",
			value: field("draft"),
			"on:input": send("setDraft", targetValue()),
			"on:keydown+enter": send("add"),
		}),
		h("ul", {}, renderEach(field("items"))),
		h("p", {}, each(field("items"), h("button", { "on:click": send("remove", sourceKey()) }, "x"))),
	),
});
const list = () => {
	const scope = new Scope();
	scope.register({ Item, List });
	const item = (title, done = false) => scope.make("Item", { title, done });
	return scope.make("List", { items: [item("Milk", true), item("Eggs")], draft: "Br" });
};

test("an outline has the text, the inputs' values and what each event sends, nested components too", () => {
	assert.equal(
		pageOutlineText(pageOutline(list())),
		[
			"div",
			'  h2 "1 left"',
			'  input value="Br" placeholder="What to do" [input → setDraft(targetValue())] [keydown+Enter → add()]',
			"  ul",
			"    li",
			'      input type="checkbox" checked [change → toggle()]',
			'      "Milk"',
			"    li",
			'      input type="checkbox" [change → toggle()]',
			'      "Eggs"',
			"  p",
			'    button "x" [click → remove(sourceKey())]',
			'    button "x" [click → remove(sourceKey())]',
		].join("\n"),
	);
});

test("as data: items are { text } or { tag, attrs, sends, children }, without markers or classes", () => {
	const [div] = pageOutline(list());
	assert.equal(div.tag, "div");
	assert.deepEqual(div.attrs, {});
	assert.deepEqual(div.children[0], {
		tag: "h2",
		attrs: {},
		sends: [],
		children: [{ text: "1 left" }],
	});
	assert.deepEqual(div.children[1].sends, [
		{ event: "input", name: "setDraft", args: ["targetValue()"] },
		{ event: "keydown+Enter", name: "add", args: [] },
	]);
});

test("a long outline is cut, saying how much; long text too", () => {
	const text = pageOutlineText(pageOutline(list()), { maxLines: 3, maxText: 3 });
	assert.equal(
		text,
		[
			"div",
			'  h2 "1 l…"',
			'  input value="Br" placeholder="Wha…" [input → setDraft(targetValue())] [keydown+Enter → add()]',
			"… 10 more lines",
		].join("\n"),
	);
});

test("what the view shows wrong shows: a method read as a field is a warning, not its source", () => {
	const Bad = component({
		name: "Bad",
		fields: { n: t.number() },
		methods: {
			twice() {
				return this.n * 2;
			},
		},
		view: h("p", {}, field("twice")),
	});
	const error = console.error;
	console.error = () => {}; // The vdom says it there too.
	try {
		assert.equal(
			pageOutlineText(pageOutline(Bad.make({}))),
			'p "⚠ twice is a function, not a value: read what it returns"',
		);
	} finally {
		console.error = error;
	}
	const Empty = component({ name: "Empty", view: h("div", {}) });
	assert.equal(pageOutlineText(pageOutline(Empty.make({}))), "div");
	const Nothing = component({ name: "Nothing", view: "" });
	assert.equal(pageOutlineText(pageOutline(Nothing.make({}))), "(nothing)");
});

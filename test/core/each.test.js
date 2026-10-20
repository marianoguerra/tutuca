import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "../../src/lint/index.js";
import {
	$if,
	component,
	each,
	field,
	Host,
	h,
	lookupBind,
	scope,
	send,
	sourceKey,
	t,
} from "../../src/tutuca.js";
import { startHost, vh as vdomH } from "../helpers.js";

// Unmanaged-event and basic keyed-loop cases are covered in events.test.js and
// composition.test.js.

const hVNode = (tag, text) => vdomH(tag, {}, text);

const ITEMS = [
	{ id: "a", title: "A" },
	{ id: "b", title: "B" },
	{ id: "c", title: "C" },
];
const listFields = () => ({
	items: t.array().default(ITEMS),
	hidden: t.any(),
	picked: t.any(),
});
const listOptions = {
	name: "List",
	fields: listFields(),
	methods: {
		itemKey(_index, value) {
			return value.id;
		},
		include(_index, value) {
			return value.id !== this.hidden;
		},
		enrich({ value }) {
			return { title: value.title };
		},
	},
	loops: {
		items: {
			key(index, value) {
				return this.itemKey(index, value);
			},
			filter(index, value) {
				return this.include(index, value);
			},
			enrich(binds) {
				return this.enrich(binds);
			},
		},
		keyed: {
			key(index, value) {
				return this.itemKey(index, value);
			},
		},
		enriched: {
			enrich(binds) {
				return this.enrich(binds);
			},
		},
	},
	view: h(
		"div",
		{},
		each(
			field("items"),
			h("button", { "on:click": send("pick", sourceKey()) }, lookupBind("title")),
			"items",
		),
	),
	on: {
		pick(draft, [key]) {
			draft.picked = draft.items[key].id;
		},
	},
};
const List = component(listOptions);

const setup = (Comp = List) => startHost(Comp);

test("registration snapshots the loops", () => {
	const loops = { ...listOptions.loops };
	const OptionsList = component({
		...listOptions,
		name: "OptionsList",
		loops,
		view: each(
			field("items"),
			h("button", { "on:click": send("pick", sourceKey()) }, lookupBind("title")),
			"items",
		),
	});
	const { host, rootNode, C } = setup(OptionsList);
	loops.items = { key: () => "missing" };
	const [a, b, c] = rootNode.querySelectorAll("button");
	assert.equal(rootNode.textContent, "ABC");
	host.rootComponent = C.Comp({ items: [...ITEMS].reverse(), hidden: "b" });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("button")], [c, a]);
	assert.equal(b.parentNode, null);
	c.click();
	assert.equal(host.rootComponent.picked, "c");
});

test("XEach keyWith preserves nodes and refreshes event index metadata after reorder/filter", () => {
	const { host, rootNode, C } = setup();
	const [a, b, c] = rootNode.querySelectorAll("button");
	host.rootComponent = C.Comp({ items: [...ITEMS].reverse() });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("button")], [c, b, a]);
	c.click();
	assert.equal(host.rootComponent.picked, "c");
	// Event handling produces frozen state, so replace it for the next render.
	host.rootComponent = C.Comp({ items: [...ITEMS].reverse(), hidden: "b" });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("button")], [c, a]);
	a.click();
	assert.equal(host.rootComponent.picked, "a");
});

test("adjacent keyed XEach loops have independent key scopes", () => {
	const TwoLists = component({
		...listOptions,
		name: "TwoLists",
		view: h(
			"div",
			{},
			...[0, 1].map(() => each(field("items"), h("i", {}, lookupBind("key")), "keyed")),
		),
	});
	const { host, rootNode, C } = setup(TwoLists);
	assert.equal(rootNode.querySelectorAll("i").length, 6);
	host.rootComponent = C.Comp({ items: [...ITEMS].reverse() });
	host.render();
	assert.equal(rootNode.querySelectorAll("i").length, 6);
});

test("XEach rejects duplicate compared keys", () => {
	const { host, rootNode, C } = setup();
	const html = rootNode.innerHTML;
	const duplicated = C.Comp();
	duplicated.itemKey = () => "duplicate";
	host.rootComponent = duplicated;
	assert.throws(() => host.render(), /Duplicate sibling key/);
	assert.equal(rootNode.innerHTML, html);
});

test("XEach supports object sources, text, conditional empty output and multiple roots", () => {
	const Groups = component({
		...listOptions,
		name: "Groups",
		fields: { ...listFields(), items: t.map() },
		view: h(
			"div",
			{},
			each(
				field("items"),
				$if(lookupBind("title"), [hVNode("i", "one"), hVNode("b", "two")], null),
				"items",
			),
			each(field("items"), lookupBind("title"), "items"),
		),
	});
	const { host, rootNode, C } = setup(Groups);
	const A = { id: "a", title: "A" };
	const B = { id: "b", title: "B" };
	host.rootComponent = C.Comp({ items: { a: A, b: B } });
	host.render();
	const [a, b] = rootNode.querySelectorAll("i");
	host.rootComponent = C.Comp({ items: { b: B, a: A } });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("i")], [b, a]);
	host.rootComponent = C.Comp({ items: { b: B, a: { ...A, title: "" } } });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("i")], [b]);
	host.rootComponent = C.Comp({ items: { b: B, a: A } });
	host.render();
	assert.equal(rootNode.querySelectorAll("i").length, 2);
	// Each iteration has an opening and closing metadata boundary.
	assert.equal(
		[...rootNode.firstElementChild.childNodes].filter((n) => n.nodeType === 8).length,
		8,
	);
});

test("lint rejects loop and scope names the component does not declare", () => {
	const MissingLoop = component({
		...listOptions,
		name: "MissingLoop",
		view: each(field("items"), "x", "nope"),
	});
	const MissingScope = component({
		...listOptions,
		name: "MissingScope",
		view: scope("nope", "x"),
	});
	const InheritedName = component({
		...listOptions,
		name: "InheritedName",
		view: scope("toString", "x"),
	});
	const host = new Host({ document: null, rootNode: { addEventListener() {} } });
	host.scope.register({ MissingLoop, MissingScope, InheritedName });
	assert.deepEqual(
		lint(host.registrations).map(({ code, path }) => `${code} ${path}`),
		[
			"unknown-loop MissingLoop.main > each(nope)",
			"unknown-scope MissingScope.main > scope(nope)",
			"unknown-scope InheritedName.main > scope(toString)",
		],
	);
});

test("loops run on the component, not on the item, inside nested each", () => {
	const Nested = component({
		name: "Nested",
		fields: {
			rows: t.array().default([{ cells: ["a", "b"] }, { cells: ["c"] }]),
			prefix: t.string(">"),
		},
		loops: {
			cells: {
				enrich({ value }) {
					return { label: `${this.prefix}${value}` };
				},
			},
		},
		view: h("div", {}, each(field("rows"), each(field("cells"), lookupBind("label"), "cells"))),
	});
	const { rootNode } = setup(Nested);
	assert.equal(rootNode.textContent, ">a>b>c");
});

test("XEach defaults to source keys without keyWith", () => {
	const DefaultKeys = component({
		...listOptions,
		name: "DefaultKeys",
		fields: {
			...listFields(),
			items: t.map().default({ a: { title: "A" }, b: { title: "B" } }),
		},
		view: h("div", {}, each(field("items"), h("i", {}, lookupBind("title")), "enriched")),
	});
	const { host, rootNode, C } = setup(DefaultKeys);
	const [a, b] = rootNode.querySelectorAll("i");
	host.rootComponent = C.Comp({ items: { b: { title: "B" }, a: { title: "A" } } });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("i")], [b, a]);
});

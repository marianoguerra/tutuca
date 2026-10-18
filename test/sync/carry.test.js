import assert from "node:assert/strict";
import test from "node:test";
import { carry, specChanges } from "../../src/sync/index.js";
import { component, Scope, specOf, t, typeText } from "../../src/tutuca.js";

// The same components before and after an edit: each version registered in its own scope.
const scopeOf = (components) => {
	const scope = new Scope(() => {});
	scope.register(components);
	return scope;
};
const Item = (fields, opts = {}) => component({ name: "Item", fields, view: "<b></b>", ...opts });
const List = (fields = (t) => ({ title: t.string(), items: t.array(t.component("Item")) })) =>
	component({ name: "List", fields, view: "<ul></ul>" });
const v1 = Item((t) => ({ label: t.string(), done: t.boolean() }));
const made = () => {
	const scope = scopeOf({ List: List(), Item: v1 });
	const C = scope.components;
	return C.List({
		title: "todo",
		items: [C.Item({ label: "a", done: true }), C.Item({ label: "b" })],
	});
};

test("the same components carry everything and report nothing", () => {
	const prev = made();
	const scope = scopeOf({ List: List(), Item: v1 });
	const { root, added, reset, dropped, broken } = carry(prev, scope);
	assert.deepEqual(
		{ added, reset, dropped, broken },
		{ added: [], reset: [], dropped: [], broken: [] },
	);
	assert.equal(root.title, "todo");
	assert.deepEqual(
		root.items.map((i) => [i.label, i.done]),
		[
			["a", true],
			["b", false],
		],
	);
	assert.equal(specOf(root.items[0]), scope.lookupByName("Item"));
});

test("an added field takes its default and a removed one is dropped", () => {
	const v2 = Item((t) => ({ label: t.string(), priority: t.number(3) }));
	const { root, added, dropped, reset } = carry(made(), scopeOf({ List: List(), Item: v2 }));
	assert.deepEqual(added, [
		["items", 0, "priority"],
		["items", 1, "priority"],
	]);
	assert.deepEqual(dropped, [
		["items", 0, "done"],
		["items", 1, "done"],
	]);
	assert.deepEqual(reset, []);
	assert.equal(root.items[0].priority, 3);
	assert.equal(root.items[0].done, undefined);
});

test("a value the new type rejects is reset to its default", () => {
	const v2 = Item((t) => ({ label: t.string(), done: t.enum("open", "done") }));
	const { root, reset } = carry(made(), scopeOf({ List: List(), Item: v2 }));
	assert.deepEqual(reset, [
		{ path: ["items", 0, "done"], before: true, after: "open" },
		{ path: ["items", 1, "done"], before: false, after: "open" },
	]);
	assert.equal(root.items[0].done, "open");
});

test("a narrower type keeps the values that still fit", () => {
	const scope = scopeOf({ List: List(), Item: v1 });
	const prev = scope.components.List({ title: "ok" });
	const narrower = List((t) => ({ title: t.string().len(1), items: t.array(t.component("Item")) }));
	assert.deepEqual(carry(prev, scopeOf({ List: narrower, Item: v1 })).reset, []);
});

test("a component that's gone or a field without a default can't be carried", () => {
	assert.throws(() => carry(made(), scopeOf({ List: List() })), /No component Item/);
	const required = Item((t) => ({ label: t.string(), owner: t.component() }));
	assert.throws(() => carry(made(), scopeOf({ List: List(), Item: required })), /no default/);
});

test("components in a scope entered by name carry through their ref", () => {
	const AnyList = List((t) => ({ items: t.array(t.component()) }));
	const scope = scopeOf({ List: AnyList });
	scope.enter("editor").register({ Item: v1 });
	const item = scope.enter("editor").components.Item({ label: "x" });
	const prev = scope.components.List({ items: [item] });
	const next = scopeOf({ List: AnyList });
	next.enter("editor").register({ Item: v1 });
	const { root } = carry(prev, next);
	assert.equal(specOf(root.items[0]), next.enter("editor").lookupByName("Item"));
	assert.equal(root.items[0].label, "x");
});

test("a value the projection can't hold can't be carried", () => {
	const Clock = component({ name: "Clock", fields: (t) => ({ at: t.any() }), view: "<b></b>" });
	const prev = scopeOf({ Clock }).components.Clock({ at: new Date(0) });
	assert.throws(() => carry(prev, scopeOf({ Clock })), /can't sync a Date instance/);
});

test("invariants the carried state breaks are reported, and the state still carried", () => {
	const fewer = List();
	fewer.invariants = {
		atMostOne: function () {
			return this.items.length <= 1;
		},
	};
	const labelled = Item((t) => ({ label: t.string(), done: t.boolean() }), {
		invariants: {
			labelled() {
				return this.label !== "b";
			},
		},
	});
	const { root, broken } = carry(made(), scopeOf({ List: fewer, Item: labelled }));
	assert.equal(root.items.length, 2);
	assert.deepEqual(
		broken.map((i) => [i.path, i.component, i.reason]),
		[
			[["items", "1"], "Item", "invariant:labelled"],
			[[], "List", "invariant:atMostOne"],
		],
	);
});

test("specChanges tells the fields and components that changed by ref", () => {
	const v2 = Item((t) => ({ label: t.string("?"), priority: t.number(3).int() }));
	const Extra = component({ name: "Extra", fields: () => ({}), view: "<b></b>" });
	const changes = specChanges(scopeOf({ List: List(), Item: v1 }), scopeOf({ Item: v2, Extra }));
	assert.deepEqual(changes, [
		{ ref: "List", field: null, change: "removed", before: null, after: null },
		{
			ref: "Item",
			field: "label",
			change: "changed",
			before: 'string = ""',
			after: 'string = "?"',
		},
		{ ref: "Item", field: "done", change: "removed", before: "boolean = false", after: null },
		{ ref: "Item", field: "priority", change: "added", before: null, after: "number.int() = 3" },
		{ ref: "Extra", field: null, change: "added", before: null, after: null },
	]);
});

test("typeText writes a type like the builder that made it", () => {
	assert.equal(typeText(t.number(0).int().min(0)), "number.int().min(0) = 0");
	assert.equal(typeText(t.enum("a", "b").sync("local")), 'enum("a", "b").sync("local") = "a"');
	assert.equal(typeText(t.option(t.array(t.component("Item")))), 'array(component("Item")) = []?');
	assert.equal(typeText(t.record({ x: t.string() })), 'record(x: string = "")');
});

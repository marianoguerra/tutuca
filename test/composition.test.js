import assert from "node:assert/strict";
import test from "node:test";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import {
	component,
	each,
	field,
	Host,
	h,
	lookupBind,
	pushView,
	render,
	renderEach,
	renderIt,
	scope,
	scopeOf,
	seqItem,
	specOf,
} from "../src/tutuca.js";

function setup(specs) {
	const { document } = new JSDOM("").window;
	const rootNode = document.createElement("main");
	const host = new Host({ document, rootNode });
	host.scope.register(specs);
	return { host, rootNode, C: host.scope.components };
}

const metas = (rootNode) => {
	const out = [];
	const walk = (n) => {
		for (const c of n.childNodes) {
			if (c.nodeType === 8 && c.data !== "§/§") out.push(JSON.parse(c.data.slice(1, -1)));
			walk(c);
		}
	};
	walk(rootNode);
	return out;
};

const Item = component({
	name: "Item",
	fields: (t) => ({ label: t.string() }),
	views: { main: h("b", {}, field("label")), compact: h("i", {}, field("label")) },
});

for (const value of ["hello", 42, false, null]) {
	test(`literal ${String(value)} works in scope and each bodies`, () => {
		const expected = value == null ? "" : String(value);
		for (const [body, repetitions] of [
			[scope("bindings", value), 1],
			[each(field("items"), value), 2],
		]) {
			const Root = component({
				name: "Root",
				fields: (t) => ({ items: t.array().default([{}, {}]) }),
				scopes: { bindings: { bind: () => ({}) } },
				views: { main: body },
			});
			const { host, rootNode, C } = setup({ Root });
			host.start(C.Root());
			assert.equal(rootNode.textContent, expected.repeat(repetitions));
		}
	});
}

for (const [explicit, stack, expected] of [
	["compact", ["wide"], "compact"],
	["missing", ["wide", "compact"], "wide"],
	[undefined, ["missing", "compact", "wide"], "compact"],
	["missing", ["missing"], "default"],
	[undefined, [], "default"],
	[undefined, ["null", "wide"], "null"],
	["main", ["wide"], "default"],
	[undefined, ["main", "wide"], "default"],
	["toString", [], "default"],
]) {
	test(`view precedence: ${JSON.stringify([explicit, stack])}`, () => {
		const Child = component({
			name: "Child",
			views: { main: "default", compact: "compact", wide: "wide", null: "null" },
		});
		let tree = render(field("child"), explicit);
		// The inner push is the first candidate in the stack.
		for (const name of stack) tree = pushView(name, tree);
		const Root = component({
			name: "Root",
			fields: (t) => ({ child: t.component("Child") }),
			view: tree,
		});
		const { host, rootNode, C } = setup({ Root, Child });
		host.start(C.Root());
		assert.equal(rootNode.textContent, expected);
	});
}

for (const object of [false, true]) {
	for (const source of ["field", "seqItem"]) {
		for (const mode of ["renderEach", "each", "renderIt", "iter"]) {
			test(`${source} ${object ? "object" : "array"} collection: ${mode}`, () => {
				const src = source === "field" ? field("items") : seqItem("groups", "selected");
				const content =
					mode === "renderEach"
						? renderEach(src)
						: each(
								src,
								h("section", {}, mode === "renderIt" ? renderIt() : lookupBind("key")),
								mode === "iter" ? "iterate" : undefined,
							);
				const Panel = component({
					name: "Panel",
					fields: (t) => ({ items: t.any(), groups: t.array(), selected: t.number() }),
					loops: {
						iterate: {
							iter: (items) => (Array.isArray(items) ? items.entries() : Object.entries(items)),
						},
					},
					view: h("div", {}, content),
				});
				const { host, rootNode, C } = setup({ Panel, Item });
				const items = object
					? { a: C.Item({ label: "A" }), b: C.Item({ label: "B" }) }
					: [C.Item({ label: "A" }), C.Item({ label: "B" })];
				host.start(
					source === "field" ? C.Panel({ items }) : C.Panel({ groups: [[], items], selected: 1 }),
				);
				const shown = mode === "each" || mode === "iter" ? (object ? "ab" : "01") : "AB";
				assert.equal(rootNode.textContent, shown);
				const prefix = source === "field" ? ["items"] : ["groups", 1];
				const keys = object ? ["a", "b"] : [0, 1];
				const items_ = metas(rootNode).filter((m) => m.t === "frame");
				assert.deepEqual(
					items_,
					keys.map((i) => ({ t: "frame", p: null, k: prefix, i })),
				);
			});
		}
	}
}

test("render(seqItem) is a frame selecting the item", () => {
	const Tabs = component({
		name: "Tabs",
		fields: (t) => ({ tabs: t.array(t.component("Item")), selected: t.number() }),
		view: h("div", {}, render(seqItem("tabs", "selected"))),
	});
	const { host, rootNode, C } = setup({ Tabs, Item });
	host.start(C.Tabs({ tabs: [C.Item({ label: "a" }), C.Item({ label: "b" })], selected: 1 }));
	assert.equal(rootNode.textContent, "b");
	assert.deepEqual(metas(rootNode), [
		{ t: "component" },
		{ t: "frame", p: null, k: ["tabs"], i: 1 },
		{ t: "component" },
	]);
});

test("loop key, filter, prepare and enrich are called on the component", () => {
	const keyCalls = [];
	const Root = component({
		name: "Root",
		fields: (t) => ({ items: t.array(), hidden: t.string("b") }),
		loops: {
			visible: {
				prepare(items) {
					return { count: items.length };
				},
				filter(_k, v) {
					return v.label !== this.hidden;
				},
				key(k, v, state) {
					keyCalls.push([k, v.label, state.count]);
					return v.label;
				},
				enrich({ value }, state) {
					return { title: `${value.label}/${state.count}` };
				},
			},
		},
		view: each(
			field("items"),
			h("p", { title: lookupBind("title") }, renderIt("compact")),
			"visible",
		),
	});
	const { host, rootNode, C } = setup({ Root, Item });
	const [a, b, c] = ["a", "b", "c"].map((label) => C.Item({ label }));
	host.start(C.Root({ items: [a, b, c] }));
	assert.equal(rootNode.textContent, "ac");
	assert.deepEqual(keyCalls, [
		[0, "a", 3],
		[2, "c", 3],
	]);
	const ps = [...rootNode.querySelectorAll("p")];
	assert.deepEqual(
		ps.map((p) => p.title),
		["a/3", "c/3"],
	);
	// Keys move the DOM nodes instead of patching them in place.
	host.rootComponent = C.Root({ items: [c, b, a] });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("p")], [ps[1], ps[0]]);
});

test("renderIt clears local binds while the outer scope keeps them", () => {
	const Leaf = component({ name: "Leaf", view: h("b", { title: lookupBind("local") }, "leaf") });
	const Root = component({
		name: "Root",
		fields: (t) => ({ items: t.array() }),
		scopes: { bindings: { bind: () => ({ local: "outer", value: "ignored" }) } },
		view: each(
			field("items"),
			scope("bindings", h("section", { title: lookupBind("local") }, renderIt(), renderIt())),
		),
	});
	const { host, rootNode, C } = setup({ Root, Leaf });
	host.start(C.Root({ items: [C.Leaf()] }));
	assert.equal(rootNode.textContent, "leafleaf");
	assert.equal(rootNode.querySelector("section").getAttribute("title"), "outer");
	assert.ok([...rootNode.querySelectorAll("b")].every((b) => !b.hasAttribute("title")));
});

test("t.component defaults to a fresh instance from the owner's scope", () => {
	const Other = component({ name: "Other", view: "other" });
	const Root = component({
		name: "Root",
		fields: (t) => ({ child: t.component("Item"), maybe: t.option(t.component("Item")) }),
		view: render(field("child")),
	});
	const { host, rootNode, C } = setup({ Root, Item });
	const root = C.Root();
	assert.equal(specOf(root.child), Item);
	assert.equal(root.maybe, null);
	assert.notEqual(C.Root().child, root.child);
	// A child scope can swap the implementation registered under a name.
	const local = host.scope.enter();
	local.register({ Item: Other });
	host.start(local.components.Root());
	assert.equal(rootNode.textContent, "other");
	assert.equal(scopeOf(host.rootComponent.child), local);
});

test("t.component rejects values registered under a different name", () => {
	const Other = component({ name: "Other", view: "other" });
	const Root = component({
		name: "Root",
		fields: (t) => ({ child: t.option(t.component("Item")), items: t.array(t.component()) }),
		view: "x",
	});
	const { C } = setup({ Root, Item, Other });
	assert.equal(C.Root({ child: C.Other() }).child, null);
	assert.equal(C.Root({ child: { label: "x" } }).child, null);
	const item = C.Item();
	assert.equal(C.Root({ child: item }).child, item);
	assert.deepEqual(C.Root({ items: [item, 1] }).items, []);
	assert.equal(C.Root({ items: [item, C.Other()] }).items.length, 2);
});

test("register returns factories bound to its scope, and child scopes fall back to parents", () => {
	const { host } = setup({ Item });
	const local = host.scope.enter();
	const { Root: make } = local.register({ Root: component({ name: "Root", view: "x" }) });
	assert.equal(scopeOf(make()), local);
	assert.equal(scopeOf(local.components.Item()), local);
	assert.equal(scopeOf(host.scope.components.Item()), host.scope);
	assert.throws(() => host.scope.components.Root(), /Component Root is not registered/);
	assert.throws(() => host.scope.components.toString(), /toString is not registered/);
	assert.equal(host.registrations.size, 2);
});

test("a required component field without a default fails with its path", () => {
	const Pane = component({
		name: "Pane",
		fields: (t) => ({ body: t.component(), maybe: t.option(t.component()) }),
		view: "x",
	});
	const Root = component({
		name: "Root",
		fields: (t) => ({ left: t.component("Pane") }),
		view: "x",
	});
	const { C } = setup({ Root, Pane, Item });
	assert.throws(() => C.Pane(), /^Error: Pane\.body: required t\.component\(\) has no default/);
	assert.throws(() => C.Root(), /^Error: Root\.left: Pane\.body: required t\.component\(\)/);
	assert.equal(C.Pane({ body: C.Item() }).maybe, null);
	const Named = component({
		name: "Named",
		fields: (t) => ({ item: t.component("Item") }),
		view: "x",
	});
	assert.throws(() => Named.make(), /^Error: Named\.item: no scope to make Item in/);
});

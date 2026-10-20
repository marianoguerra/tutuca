import assert from "node:assert/strict";
import test from "node:test";
import {
	$if,
	AstNode,
	component,
	each,
	field,
	Host,
	h,
	pushView,
	render,
	renderEach,
	renderIt,
	scope,
	send,
	seqItem,
	t,
	targetValue,
	Walker,
} from "../../src/tutuca.js";
import { dom, setupHost } from "../helpers.js";

const setup = (specs) => setupHost(specs, { sync: true });

const actionNames = (spec, node) =>
	spec.eventHandlers.get(node.eid).map((handler) => handler.action.name);

const recordVisits = (seen) =>
	new (class extends Walker {
		visit(node) {
			seen.push(node.constructor.name);
			super.visit(node);
		}
	})();

const Counter = component({
	name: "Counter",
	fields: { id: t.string(), count: t.number() },
	views: { main: h("button", { "@on.click": send("inc") }, field("count")) },
	on: {
		inc(draft) {
			draft.count++;
		},
	},
});

test("the default walker walks parents first, attributes before children and handlers", () => {
	const v = h(
		"div",
		{ class: $if(field("on"), "a", "b"), "@on.click": send("go", field("x")) },
		each(field("items"), scope("binds", pushView("compact", h("i", {}, field("t"))))),
	);
	const seen = [];
	recordVisits(seen).visit(v);
	assert.deepEqual(seen, [
		"DomNode",
		"Cond",
		"Field",
		"Const",
		"Const",
		"XEach",
		"Field",
		"XScope",
		"XPushView",
		"Const",
		"DomNode",
		"Field",
		"Send",
		"Field",
	]);
});

test("Walker reads children of custom nodes through childNodes", () => {
	class Listed extends AstNode {
		constructor(child) {
			super();
			this.child = child;
		}
		childNodes() {
			return [this.child];
		}
	}
	class Opaque extends AstNode {}
	const seen = [];
	recordVisits(seen).visit(h("p", {}, new Listed(new Opaque()), new Listed(field("name"))));
	assert.deepEqual(seen, ["DomNode", "Listed", "Opaque", "Listed", "Field"]);
});

test("elements with handlers get unique IDs, and the spec maps them without copying", () => {
	const source = h(
		"ul",
		{ "@on.click": send("list") },
		h("li", { "@on.click": send("a") }),
		h("li", {}),
		h("li", { "@on.input": send("c"), "@on.blur": send("d") }),
	);
	const [a, plain, cd] = source.childs;
	assert.equal(plain.eid, null);
	assert.equal(new Set([source.eid, a.eid, cd.eid]).size, 3);
	const spec = component({ name: "C", view: source });
	assert.equal(spec.views.main, source);
	assert.deepEqual(actionNames(spec, source), ["list"]);
	assert.deepEqual(actionNames(spec, a), ["a"]);
	assert.deepEqual(actionNames(spec, cd), ["c", "d"]);
	assert.equal(spec.eventHandlers.size, 3);
	assert.deepEqual(spec.eventNames, new Set(["click", "input", "blur"]));
	assert.equal(spec.eventHandlers.get(source.eid), source.handlers);
});

test("compilation collects handlers in attributes and children, not in action arguments", () => {
	const argument = h("b", { "@on.click": send("argument") });
	const yes = h("i", { "@on.click": send("yes") });
	const no = h("i", { "@on.click": send("no") });
	const child = h("button", { "@on.click": send("child") });
	const source = h(
		"div",
		{ "@on.click": send("parent", argument), title: $if(true, yes, no) },
		child,
	);
	const spec = component({ name: "C", view: source });
	assert.deepEqual(
		[source, yes, no, child].map((node) => actionNames(spec, node)),
		[["parent"], ["yes"], ["no"], ["child"]],
	);
	assert.equal(spec.eventHandlers.has(argument.eid), false);
});

test("shared templates keep one ID across views and components", () => {
	const shared = h("button", { "@on.click": send("shared") });
	const spec = component({
		name: "A",
		views: {
			main: h("div", { "@on.click": send("a") }, shared),
			compact: h("section", {}, shared),
		},
	});
	assert.deepEqual(actionNames(spec, shared), ["shared"]);
	assert.equal(spec.eventHandlers.size, 2);
	const other = component({ name: "B", view: shared });
	assert.equal(other.eventHandlers.size, 1);
});

test("rendering adds data-eid only to elements with handlers", () => {
	const view = h("div", {}, h("button", { "@on.click": send("go") }), h("p", {}));
	const Root = component({ name: "Root", view });
	const { host, rootNode, C } = setup({ Root });
	host.start(C.Root());
	assert.equal(rootNode.querySelector("button").dataset.eid, String(view.childs[0].eid));
	assert.equal(rootNode.querySelector("p").hasAttribute("data-eid"), false);
	assert.equal(rootNode.querySelector("div").hasAttribute("data-eid"), false);
});

test("a click runs the handler on a draft and re-renders the produced state", () => {
	const { host, rootNode, C } = setup({ Counter });
	const before = C.Counter();
	host.start(before);
	rootNode.querySelector("button").click();
	rootNode.querySelector("button").click();
	assert.equal(host.rootComponent.count, 2);
	assert.equal(before.count, 0);
	assert.ok(Object.isFrozen(host.rootComponent));
	assert.equal(rootNode.textContent, "2");
});

test("targetValue reads values and checkbox state", () => {
	const Form = component({
		name: "Form",
		fields: { name: t.string(), done: t.boolean() },
		view: h(
			"form",
			{},
			h("input", { value: field("name"), "@on.input": send("setName", targetValue()) }),
			h("input", { type: "checkbox", "@on.input": send("setDone", targetValue()) }),
		),
		on: {
			setName(draft, [v]) {
				draft.name = v;
			},
			setDone(draft, [v]) {
				draft.done = v;
			},
		},
	});
	const { host, rootNode, window, C } = setup({ Form });
	host.start(C.Form());
	const [text, check] = rootNode.querySelectorAll("input");
	text.value = "Ada";
	text.dispatchEvent(new window.Event("input", { bubbles: true }));
	check.checked = true;
	check.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.equal(host.rootComponent.name, "Ada");
	assert.equal(host.rootComponent.done, true);
});

test("a handler's return value replaces the component", () => {
	const Reset = component({
		name: "Reset",
		fields: { count: t.number(5) },
		view: h("button", { "@on.click": send("reset") }),
		on: {
			reset() {
				return Reset.make({ count: 0 });
			},
		},
	});
	const { host, rootNode, C } = setup({ Reset });
	host.start(C.Reset());
	rootNode.querySelector("button").click();
	assert.equal(host.rootComponent.count, 0);
});

test("a throwing handler keeps the state and reports taskFailed", () => {
	const Bad = component({
		name: "Bad",
		fields: { count: t.number() },
		view: h("button", { "@on.click": send("boom") }),
		on: {
			boom(draft) {
				draft.count = 10;
				throw new Error("boom");
			},
		},
	});
	const { host, rootNode, failures, C } = setup({ Bad });
	const root = C.Bad();
	host.start(root);
	rootNode.querySelector("button").click();
	assert.equal(host.rootComponent, root);
	assert.deepEqual(
		failures.map((e) => e.message),
		["boom"],
	);
});

test("only own message handlers run", () => {
	const Root = component({ name: "Root", view: h("button", { "@on.click": send("toString") }) });
	const { host, rootNode, failures, C } = setup({ Root });
	const root = C.Root();
	host.start(root);
	rootNode.querySelector("button").click();
	assert.equal(host.rootComponent, root);
	assert.equal(failures.length, 1);
});

test("events on the host, unmanaged children and unknown IDs are ignored", () => {
	const { host, rootNode, C } = setup({ Counter });
	const root = C.Counter();
	host.start(root);
	rootNode.click();
	const unmanaged = rootNode.ownerDocument.createElement("button");
	rootNode.append(unmanaged);
	unmanaged.click();
	const button = rootNode.querySelector("button");
	for (const eid of ["-1", "1e9", String(Number.MAX_SAFE_INTEGER)]) {
		button.dataset.eid = eid;
		assert.doesNotThrow(() => host.handleEvent({ type: "click", target: button }));
	}
	assert.equal(host.rootComponent, root);
	assert.equal(host.tasks.length, 0);
});

test("look-alike meta comments from unmanaged DOM are skipped", () => {
	const { host, rootNode, C } = setup({ Counter });
	host.start(C.Counter());
	const button = rootNode.querySelector("button");
	button.before(rootNode.ownerDocument.createComment('§{"t":"other"}§'));
	button.click();
	assert.equal(host.rootComponent.count, 1);
});

test("all views of one instance render together and route to it", () => {
	const Child = component({
		name: "Child",
		fields: { seen: t.array() },
		views: {
			compact: h("button", { "@on.click": send("record", "compact") }, "compact"),
			main: h(
				"section",
				{ "@on.click": send("record", "outer") },
				h(
					"button",
					{ "@on.click": send("record", "main"), "@on.input": send("record", "input") },
					"main",
				),
				h("i", { "@on.input": send("record", "inner-input") }),
			),
		},
		on: {
			record(draft, [name]) {
				draft.seen.push(name);
			},
		},
	});
	const Root = component({
		name: "Root",
		fields: { child: t.component("Child") },
		view: h("div", {}, render(field("child")), render(field("child"), "compact")),
	});
	const { host, rootNode, window, C } = setup({ Root, Child });
	host.start(C.Root());
	const [main, compact] = rootNode.querySelectorAll("button");
	main.click();
	main.dispatchEvent(new window.Event("input", { bubbles: true }));
	compact.click();
	// Skip a nonmatching inner group, but still select the nearest matching group.
	rootNode.querySelector("i").click();
	assert.deepEqual(host.rootComponent.child.seen, ["main", "input", "compact", "outer"]);
});

for (const source of ["field", "seqItem"]) {
	test(`nested components route through ${source} with a pushed view`, () => {
		const Child = component({
			name: "Child",
			fields: { count: t.number() },
			views: {
				main: h("i", {}),
				compact: h("button", { "@on.click": send("inc") }, h("span", {}, "increment")),
			},
			on: {
				inc(draft) {
					draft.count++;
				},
			},
		});
		const Panel = component({
			name: "Panel",
			fields: {
				child: t.component("Child"),
				items: t.array(),
				selected: t.number(1),
			},
			view: pushView(
				"compact",
				render(source === "field" ? field("child") : seqItem("items", "selected")),
			),
		});
		const Root = component({
			name: "Root",
			fields: { panel: t.component("Panel") },
			view: render(field("panel")),
		});
		const { host, rootNode, C } = setup({ Root, Panel, Child });
		const child = C.Child();
		host.start(C.Root({ panel: C.Panel({ child, items: [null, child] }) }));
		rootNode.querySelector("span").click();
		const panel = host.rootComponent.panel;
		assert.equal((source === "seqItem" ? panel.items[1] : panel.child).count, 1);
		assert.equal((source === "seqItem" ? panel.child : panel.items[1]).count, 0);
	});
}

for (const mode of ["renderEach", "renderIt", "deep renderIt"]) {
	test(`top-level ${mode} routes every item after keyed reorder`, () => {
		const child = mode === "renderIt" ? renderIt() : h("section", {}, h("article", {}, renderIt()));
		const Root = component({
			name: "Root",
			fields: { items: t.array() },
			loops: { byId: { key: (_key, item) => item.id } },
			view:
				mode === "renderEach"
					? renderEach(field("items"), "byId")
					: each(field("items"), child, "byId"),
		});
		const { host, rootNode, C } = setup({ Root, Counter });
		host.start(C.Root({ items: [C.Counter({ id: "a" }), C.Counter({ id: "b" })] }));
		const [a, b] = rootNode.querySelectorAll("button");
		a.click();
		b.click();
		host.rootComponent = C.Root({ items: [...host.rootComponent.items].reverse() });
		host.render();
		assert.deepEqual([...rootNode.querySelectorAll("button")], [b, a]);
		b.click();
		a.click();
		assert.deepEqual(
			host.rootComponent.items.map((item) => [item.id, item.count]),
			[
				["b", 2],
				["a", 2],
			],
		);
	});
}

test("renderIt stops event lookup at its view", () => {
	const Item = component({
		name: "Item",
		fields: { count: t.number() },
		view: h("div", {}, h("button", { "@on.click": send("inc") }), h("i", {})),
		on: {
			inc(draft) {
				draft.count++;
			},
		},
	});
	const Root = component({
		name: "Root",
		fields: { items: t.array(), picked: t.number() },
		view: each(
			field("items"),
			h(
				"section",
				{ "@on.click": send("pick") },
				renderIt(),
				h("button", { "@on.click": send("pick") }),
			),
		),
		on: {
			pick(draft) {
				draft.picked++;
			},
		},
	});
	const { host, rootNode, C } = setup({ Root, Item });
	host.start(C.Root({ items: [C.Item()] }));
	const [child, sibling] = rootNode.querySelectorAll("button");
	child.click();
	rootNode.querySelector("i").click();
	assert.equal(host.rootComponent.items[0].count, 1);
	assert.equal(host.rootComponent.picked, 0);
	sibling.click();
	rootNode.querySelector("section").click();
	assert.equal(host.rootComponent.picked, 2);
});

test("a child-scope registration after startup adds only its event listeners", (ctx) => {
	const window = dom("");
	const rootNode = window.document.createElement("main");
	const host = new Host({ document: window.document, rootNode });
	const listeners = ctx.mock.method(rootNode, "addEventListener");
	const names = () => listeners.mock.calls.map(({ arguments: [name] }) => name);
	host.scope.register({
		Root: component({ name: "Root", view: h("i", { "@on.click": send("x") }) }),
	});
	assert.deepEqual(names(), ["click"]);
	host.start(host.scope.components.Root());
	const Late = component({
		name: "Late",
		fields: { count: t.number() },
		view: h("button", { "@on.dblclick": send("changed"), "@on.click": send("changed") }),
		on: {
			changed(draft) {
				draft.count++;
			},
		},
	});
	const local = host.scope.enter("local");
	local.register({ Late });
	local.register({ Alias: Late });
	assert.deepEqual(names(), ["click", "dblclick"]);
	host.rootComponent = local.components.Late();
	host.render();
	rootNode.querySelector("button").dispatchEvent(new window.Event("dblclick", { bubbles: true }));
	assert.equal(host.rootComponent.count, 1);
});

test("targetValue reads the element with the handler, not the child that was clicked", () => {
	const Tabs = component({
		name: "Tabs",
		fields: { tab: t.string("a") },
		view: h(
			"button",
			{ value: "b", "@on.click": send("setTab", targetValue()) },
			h("span", {}, "icon"),
			"label",
		),
		on: {
			setTab(draft, [tab]) {
				draft.tab = tab;
			},
		},
	});
	const { host, rootNode, window, failures, C } = setup({ Tabs });
	host.start(C.Tabs());
	rootNode.querySelector("span").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(host.rootComponent.tab, "b");
	assert.deepEqual(failures, []);
});

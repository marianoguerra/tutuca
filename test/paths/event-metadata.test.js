import assert from "node:assert/strict";
import test from "node:test";
import {
	$if,
	AstNode,
	component,
	each,
	field,
	h,
	provided,
	pushView,
	render,
	renderIt,
	send,
	seqItem,
	sourceKey,
	t,
} from "../../src/tutuca.js";
import { vcomment as comment, setupHost } from "../helpers.js";

// Routing without notify, provided or sourceKey is covered in events.test.js.

// click fails the test on any failed task.
function setup(specs) {
	const setup = setupHost(specs, { sync: true });
	const click = (target) => {
		setup.click(target);
		assert.deepEqual(setup.failures, []);
	};
	return { ...setup, click };
}

// Custom view nodes can return several roots, just as collection nodes do.
class Roots extends AstNode {
	constructor(children) {
		super();
		this.children = children;
	}
	eval(ctx) {
		return this.children.map((child) => child.eval(ctx));
	}
	childNodes() {
		return this.children;
	}
}
const roots = (...children) => new Roots(children);
class Leaf extends AstNode {
	constructor(fn) {
		super();
		this.eval = fn;
	}
}

for (const source of ["field", "seqItem", "provided"]) {
	test(`wrapperless component chain preserves ${source} paths and named view ownership`, () => {
		const seen = [];
		const Child = component({
			name: "Child",
			fields: { count: t.number() },
			views: {
				main: h("i", {}),
				compact: h("button", { "@on.click": send("inc") }, h("span", {}, "increment")),
			},
			on: {
				inc(draft, _args, ctx) {
					draft.count++;
					ctx.notify("changed");
				},
			},
		});
		const Panel = component({
			name: "Panel",
			fields: { selected: t.number(1), child: t.component("Child"), items: t.array() },
			provides: { child: (b) => b.field("child") },
			view: pushView(
				"compact",
				render(
					source === "field"
						? field("child")
						: source === "seqItem"
							? seqItem("items", "selected")
							: provided("child"),
				),
			),
			on: {
				changed() {
					seen.push("panel");
				},
			},
		});
		const Root = component({
			name: "Root",
			fields: { panel: t.component("Panel") },
			view: render(field("panel")),
			on: {
				changed() {
					seen.push("root");
				},
			},
		});
		const { host, rootNode, C, click } = setup({ Root, Panel, Child });
		const child = C.Child();
		host.start(C.Root({ panel: C.Panel({ child, items: [null, child] }) }));
		click(rootNode.querySelector("span"));
		const panel = host.rootComponent.panel;
		assert.equal((source === "seqItem" ? panel.items[1] : panel.child).count, 1);
		assert.deepEqual(seen, ["panel", "root"]);
	});
}

test("top-level each routes every item after keyed reorder", () => {
	const Item = component({
		name: "Item",
		fields: { id: t.string() },
		view: h("button", {}),
	});
	const Root = component({
		name: "Root",
		fields: { picked: t.array(), items: t.array() },
		loops: { byId: { key: (_key, item) => item.id } },
		view: each(field("items"), h("button", { "@on.click": send("pick", sourceKey()) }), "byId"),
		on: {
			pick(draft, [key]) {
				draft.picked.push(draft.items[key].id);
			},
		},
	});
	const { host, rootNode, C, click } = setup({ Root, Item });
	host.start(C.Root({ items: [C.Item({ id: "a" }), C.Item({ id: "b" })] }));
	const [a, b] = rootNode.querySelectorAll("button");
	click(a);
	click(b);
	assert.deepEqual(host.rootComponent.picked, ["a", "b"]);
	host.rootComponent = C.Root({ items: [...host.rootComponent.items].reverse() });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("button")], [b, a]);
	click(b);
	click(a);
	assert.deepEqual(host.rootComponent.picked, ["b", "a"]);
	assert.equal(rootNode.innerHTML.includes('"t":"it"'), false);
});

test("nested multi-root loops retain paths across text, comments, empty scopes and siblings", () => {
	const Root = component({
		name: "Root",
		fields: {
			groups: t
				.array()
				.default([{ items: [{ visible: false }, { visible: true }, { visible: false }] }]),
			picked: t.array(),
		},
		view: roots(
			each(
				field("groups"),
				each(
					field("items"),
					$if(
						field("visible"),
						roots(
							h("button", { "@on.click": send("pick", sourceKey()) }),
							new Leaf(() => ["text between roots", comment("ordinary comment")]),
							h("button", { "@on.click": send("pick", sourceKey()) }),
						),
						null,
					),
				),
			),
			h("button", { "@on.click": send("pick", sourceKey()) }),
		),
		on: {
			pick(draft, [key]) {
				draft.picked.push(key);
			},
		},
	});
	const { host, rootNode, C, click } = setup({ Root });
	host.start(C.Root());
	const buttons = [...rootNode.querySelectorAll("button")];
	for (const button of buttons) click(button);
	assert.deepEqual(host.rootComponent.picked, [1, 1, null]);
	const unmanaged = rootNode.ownerDocument.createElement("button");
	unmanaged.dataset.eid = String(Root.views.main.children[1].eid);
	rootNode.append(unmanaged);
	click(unmanaged);
	assert.deepEqual(host.rootComponent.picked, [1, 1, null]);
});

test("renderIt promotes only its own scope and stops event lookup at its view", () => {
	const Item = component({
		name: "Item",
		fields: { count: t.number() },
		view: roots(h("button", { "@on.click": send("inc") }), h("i", {})),
		on: {
			inc(draft) {
				draft.count++;
			},
		},
	});
	const Root = component({
		name: "Root",
		fields: { picked: t.array(), items: t.array() },
		view: each(
			field("items"),
			h(
				"section",
				{ "@on.click": send("pick", sourceKey()) },
				renderIt(),
				h("button", { "@on.click": send("pick", sourceKey()) }),
			),
		),
		on: {
			pick(draft, [key]) {
				draft.picked.push(key);
			},
		},
	});
	const { host, rootNode, C, click } = setup({ Root, Item });
	host.start(C.Root({ items: [C.Item()] }));
	const [child, sibling] = rootNode.querySelectorAll("button");
	click(child);
	click(rootNode.querySelector("i"));
	assert.equal(host.rootComponent.items[0].count, 1);
	assert.deepEqual(host.rootComponent.picked, []);
	click(sibling);
	click(rootNode.querySelector("section"));
	assert.deepEqual(host.rootComponent.picked, [0, 0]);
});

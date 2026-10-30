import assert from "node:assert/strict";
import test from "node:test";
import { collectClasses } from "../../src/css/classes.js";
import { isConstant } from "../../src/optimize.js";
import {
	$if,
	AstNode,
	component,
	each,
	field,
	h,
	lookupBind,
	pushView,
	render,
	send,
	sourceKey,
	t,
} from "../../src/tutuca.js";
import { VBase, VComment, VNode } from "../../src/vdom.js";
import { startHost } from "../helpers.js";

const setup = startHost;

function* allVNodes(childs) {
	for (const c of childs) {
		yield c;
		if (c.childs) yield* allVNodes(c.childs);
	}
}
const vnodes = (childs) => [...allVNodes(childs)].filter((c) => c instanceof VNode);
const findVNode = (host, tag) => vnodes(host._curVDom).find((n) => n.tag === tag);

test("isConstant: literals, elements with constant parts and constant conditions", () => {
	const constants = [
		h("p", {}, "hi"),
		h("p", { class: "a", title: 1 }, h("b", {}, "x"), null, 42),
		h("button", { "on:click": send("pick", field("id")) }, "+"),
		$if(true, h("i", {}, "a"), "b"),
	];
	for (const node of constants) assert.equal(isConstant(node), true);
});

test("isConstant: anything reading the ctx makes it and its ancestors dynamic", () => {
	const dynamics = [
		field("name"),
		lookupBind("value"),
		sourceKey(),
		render(field("child")),
		each(field("items"), h("li", {}, "x")),
		pushView("compact", "x"),
		h("p", { class: field("cls") }, "x"),
		h("p", {}, field("name")),
		h("div", {}, h("p", {}, h("b", {}, field("name")))),
		$if(field("on"), "a", "b"),
		$if(true, field("name"), "b"),
		new (class extends AstNode {})(),
	];
	for (const node of dynamics) assert.equal(isConstant(node), false);
});

test("a constant element evaluates once without a ctx and returns the same vnode", () => {
	const node = h("p", { class: "a" }, h("b", {}, "x"));
	const vnode = node.eval(null);
	assert.equal(vnode.tag, "p");
	assert.equal(node.eval({ unused: true }), vnode);
	const dynamic = h("p", {}, field("name"));
	const ctx = { it: { name: "n" } };
	assert.notEqual(dynamic.eval(ctx), dynamic.eval(ctx));
});

test("constant subtrees keep their vnode identity across renders", () => {
	const Comp = component({
		name: "Comp",
		fields: { count: t.number() },
		view: h(
			"div",
			{},
			h("header", { class: "top" }, h("h1", {}, "Title")),
			h("span", {}, field("count")),
		),
	});
	const { host, rootNode, C } = setup(Comp);
	const header = findVNode(host, "header");
	const span = findVNode(host, "span");
	const h1Dom = rootNode.querySelector("h1");
	host.rootComponent = C.Comp({ count: 1 });
	host.render();
	assert.equal(findVNode(host, "header"), header);
	assert.notEqual(findVNode(host, "span"), span);
	assert.equal(rootNode.querySelector("h1"), h1Dom);
	assert.equal(rootNode.querySelector("span").textContent, "1");
});

test("handlers inside constant elements still dispatch, also per loop item", () => {
	const Comp = component({
		name: "Comp",
		fields: { count: t.number(), items: t.array(), picked: t.any() },
		view: h(
			"div",
			{},
			h("button", { class: "inc", "on:click": send("inc") }, "+"),
			each(
				field("items"),
				h("button", { class: "pick", "on:click": send("pick", sourceKey()) }, "pick"),
			),
			h("output", {}, field("count")),
		),
		on: {
			inc(next) {
				next.count++;
			},
			pick(next, [key]) {
				next.picked = next.items[key];
			},
		},
	});
	const { host, rootNode } = setup(Comp, { items: ["a", "b", "c"] });
	const picks = vnodes(host._curVDom).filter((n) => n.attrs.class === "pick");
	assert.equal(picks.length, 3);
	assert.ok(picks.every((n) => n === picks[0]));
	rootNode.querySelector(".inc").click();
	rootNode.querySelector(".inc").click();
	assert.equal(host.rootComponent.count, 2);
	assert.equal(rootNode.querySelector("output").textContent, "2");
	rootNode.querySelectorAll(".pick")[1].click();
	assert.equal(host.rootComponent.picked, "b");
});

test("walkers still see the attrs of constant elements", () => {
	const view = h("div", { class: "a b" }, h("p", { class: "c" }, "x"));
	assert.equal(isConstant(view), true);
	assert.deepEqual([...collectClasses(view)].sort(), ["a", "b", "c"]);
});

test("meta closing comments are one shared vnode across positions and renders", () => {
	const Comp = component({
		name: "Comp",
		fields: { items: t.array() },
		view: h("ul", {}, each(field("items"), h("li", {}, lookupBind("value")))),
	});
	const { host, C } = setup(Comp, { items: ["a", "b"] });
	const ends = () =>
		[...allVNodes(host._curVDom)].filter((c) => c instanceof VComment && c.text === "§/§");
	const [end] = ends();
	assert.equal(ends().length, 3); // the component and each item
	host.rootComponent = C.Comp({ items: ["a", "b", "c"] });
	host.render();
	assert.ok(ends().every((c) => c === end));
});

test("literal text children of dynamic elements keep their vnode across renders", () => {
	const Comp = component({
		name: "Comp",
		fields: { count: t.number() },
		view: h("p", { title: field("count") }, "Count: ", field("count"), 7),
	});
	const { host, rootNode, C } = setup(Comp);
	const [label, , seven] = findVNode(host, "p").childs;
	host.rootComponent = C.Comp({ count: 1 });
	host.render();
	const p = findVNode(host, "p");
	assert.ok(p.childs.every((c) => c instanceof VBase));
	assert.equal(p.childs[0], label);
	assert.equal(p.childs[2], seven);
	assert.equal(rootNode.querySelector("p").textContent, "Count: 17");
});

test("constant conditional children of dynamic elements keep their vnodes across renders", () => {
	const Comp = component({
		name: "Comp",
		fields: { count: t.number() },
		view: h("p", { title: field("count") }, $if(true, h("b", {}, "yes"), "no"), field("count")),
	});
	const { host, C } = setup(Comp);
	const b = findVNode(host, "b");
	host.rootComponent = C.Comp({ count: 1 });
	host.render();
	assert.equal(findVNode(host, "b"), b);
});

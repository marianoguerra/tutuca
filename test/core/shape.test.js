import assert from "node:assert/strict";
import test from "node:test";
import { $if, component, field, h, renderEach, send, t } from "../../src/tutuca.js";
import { Shape, VNode } from "../../src/vdom/index.js";
import { mutationsOf, setupHost, startHost } from "../helpers.js";

const SVG = "http://www.w3.org/2000/svg";

function setup(Comp, args) {
	const started = startHost(Comp, args);
	const { host, C } = started;
	const rerender = (next) => {
		host.root = C.Comp(next);
		host.render();
	};
	return { ...started, rerender };
}

test("a Element splits its attrs into a shape once: static, dynamic, key and namespace", () => {
	const node = h(
		"input",
		{ class: "c", title: field("t"), value: "v", key: field("k"), "on:input": send("x") },
		"label",
	);
	const { shape } = node.plan;
	assert.equal(shape.tag, "input");
	assert.deepEqual(shape.staticAttrs, { class: "c", "data-eid": node.eid });
	assert.deepEqual(shape.names, ["title", "value"]); // value is read last, so never static
	const ctx = { it: { t: "T", k: 3 } };
	const vnode = node.eval(ctx);
	assert.equal(vnode.shape, shape);
	assert.deepEqual(vnode.values, ["T", "v"]);
	assert.equal(vnode.key, "3");
	assert.equal(node.eval(ctx).shape, shape);
	assert.deepEqual(vnode.attrs, { class: "c", "data-eid": node.eid, title: "T", value: "v" });
});

test("value, checked, is and dangerouslySetInnerHTML stay dynamic even when constant", () => {
	const node = h("p", {
		value: 1,
		checked: true,
		is: "x-p",
		dangerouslySetInnerHTML: { __html: "" },
	});
	assert.deepEqual(node.plan.shape.staticAttrs, {});
	assert.deepEqual(node.plan.shape.names, ["value", "checked", "is", "dangerouslySetInnerHTML"]);
	assert.deepEqual(new Shape("p", null, [["value", true, 1]]).names, ["value"]);
});

test("namespace must be a constant, and svg and math are detected once in the shape", () => {
	assert.throws(() => h("g", { namespace: field("ns") }), /namespace must be a constant/);
	assert.equal(h("g", { namespace: SVG }).plan.shape.namespace, SVG);
	const svg = h("SVG", {}).plan.shape;
	assert.equal(svg.tag, "svg");
	assert.equal(svg.namespace, SVG);
	assert.equal(h("div", {}).plan.shape.namespace, null);
});

test("re-rendering a changed dynamic attr writes only that attr", async () => {
	const Comp = component({
		name: "Comp",
		fields: { t: t.string() },
		view: h("p", { class: "fixed", title: field("t") }, "x"),
	});
	const { window, rootNode, rerender } = setup(Comp, { t: "a" });
	const p = rootNode.querySelector("p");
	assert.equal(p.className, "fixed");
	const records = await mutationsOf(window, rootNode, () => rerender({ t: "b" }));
	assert.deepEqual(
		records.map((r) => [r.type, r.attributeName]),
		[["attributes", "title"]],
	);
	assert.equal(rootNode.querySelector("p"), p);
	assert.equal(p.title, "b");
});

test("different templates with the same tag replace the element; the same one morphs", () => {
	const Comp = component({
		name: "Comp",
		fields: { on: t.boolean(), t: t.string() },
		view: $if(field("on"), h("div", { class: "a", title: field("t") }), h("div", { class: "b" })),
	});
	const { rootNode, rerender } = setup(Comp, { on: true, t: "1" });
	const a = rootNode.querySelector("div");
	rerender({ on: true, t: "2" });
	assert.equal(rootNode.querySelector("div"), a);
	assert.equal(a.title, "2");
	rerender({ on: false, t: "2" });
	const b = rootNode.querySelector("div");
	assert.notEqual(b, a);
	assert.equal(b.className, "b");
	assert.equal(b.hasAttribute("title"), false);
});

test("a changed key remounts the element", () => {
	const Comp = component({
		name: "Comp",
		fields: { src: t.string() },
		view: h("video", { key: field("src"), src: field("src") }),
	});
	const { rootNode, rerender } = setup(Comp, { src: "a.mp4" });
	const first = rootNode.querySelector("video");
	assert.equal(first.hasAttribute("key"), false);
	rerender({ src: "a.mp4" });
	assert.equal(rootNode.querySelector("video"), first);
	rerender({ src: "b.mp4" });
	assert.notEqual(rootNode.querySelector("video"), first);
});

test("a constant select value is applied after its options are created", () => {
	const Comp = component({
		name: "Comp",
		view: h(
			"select",
			{ value: "b" },
			h("option", { value: "a" }, "A"),
			h("option", { value: "b" }, "B"),
		),
	});
	const { rootNode } = setup(Comp);
	assert.equal(rootNode.querySelector("select").value, "b");
});

test("tutuca normalizes child values: null, iterables, nested arrays and primitives", () => {
	const Comp = component({
		name: "Comp",
		fields: { items: t.any() },
		view: h("p", {}, field("items")),
	});
	const items = [
		null,
		"a",
		[1, [undefined, new Set(["b", "c"])]],
		false,
		h("i", {}, "x").eval(null),
	];
	const { host, rootNode } = setup(Comp, { items });
	assert.equal(rootNode.querySelector("p").innerHTML, "a1bcfalse<i>x</i>");
	const p = host._curVDom.flatMap((c) => c.children ?? []).find((c) => c instanceof VNode);
	assert.ok(p.children.every((c) => !Array.isArray(c)));
});

test("an element knows its children when every render has the same ones", () => {
	const fixed = h("li", {}, h("span", {}, field("a")), "text", h("b", {}, "constant"));
	const { kids } = fixed.plan.shape;
	assert.equal(kids.length, 3);
	assert.equal(kids[0], fixed.children[0].plan.shape);
	assert.equal(kids[1].text, "text");
	assert.equal(kids[2], fixed.children[2].plan.shape);
	assert.equal(fixed.plan.shape.fixedChildren, true);
	// A field renders as text, as nothing or as many; a custom element isn't cloned.
	assert.equal(h("p", {}, field("a")).plan.shape.kids, null);
	assert.equal(h("p", {}, $if(field("a"), "x", "y")).plan.shape.kids, null);
	assert.equal(h("p", {}, h("my-widget", {})).plan.shape.kids, null);
	// Keyed children are still cloned with it, but matched by key.
	const keyed = h("p", {}, h("i", { key: field("k") })).plan.shape;
	assert.equal(keyed.kids.length, 1);
	assert.equal(keyed.fixedChildren, false);
});

test("elements cloned from their template are the ones made one by one", () => {
	const Item = component({
		name: "Item",
		fields: { n: t.number(), on: t.boolean() },
		view: h(
			"li",
			{ class: "row", "data-n": field("n") },
			h("input", { type: "checkbox", indeterminate: true, checked: field("on") }),
			h("span", { class: "n" }, field("n")),
			h("svg", { viewBox: "0 0 1 1" }, h("circle", { r: "1" })),
			"tail",
		),
	});
	const Comp = component({
		name: "Comp",
		fields: { items: t.array() },
		view: h("ul", {}, renderEach(field("items"))),
	});
	const { host, rootNode, C } = setupHost({ Comp, Item });
	host.start(C.Comp({ items: [C.Item({ n: 1 }), C.Item({ n: 2 })] }));
	const [one, two] = rootNode.querySelectorAll("li");
	assert.equal(
		two.outerHTML,
		one.outerHTML.replaceAll("1</span>", "2</span>").replace('n="1"', 'n="2"'),
	);
	assert.equal(two.querySelector("span").textContent, "2");
	// A property no attribute reflects is set on each clone, and namespaces are the template's.
	assert.equal(one.querySelector("input").indeterminate, true);
	assert.equal(two.querySelector("input").indeterminate, true);
	assert.equal(two.querySelector("circle").namespaceURI, SVG);
	// The clones are morphed as any other node: in place.
	host.root = C.Comp({ items: [host.root.items[0], C.Item({ n: 3 })] });
	host.render();
	assert.deepEqual([...rootNode.querySelectorAll("li")], [one, two]);
	assert.equal(two.getAttribute("data-n"), "3");
	assert.equal(two.lastChild.data, "tail");
});

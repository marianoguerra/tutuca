import assert from "node:assert/strict";
import test from "node:test";
import { $if, component, field, h, send, t } from "../../src/tutuca.js";
import { Shape, VNode } from "../../src/vdom.js";
import { mutationsOf, startHost } from "../helpers.js";

const SVG = "http://www.w3.org/2000/svg";

function setup(Comp, args) {
	const started = startHost(Comp, args);
	const { host, C } = started;
	const rerender = (next) => {
		host.rootComponent = C.Comp(next);
		host.render();
	};
	return { ...started, rerender };
}

test("a DomNode splits its attrs into a shape once: static, dynamic, key and namespace", () => {
	const node = h(
		"input",
		{ class: "c", title: field("t"), value: "v", key: field("k"), "@on.input": send("x") },
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
	assert.throws(() => new Shape("p", null, { value: 1 }, []), /value must be a dynamic attr/);
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
	const p = host._curVDom.flatMap((c) => c.childs ?? []).find((c) => c instanceof VNode);
	assert.ok(p.childs.every((c) => !Array.isArray(c)));
});

import assert from "node:assert/strict";
import test from "node:test";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { render } from "../src/vdom.js";
import { vh as h, vchilds } from "./vh.js";

const SVG = "http://www.w3.org/2000/svg";
const MATH = "http://www.w3.org/1998/Math/MathML";
const HTML = "http://www.w3.org/1999/xhtml";

// Renders root and returns the flat list to pass as prev next time.
const draw = (document, container, root, prev) => {
	const childs = vchilds(root);
	render(document, container, childs, prev);
	return childs;
};

function setup() {
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	return { window, document: window.document, container };
}

// Runs fn and resolves with the DOM mutations it caused in container.
async function mutationsOf(window, container, fn) {
	const records = [];
	const observer = new window.MutationObserver((rs) => records.push(...rs));
	const all = { subtree: true, childList: true, attributes: true, characterData: true };
	observer.observe(container, all);
	fn();
	await new Promise((resolve) => setTimeout(resolve, 0));
	observer.disconnect();
	return records;
}

test("render mounts, then morphs in place from what the last render returned", () => {
	const { document, container } = setup();
	const prev = draw(document, container, [h("p", { class: "a" }, "one"), "tail"]);
	assert.equal(prev.length, 2);
	assert.equal(container.innerHTML, '<p class="a">one</p>tail');
	const p = container.firstChild;
	draw(document, container, [h("p", { class: "b" }, "two"), "tail"], prev);
	assert.equal(container.innerHTML, '<p class="b">two</p>tail');
	assert.equal(container.firstChild, p);
});

test("namespaces: svg and math are detected, inherited, and reset by foreignObject", () => {
	const { document, container } = setup();
	const tree = (extra) =>
		h("div", {}, [
			h("SVG", {}, [
				h("circle", { r: "1" }),
				h("foreignObject", {}, [h("span", {}, "html")]),
				...extra,
			]),
			h("math", {}, [h("mi", {}, "x")]),
			h("g", { namespace: SVG }),
		]);
	const prev = draw(document, container, tree([]));
	const ns = (sel) => container.querySelector(sel).namespaceURI;
	assert.equal(ns("svg"), SVG);
	assert.equal(ns("circle"), SVG);
	assert.equal(ns("foreignObject"), SVG);
	assert.equal(ns("span"), HTML);
	assert.equal(ns("math"), MATH);
	assert.equal(ns("mi"), MATH);
	assert.equal(container.querySelector("div > g").namespaceURI, SVG);
	assert.equal(container.querySelector("div > g").hasAttribute("namespace"), false);
	// Children mounted while morphing inherit the namespace too.
	draw(document, container, tree([h("rect", {}), h("foreignObject", {}, [h("b")])]), prev);
	assert.equal(ns("rect"), SVG);
	assert.equal(ns("foreignObject ~ foreignObject > b"), HTML);
});

test("an unchanged re-render writes nothing to the DOM", async () => {
	const { window, document, container } = setup();
	const tree = () =>
		h(
			"ul",
			{},
			[1, 2, 3].map((i) => h("li", { class: "r" }, [h("b", {}, i), " x"])),
		);
	const prev = draw(document, container, tree());
	const records = await mutationsOf(window, container, () =>
		draw(document, container, tree(), prev),
	);
	assert.equal(records.length, 0);
});

test("a changed leaf only writes that leaf", async () => {
	const { window, document, container } = setup();
	const tree = (last) => h("ul", {}, [h("li", {}, "a"), h("li", {}, "b"), h("li", {}, last)]);
	const prev = draw(document, container, tree("c"));
	const records = await mutationsOf(window, container, () =>
		draw(document, container, tree("C"), prev),
	);
	assert.deepEqual(
		records.map((r) => [r.type, r.target.data]),
		[["characterData", "C"]],
	);
});

test("a shared vnode is skipped by identity, without looking at the DOM", () => {
	const { document, container } = setup();
	const shared = h("header", {}, [h("h1", {}, "Title")]);
	const prev = draw(document, container, [shared, h("p", {}, "1")]);
	container.querySelector("h1").textContent = "changed outside";
	draw(document, container, [shared, h("p", {}, "2")], prev);
	assert.equal(container.querySelector("h1").textContent, "changed outside");
	assert.equal(container.querySelector("p").textContent, "2");
});

test("a select reapplies its value when its options change", () => {
	const { document, container } = setup();
	const tree = (opts) =>
		h(
			"select",
			{ value: "b" },
			opts.map((o) => h("option", { value: o }, o)),
		);
	const prev = draw(document, container, tree(["a"]));
	draw(document, container, tree(["a", "b"]), prev);
	assert.equal(container.querySelector("select").value, "b");
});

test("same tag with a different shape replaces the element", () => {
	const { document, container } = setup();
	const prev = draw(document, container, h("div", { class: "a" }));
	const first = container.firstChild;
	draw(document, container, h("div", { title: "t" }), prev);
	assert.notEqual(container.firstChild, first);
	assert.equal(container.innerHTML, '<div title="t"></div>');
});

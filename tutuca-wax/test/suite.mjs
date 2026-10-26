// The vdom's tests, run by test/jsdom.test.mjs against jsdom and by
// test/browser.test.mjs in Chromium. The first eight are tutuca's
// test/vdom/vdom.test.js; the rest are tutuca-mb's vdom/memdom/vdom_test.mbt
// cases that JS doesn't have.
//
// Each case gets { vdom, window, document, container }: vdom is the loaded
// module's API (js/tutuca-rt.js), container a detached <div>.
import { classStyles, loadCssCompiler } from "../js/css.js";
import { examples, exhaust, fails, walk } from "../js/pbt.js";
import * as assert from "./assert.mjs";

const SVG = "http://www.w3.org/2000/svg";
const MATH = "http://www.w3.org/1998/Math/MathML";
const HTML = "http://www.w3.org/1999/xhtml";

// Runs fn and resolves with the DOM mutations it caused in node.
const mutationsOf = async (window, node, fn) => {
	const records = [];
	const observer = new window.MutationObserver((rs) => records.push(...rs));
	observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
	fn();
	await new Promise((resolve) => setTimeout(resolve, 0));
	records.push(...observer.takeRecords());
	observer.disconnect();
	return records;
};

export const cases = [];
// The component modules of dist/components/ every case's scope has.
export const MODULES = ["counter", "todo_item", "todo_list"];
// The ones cases load into scopes of their own: todo_card registers TodoItem
// too, so it would take the name over in the shared scope; showcase's and
// json's types are only for their own cases.
const OWN_SCOPE_MODULES = ["todo_card", "showcase", "json", "probe", "pbt"];
// The modules defined in TCD, whose models (tcd model) js/pbt.js tests from.
const TCD_MODULES = ["counter", "todo_item", "todo_list", "todo_card", "showcase", "json", "pbt"];
const test = (name, fn) => cases.push({ name, fn });

test("render mounts, then morphs in place from what the last render returned", ({ vdom, document, container }) => {
	const { h } = vdom;
	const prev = vdom.render(document, container, [h("p", { class: "a" }, "one"), "tail"]);
	assert.equal(vdom.length(prev), 2);
	assert.equal(container.innerHTML, '<p class="a">one</p>tail');
	const p = container.firstChild;
	vdom.render(document, container, [h("p", { class: "b" }, "two"), "tail"], prev);
	assert.equal(container.innerHTML, '<p class="b">two</p>tail');
	assert.equal(container.firstChild, p);
});

test("namespaces: svg and math are detected, inherited, and reset by foreignObject", ({ vdom, document, container }) => {
	const { h } = vdom;
	const tree = (extra) =>
		h("div", {}, [
			h("SVG", {}, [h("circle", { r: "1" }), h("foreignObject", {}, [h("span", {}, "html")]), ...extra]),
			h("math", {}, [h("mi", {}, "x")]),
			h("g", { namespace: SVG }),
		]);
	const prev = vdom.render(document, container, [tree([])]);
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
	vdom.render(document, container, [tree([h("rect", {}), h("foreignObject", {}, [h("b")])])], prev);
	assert.equal(ns("rect"), SVG);
	assert.equal(ns("foreignObject ~ foreignObject > b"), HTML);
});

test("an unchanged re-render writes nothing to the DOM", async ({ vdom, window, document, container }) => {
	const { h } = vdom;
	const tree = () => h("ul", {}, [1, 2, 3].map((i) => h("li", { class: "r" }, [h("b", {}, i), " x"])));
	const prev = vdom.render(document, container, [tree()]);
	const records = await mutationsOf(window, container, () => vdom.render(document, container, [tree()], prev));
	assert.equal(records.length, 0);
});

test("nodes other code put in a rendered element stay, and don't shift the morph", async ({ vdom, window, document, container }) => {
	const { h, frag } = vdom;
	const tree = (items, label) =>
		h("ul", {}, [...items.map((i) => h("li", { key: i }, i)), frag([h("li", {}, label), "tail"])]);
	let prev = vdom.render(document, container, [tree(["a", "b"], "x")]);
	const ul = container.firstChild;
	const foreign = [
		document.createComment('§{"t":"other"}§'),
		document.createElement("aside"),
		document.createTextNode("ad"),
	];
	ul.prepend(foreign[0]);
	ul.children[1].after(foreign[1]);
	ul.append(foreign[2]);
	const records = await mutationsOf(window, container, () => {
		prev = vdom.render(document, container, [tree(["a", "b"], "x")], prev);
	});
	assert.equal(records.length, 0);
	vdom.render(document, container, [tree(["b", "c", "a"], "y")], prev);
	const owned = [...ul.childNodes].filter((n) => !foreign.includes(n));
	assert.deepEqual(
		owned.map((n) => n.textContent),
		["b", "c", "a", "y", "tail"],
	);
	for (const node of foreign) assert.equal(node.parentNode, ul);
});

test("a changed leaf only writes that leaf", async ({ vdom, window, document, container }) => {
	const { h } = vdom;
	const tree = (last) => h("ul", {}, [h("li", {}, "a"), h("li", {}, "b"), h("li", {}, last)]);
	const prev = vdom.render(document, container, [tree("c")]);
	const records = await mutationsOf(window, container, () => vdom.render(document, container, [tree("C")], prev));
	assert.deepEqual(
		records.map((r) => [r.type, r.target.data]),
		[["characterData", "C"]],
	);
});

test("a shared vnode is skipped by identity, without looking at the DOM", ({ vdom, document, container }) => {
	const { h } = vdom;
	const shared = h("header", {}, [h("h1", {}, "Title")]);
	const prev = vdom.render(document, container, [shared, h("p", {}, "1")]);
	container.querySelector("h1").textContent = "changed outside";
	vdom.render(document, container, [shared, h("p", {}, "2")], prev);
	assert.equal(container.querySelector("h1").textContent, "changed outside");
	assert.equal(container.querySelector("p").textContent, "2");
});

test("a select reapplies its value when its options change", ({ vdom, document, container }) => {
	const { h } = vdom;
	const tree = (opts) => h("select", { value: "b" }, opts.map((o) => h("option", { value: o }, o)));
	const prev = vdom.render(document, container, [tree(["a"])]);
	vdom.render(document, container, [tree(["a", "b"])], prev);
	assert.equal(container.querySelector("select").value, "b");
});

test("same tag with a different shape replaces the element", ({ vdom, document, container }) => {
	const { h } = vdom;
	const prev = vdom.render(document, container, [h("div", { class: "a" })]);
	const first = container.firstChild;
	vdom.render(document, container, [h("div", { title: "t" })], prev);
	assert.notEqual(container.firstChild, first);
	assert.equal(container.innerHTML, '<div title="t"></div>');
});

test("keyed children move instead of being rebuilt", ({ vdom, document, container }) => {
	const { h } = vdom;
	const row = (k) => h("li", { key: k }, k);
	const prev = vdom.render(document, container, [row("a"), row("b"), row("c")]);
	const b = container.children[1];
	vdom.render(document, container, [row("c"), row("b"), row("d")], prev);
	assert.equal(container.innerHTML, "<li>c</li><li>b</li><li>d</li>");
	assert.equal(container.children[1], b);
});

test("many keyed children reorder with their nodes (sibling key hash collisions)", ({ vdom, document, container }) => {
	const { h } = vdom;
	const keys = Array.from({ length: 300 }, (_, i) => `k${i}`);
	const row = (k) => h("li", { key: k }, k);
	const prev = vdom.render(document, container, keys.map(row));
	const nodes = new Map([...container.children].map((li) => [li.textContent, li]));
	// A fixed shuffle, so a failure repeats.
	const shuffled = [...keys].sort((a, b) => ((a.length * 7919 + a.charCodeAt(a.length - 1) * 31) % 97) - ((b.length * 7919 + b.charCodeAt(b.length - 1) * 31) % 97) || a.localeCompare(b));
	vdom.render(document, container, shuffled.map(row), prev);
	assert.deepEqual([...container.children].map((li) => li.textContent), shuffled);
	for (const li of container.children) assert.equal(li, nodes.get(li.textContent));
});

test("fragments morph as groups and empty fragments keep placement", ({ vdom, document, container }) => {
	const { frag } = vdom;
	const tree = (mid) => ["<", frag(mid, "m"), frag([]), ">"];
	let prev = vdom.render(document, container, tree(["1", "2"]));
	assert.equal(container.innerHTML, "&lt;12&gt;");
	prev = vdom.render(document, container, tree(["2", "3", "4"]), prev);
	assert.equal(container.innerHTML, "&lt;234&gt;");
	vdom.render(document, container, tree([]), prev);
	assert.equal(container.innerHTML, "&lt;&gt;");
});

test("duplicate sibling keys raise", ({ vdom, document, container }) => {
	const { h } = vdom;
	const prev = vdom.render(document, container, [h("i", { key: "x" })]);
	assert.throws(
		() => vdom.render(document, container, [h("i", { key: "x" }), h("b", { key: "x" })], prev),
		/Duplicate sibling key: x/,
	);
});

test("checked and value are properties, false booleans remove attributes", ({ vdom, document, container }) => {
	const { h } = vdom;
	const tree = (on) => h("input", { type: "checkbox", checked: on, disabled: on, "data-x": on });
	const prev = vdom.render(document, container, [tree(true)]);
	const input = container.querySelector("input");
	assert.equal(input.checked, true);
	assert.equal(input.disabled, true);
	assert.equal(input.getAttribute("data-x"), "true");
	vdom.render(document, container, [tree(false)], prev);
	assert.equal(input.checked, false);
	assert.equal(input.hasAttribute("disabled"), false);
	assert.equal(input.getAttribute("data-x"), "false");
});

test("dangerouslySetInnerHTML sets markup and skips children", async ({ vdom, window, document, container }) => {
	const { h } = vdom;
	// No children: creating an element appends them after the markup, as JS
	// does; only morphing skips them.
	const tree = (html) => h("div", { dangerouslySetInnerHTML: { __html: html } });
	const prev = vdom.render(document, container, [tree("<b>x</b>")]);
	assert.equal(container.innerHTML, "<div><b>x</b></div>");
	const records = await mutationsOf(window, container, () => vdom.render(document, container, [tree("<b>x</b>")], prev));
	assert.equal(records.length, 0);
});

test("value and checked cannot be static", ({ vdom }) => {
	assert.throws(() => vdom.shape("input", null, { value: "x" }), /value must be a dynamic attr/);
	assert.throws(() => vdom.shape("input", null, { checked: true }), /checked must be a dynamic attr/);
});

test("nodes someone else removed or added don't make a morph read out of range", ({ vdom, document, container }) => {
	const { h } = vdom;
	let prev = vdom.render(document, container, [h("p", {}, "a"), h("b", {}, "b")]);
	// Something outside the renderer takes both nodes away (tutuca's JS morph
	// throws here, reading the first of no nodes; tutuca-mb mounts anew).
	container.replaceChildren();
	prev = vdom.render(document, container, [h("p", {}, "a2"), h("b", {}, "b2")], prev);
	assert.equal(container.innerHTML, "<p>a2</p><b>b2</b>");
	// And something adds one of its own, which stays. The <p> moves past it,
	// as in JS: its old next sibling, <b>, is only removed after placement.
	container.append(document.createComment("foreign"));
	vdom.render(document, container, [h("p", {}, "a3")], prev);
	assert.equal(container.innerHTML, "<!--foreign--><p>a3</p>");
});

// Lowering the semantic tree: the spec's bind/lower.rkt tests, through the DOM.

const C = '<!--§{"t":"component"}§-->';
const E = "<!--§/§-->";
const frameComment = (keys, item = null) =>
	`<!--§{"t":"frame","p":null,"k":${JSON.stringify(keys)},"i":${JSON.stringify(item)}}§-->`;

test("lowering: a component is wrapped in its metadata comments", ({ vdom, document, container }) => {
	const { sem } = vdom;
	const b = sem.template(1, "b");
	sem.render(document, container, [sem.component("C", [sem.el(b, [], "x")])]);
	assert.equal(container.innerHTML, `${C}<b>x</b>${E}`);
});

test("lowering: an element with handlers gets data-eid, and handlers never render", ({ vdom, document, container }) => {
	const { sem } = vdom;
	const button = sem.template(4, "button", {
		staticAttrs: { class: "b" },
		names: ["title"],
		handlers: [{ event: "click", name: "go", args: [1, { targetValue: true }, { if: [true, "a", { sourceKey: true }] }] }],
	});
	sem.render(document, container, [sem.el(button, ["t"])]);
	const el = container.firstChild;
	assert.deepEqual(
		el.getAttributeNames().sort(),
		["class", "data-eid", "title"],
	);
	assert.equal(el.getAttribute("data-eid"), "4");
	assert.equal(el.getAttribute("title"), "t");
	// Without handlers, no data-eid.
	sem.render(document, container, [sem.el(sem.template(5, "button"), [])]);
	assert.equal(container.firstChild.hasAttribute("data-eid"), false);
});

test("lowering: svg and math are detected by the shape", ({ vdom, document, container }) => {
	const { sem } = vdom;
	sem.render(document, container, [sem.el(sem.template(1, "SVG"), [])]);
	assert.equal(container.innerHTML, "<svg></svg>");
	assert.equal(container.firstChild.namespaceURI, "http://www.w3.org/2000/svg");
});

test("lowering: a frame wrapper writes the frame without its component flag, then the component", ({ vdom, document, container }) => {
	const { sem } = vdom;
	const frame = sem.frame({ keys: ["todo"], isComponent: true });
	sem.render(document, container, [sem.enter(frame, [sem.component("Todo", ["T"])])]);
	assert.equal(container.innerHTML, `${frameComment(["todo"])}${C}T${E}${E}`);
});

test("lowering: a loop is an unkeyed group of keyed items, each between its frame's comments", ({ vdom, document, container }) => {
	const { sem } = vdom;
	const loop = (keys) =>
		sem.items(keys.map((k, i) => ({ key: k, frame: sem.frame({ keys: ["items"], item: i }), body: [k] })));
	let prev = sem.render(document, container, [loop(["a", "b"])]);
	assert.equal(container.innerHTML, `${frameComment(["items"], 0)}a${E}${frameComment(["items"], 1)}b${E}`);
	const textA = container.childNodes[1];
	// Keyed items move with their nodes: "a" keeps its text node.
	prev = sem.render(document, container, [loop(["b", "a"])], prev);
	assert.equal(container.innerHTML, `${frameComment(["items"], 0)}b${E}${frameComment(["items"], 1)}a${E}`);
	assert.equal(container.childNodes[4], textA);
});

test("lowering: provider frames and keys are written as JSON", ({ vdom }) => {
	const { sem } = vdom;
	const f = sem.frame({ keys: [], item: 2, provider: { name: "sel", depth: 0, keys: ["items", 1] } });
	assert.equal(sem.frameMeta(f), '§{"t":"frame","p":{"v":"sel","d":0,"k":["items",1]},"k":[],"i":2}§');
	const odd = sem.frame({ keys: ['a"b\\c\n', "é😀", "\ud800"], item: "§" });
	assert.equal(sem.frameMeta(odd), `§${JSON.stringify({ t: "frame", p: null, k: ['a"b\\c\n', "é😀", "\ud800"], i: "§" })}§`);
});

test("lowering: an unchanged re-render of a semantic tree writes nothing", async ({ vdom, window, document, container }) => {
	const { sem } = vdom;
	const li = sem.template(1, "li", { names: ["class"] });
	const tree = () => [
		sem.component("List", [
			sem.items(["x", "y"].map((k, i) => ({ key: k, frame: sem.frame({ keys: ["rows"], item: i }), body: [sem.el(li, ["r"], k)] }))),
		]),
	];
	const prev = sem.render(document, container, tree());
	const records = await mutationsOf(window, container, () => sem.render(document, container, tree(), prev));
	assert.equal(records.length, 0);
});

// ---- Value, List and Map ---------------------------------------------------

// mulberry32, so a failure names its seed.
const prng = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const STRINGS = ["", "a", "é", "😀", "\ud800", "key", "__html", "__proto__", "a\"b\\c\n", "§"];
const randomJs = (rand, depth = 0) => {
	const r = rand();
	if (r < 0.1) return null;
	if (r < 0.2) return rand() < 0.5;
	if (r < 0.35) return Math.floor(rand() * 2 ** 32) - 2 ** 31; // i32
	if (r < 0.45) return [0.5, -1e300, 2 ** 40, 1e-7, Number.MAX_VALUE][Math.floor(rand() * 5)];
	if (r < 0.6 || depth > 3) return STRINGS[Math.floor(rand() * STRINGS.length)] + String(Math.floor(rand() * 9));
	if (r < 0.8) return Array.from({ length: Math.floor(rand() * 5) }, () => randomJs(rand, depth + 1));
	const out = {};
	for (let i = Math.floor(rand() * 5); i > 0; i--) {
		// defineProperty, so "__proto__" is a key, not the prototype.
		const key = STRINGS[Math.floor(rand() * STRINGS.length)];
		Object.defineProperty(out, key, { value: randomJs(rand, depth + 1), enumerable: true, writable: true, configurable: true });
	}
	return out;
};

test("values: JS values round-trip through Value", ({ vdom }) => {
	const { values } = vdom;
	const rand = prng(11);
	for (let i = 0; i < 300; i++) {
		const js = randomJs(rand);
		assert.deepEqual(values.to(values.from(js)), js, `case ${i}:`);
	}
	// Integers in i32's range are Int, other numbers Float, -0 included.
	assert.equal(values.kind(values.from(7)), "int");
	assert.equal(values.kind(values.from(2 ** 31)), "float");
	assert.equal(values.kind(values.from(0.5)), "float");
	assert.ok(Object.is(values.to(values.from(-0)), -0), "-0 stays -0");
	assert.ok(Number.isNaN(values.to(values.from(Number.NaN))), "NaN stays NaN");
	// Results and their payloads.
	assert.deepEqual(values.to(values.ok([1, "x"])), { ok: [1, "x"] });
	assert.deepEqual(values.to(values.err({ code: 3 })), { err: { code: 3 } });
	assert.equal(values.kind(values.ok(null)), "result");
});

test("values: same is JS ===, truthy is JS truthiness", ({ vdom }) => {
	const { values } = vdom;
	const list = values.from([1]);
	const same = [
		[1, 1, true],
		[1, 1.0, true],
		[0.5, 0.5, true],
		[Number.NaN, Number.NaN, false],
		["a", "a", true],
		["a", "b", false],
		[null, null, true],
		[null, false, false],
		[true, true, true],
		[0, false, false],
		[list, list, true],
		[list, values.from([1]), false],
	];
	same.forEach(([a, b, expected], i) => assert.equal(values.same(a, b), expected, `pair ${i}:`));
	for (const v of [null, false, true, 0, 1, -1, 0.5, Number.NaN, "", "0", "a", [], {}, [0]]) {
		assert.equal(values.truthy(v), Boolean(v), `truthy(${JSON.stringify(v)}):`);
	}
});

test("values: List is persistent, against an array model", ({ vdom }) => {
	const w = vdom.exports;
	const { values } = vdom;
	const rand = prng(5);
	let list = w.list_empty();
	let model = [];
	const versions = [];
	for (let step = 0; step < 1500; step++) {
		const r = rand();
		if (r < 0.75 || model.length === 0) {
			list = w.list_push(list, values.from(step));
			model = [...model, step];
		} else if (r < 0.9) {
			const i = Math.floor(rand() * (model.length + 1)); // count appends
			list = w.list_assoc(list, i, values.from(-step));
			model = i === model.length ? [...model, -step] : model.with(i, -step);
		} else {
			list = w.list_pop(list);
			model = model.slice(0, -1);
		}
		if (step % 97 === 0) versions.push([list, model]);
	}
	// Every count from 0 to past 1056, the vector's tail and trie boundaries.
	assert.equal(w.list_count(list), model.length);
	assert.deepEqual(values.to(list), model);
	assert.equal(w.list_get(list, model.length), null);
	assert.equal(w.list_get(list, -1), null);
	// Old versions are unchanged by what came after them.
	for (const [old, oldModel] of versions) assert.deepEqual(values.to(old), oldModel);
});

test("values: Map is persistent, against a Map model", ({ vdom }) => {
	const w = vdom.exports;
	const { values } = vdom;
	const rand = prng(9);
	let map = w.map_empty();
	let model = new Map();
	const versions = [];
	const key = () => `k${Math.floor(rand() * 3000)}${STRINGS[Math.floor(rand() * STRINGS.length)]}`;
	for (let step = 0; step < 4000; step++) {
		const k = key();
		if (rand() < 0.8) {
			map = w.map_assoc(map, k, values.from(step));
			model = new Map(model).set(k, step);
		} else {
			map = w.map_dissoc(map, k);
			model = new Map(model);
			model.delete(k);
		}
		if (step % 211 === 0) versions.push([map, model]);
	}
	const check = (m, mdl) => {
		assert.equal(w.map_count(m), mdl.size);
		for (const [k, v] of mdl) assert.equal(values.to(w.map_get(m, k)), v, `${k}:`);
		assert.deepEqual(
			Object.keys(values.to(m)).sort(),
			[...mdl.keys()].sort(),
		);
	};
	check(map, model);
	assert.equal(w.map_get(map, "missing"), null);
	for (const [old, oldModel] of versions) check(old, oldModel);
});

test("values: list and map props reach the DOM as JS values, as in tutuca's JS", ({ vdom, document, container }) => {
	const { h } = vdom;
	// title is a property: node.title = ["a", "b"] writes "a,b".
	// data-list is an attribute: setAttribute(name, [1, 2]) writes "1,2".
	vdom.render(document, container, [h("div", { title: ["a", "b"], "data-list": [1, 2], "data-map": { a: 1 } })]);
	const div = container.firstChild;
	assert.equal(div.title, "a,b");
	assert.equal(div.getAttribute("data-list"), "1,2");
	assert.equal(div.getAttribute("data-map"), "[object Object]");
});

// ---- Paths: the spec's component/paths.rkt cases ------------------------------

const pathOf = (vdom, frames) => {
	const w = vdom.exports;
	const out = w.frame_array_new(frames.length);
	frames.forEach((f, i) => w.frame_array_set(out, i, vdom.sem.frame(f)));
	return out;
};

test("paths: frames resolve to keys; a provider jump restarts from the frame that captured it", ({ vdom }) => {
	const w = vdom.exports;
	const { values } = vdom;
	const resolve = (frames) => values.to(w.path_resolve(pathOf(vdom, frames)));
	const jump = { keys: [], provider: { name: "sel", depth: 0, keys: ["items", 1] }, isComponent: true };
	assert.deepEqual(resolve([{ keys: ["child"], isComponent: true }, jump, { keys: ["kids"], item: 0, isComponent: true }]), ["items", 1, "kids", 0]);
	assert.deepEqual(resolve([{ keys: ["child"], isComponent: true }, { ...jump, item: 0, isComponent: false }]), ["items", 1, 0]);
	assert.deepEqual(
		resolve([{ keys: ["panel"], isComponent: true }, { keys: [], provider: { name: "c", depth: 1, keys: ["child"] }, isComponent: true }]),
		["panel", "child"],
	);
});

test("paths: loop items that aren't component frames belong to the enclosing component", ({ vdom }) => {
	const w = vdom.exports;
	const { values } = vdom;
	const toUpdate = (frames) => values.to(w.path_to_update(pathOf(vdom, frames)));
	assert.deepEqual(toUpdate([{ keys: ["a"], isComponent: true }, { keys: ["xs"], item: 0 }, { keys: [], item: 1 }]), ["a"]);
	assert.deepEqual(toUpdate([{ keys: ["xs"], item: 0, isComponent: true }, { keys: ["ys"], item: 1 }]), ["xs", 0]);
});

test("paths: the source key is the item key leading out of the receiver's view", ({ vdom }) => {
	const w = vdom.exports;
	const { values } = vdom;
	const p = [{ keys: ["mids"], item: 1, isComponent: true }, { keys: ["rows"], item: 1 }, { keys: ["cells"], item: 2, isComponent: true }];
	const sourceKeyIn = (path, receiver) => values.to(w.path_source_key_in(pathOf(vdom, path), pathOf(vdom, receiver)));
	assert.equal(sourceKeyIn(p, []), 1);
	assert.equal(sourceKeyIn(p, [p[0]]), 2);
	assert.equal(sourceKeyIn(p, p), null);
	assert.equal(sourceKeyIn([{ keys: ["a"], isComponent: true }], []), null);
});

test("paths: getIn and setIn read and write through maps, lists and components", ({ vdom, scope: examples }) => {
	const w = vdom.exports;
	const { values, runtime } = vdom;
	const root = values.from({ items: [{ count: 0 }, { count: 5 }], child: { count: 2 } });
	const getIn = (keys, r = root) => values.to(w.path_get_in(values.from(keys), r));
	assert.deepEqual(getIn([]), values.to(root));
	assert.equal(getIn(["child", "count"]), 2);
	assert.equal(getIn(["items", 1, "count"]), 5);
	assert.equal(getIn(["missing"]), null);
	const set = w.path_set_in(values.from(["items", 1, "count"]), root, values.from(6));
	assert.equal(getIn(["items", 1, "count"], set), 6);
	assert.equal(getIn(["items", 1, "count"]), 5, "the old root is unchanged");
	// Reading below null fails.
	assert.throws(() => getIn(["missing", "x"]), /isn't a component, map or list, at key "x"/);
	// Through a component's get and set.
	const scope = examples;
	const board = values.from({ counter: runtime.make(scope, "Counter", { count: 4 }) });
	assert.equal(getIn(["counter", "count"], board), 4);
	const changed = w.path_set_in(values.from(["counter", "count"]), board, values.from(9));
	assert.equal(getIn(["counter", "count"], changed), 9);
	assert.equal(runtime.typeName(w.path_get_in(values.from(["counter"]), changed)), "Counter");
});

// ---- The component runtime, through the example component modules ------------
// components/: counter (Board, the root of a loop of Counters, Counter and
// Label), todo_item and todo_list. Every case gets a scope they're all
// loaded into, and their bytes to load into scopes of its own.

const mountRoot = ({ vdom, document, container, scope }, type, fields, options) => {
	const root = vdom.runtime.make(scope, type, fields);
	const host = vdom.runtime.createHost(document, container, root, options).mount();
	return { scope, host };
};

const click = (window, node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
// The marker classes among names an element has, in that order: the
// components' semantic classes, next to their tailwind and margaui ones.
const marks = (el, ...names) => names.filter((n) => el.classList.contains(n)).join(" ");
const buttons = (container, label) => [...container.querySelectorAll("button")].filter((b) => b.textContent === label);
const counts = (container) => [...container.querySelectorAll("span")].map((s) => s.textContent);

test("components: the root renders in its metadata comments", (env) => {
	const { container } = env;
	mountRoot(env, "Board", { counters: [], total: 0 });
	assert.equal(
		container.innerHTML,
		'<!--§{"t":"component"}§--><section class="flex flex-col items-start gap-2"><div class="flex items-center gap-2"><button class="btn btn-sm" data-eid="3">add</button><button class="btn btn-sm btn-outline" data-eid="4">reset all</button><p class="font-semibold tabular-nums">total 0</p></div></section><!--§/§-->',
	);
});

test("components: init fills defaults and reports why; unknown types aren't made", ({ vdom, scope: examples }) => {
	const { runtime } = vdom;
	const scope = examples;
	assert.deepEqual(runtime.issues(scope, "Counter", { count: "x" }), [{ field: "count", problem: "wrong type" }]);
	assert.deepEqual(runtime.issues(scope, "Counter", {}), [{ field: "count", problem: "missing" }]);
	assert.equal(runtime.get(runtime.make(scope, "Counter", { count: "x" }), "count"), 0);
	assert.equal(runtime.typeName(runtime.make(scope, "Counter", { count: 3 })), "Counter");
	assert.throws(() => runtime.make(scope, "Nope"), /No component type is registered as Nope/);
});

test("components: scopes resolve names here first, then in their parents", ({ vdom, scope: examples }) => {
	const { runtime } = vdom;
	const scope = examples;
	const inner = runtime.enter(scope, "inner");
	assert.equal(runtime.enter(scope, "inner"), inner, "a child scope is made once");
	assert.equal(runtime.typeName(runtime.make(inner, "Counter", { count: 1 })), "Counter");
});

test("components: a click runs the handler of the element it hits, in its component", (env) => {
	const { vdom, window, container } = env;
	const { host } = mountRoot(env, "Board", { counters: [], total: 0 });
	click(window, buttons(container, "add")[0]);
	click(window, buttons(container, "add")[0]);
	assert.deepEqual(counts(container), ["0", "1"]);
	// The second counter's +: only it changes; its notify bubbles to the Board.
	click(window, buttons(container, "+")[1]);
	assert.deepEqual(counts(container), ["0", "2"]);
	assert.equal(container.querySelector("p").textContent, "total 1");
	assert.equal(vdom.runtime.get(host.root(), "total"), 1);
	assert.deepEqual(host.failures, []);
});

test("components: a click on an element without handlers in a component goes nowhere", async (env) => {
	const { window, container } = env;
	const { host } = mountRoot(env, "Board", { counters: [], total: 0 });
	click(window, buttons(container, "add")[0]);
	const before = host.root();
	const records = await mutationsOf(window, container, () => click(window, container.querySelector("span")));
	assert.equal(records.length, 0);
	assert.equal(host.root(), before);
});

test("components: event arguments are evaluated on dispatch: literals and the target's value", (env) => {
	const { window, container } = env;
	const { host } = mountRoot(env, "Counter", { count: 1 });
	click(window, buttons(container, "+10")[0]);
	assert.deepEqual(counts(container), ["11"]);
	const input = container.querySelector("input");
	assert.equal(input.value, "11");
	input.value = "5";
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.deepEqual(counts(container), ["5"]);
	// Not a number: the handler keeps the count.
	input.value = "abc";
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.deepEqual(counts(container), ["5"]);
	assert.deepEqual(host.failures, []);
});

test("components: a notify bubbles to the parent with the child's key as the source key", (env) => {
	const { window, container } = env;
	mountRoot(env, "Board", { counters: [], total: 0 });
	for (let i = 0; i < 3; i++) click(window, buttons(container, "add")[0]);
	assert.deepEqual(counts(container), ["0", "1", "2"]);
	click(window, buttons(container, "x")[1]);
	assert.deepEqual(counts(container), ["0", "2"]);
});

test("components: sendAt reaches children by selector, frozen against the new root", (env) => {
	const { window, container } = env;
	mountRoot(env, "Board", { counters: [], total: 0 });
	for (let i = 0; i < 3; i++) click(window, buttons(container, "add")[0]);
	click(window, buttons(container, "+")[2]);
	assert.deepEqual(counts(container), ["0", "1", "3"]);
	click(window, buttons(container, "reset all")[0]);
	assert.deepEqual(counts(container), ["0", "0", "0"]);
});

test("components: an ask the scope answers now replies in the same run", (env) => {
	const { container } = env;
	const { host } = mountRoot(env, "Counter", { count: 1 });
	host.send("load");
	assert.deepEqual(counts(container), ["42"]);
});

test("components: an ask the host answers later replies when it settles", async (env) => {
	const { container } = env;
	let answer = 7;
	const { host } = mountRoot(env, "Counter", { count: 1 }, { asks: { fetchCount: async () => answer } });
	host.send("fetch");
	assert.deepEqual(counts(container), ["1"]);
	await host.settled();
	assert.deepEqual(counts(container), ["7"]);
	// A failed answer replies with ReplyError, which Counter doesn't handle.
	answer = null;
	const failing = mountRoot(env, "Counter", { count: 1 }, { asks: { fetchCount: async () => Promise.reject(new Error("offline")) } });
	failing.host.send("fetch");
	await failing.host.settled();
	assert.deepEqual(failing.host.unhandled, ["fetchCountReplyError"]);
});

test("components: a handler can swap its component for one of another type", (env) => {
	const { vdom, container } = env;
	const { host } = mountRoot(env, "Counter", { count: 3 });
	host.send("toLabel");
	assert.equal(vdom.runtime.typeName(host.root()), "Label");
	assert.equal(container.innerHTML, '<!--§{"t":"component"}§--><p class="text-sm italic opacity-70">was 3</p><!--§/§-->');
});

test("components: a failing task commits nothing", async (env) => {
	const { window, container } = env;
	const { host } = mountRoot(env, "Counter", { count: 3 });
	const before = host.root();
	const records = await mutationsOf(window, container, () => host.send("add", ["not a number"]));
	assert.equal(host.failures.length, 1);
	assert.ok(/rejected the message add/.test(host.failures[0].message), host.failures[0].message);
	assert.equal(host.root(), before);
	assert.equal(records.length, 0);
	// The host goes on: the next task runs.
	host.send("add", [2]);
	assert.deepEqual(counts(container), ["5"]);
});

test("components: unknown messages are observed and change nothing; logs are observed", (env) => {
	const { host } = mountRoot(env, "Counter", { count: 3 });
	const before = host.root();
	host.send("nope");
	assert.deepEqual(host.unhandled, ["nope"]);
	assert.equal(host.root(), before);
	host.send("loadCountReplyError", ["boom"]);
	assert.deepEqual(host.logs, ["boom"]);
});

// ---- Composition, through components/todo_list and todo_item ----------------

const todoTexts = (container) => [...container.querySelectorAll("li span")].map((s) => s.textContent);
const typeDraft = (window, container, text) => {
	const input = container.querySelector("input:not([type])");
	input.value = text;
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const addTodos = (env, ...texts) => {
	for (const text of texts) {
		typeDraft(env.window, env.container, text);
		click(env.window, buttons(env.container, "add")[0]);
	}
};
const toggle = (window, li) => {
	const box = li.querySelector("input[type=checkbox]");
	box.checked = !box.checked;
	box.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const footerText = (container) => container.querySelector("footer span").textContent;

test("todos: the list makes items from its draft, and clears the draft", (env) => {
	const { vdom, container } = env;
	const { host } = mountRoot(env, "TodoList", {});
	addTodos(env, "milk", "eggs");
	// An empty draft adds nothing.
	click(env.window, buttons(container, "add")[0]);
	assert.deepEqual(todoTexts(container), ["milk", "eggs"]);
	assert.equal(container.querySelector("input:not([type])").value, "");
	assert.equal(footerText(container), "2 of 2 left");
	const items = vdom.runtime.get(host.root(), "items");
	assert.deepEqual(items.map((c) => vdom.runtime.typeName(c)), ["TodoItem", "TodoItem"]);
	assert.deepEqual(items.map((c) => vdom.runtime.get(c, "id")), [0, 1]);
	assert.deepEqual(host.failures, []);
});

test("todos: an item handles its own checkbox; the list reads done through the item", (env) => {
	const { vdom, window, container } = env;
	const { host } = mountRoot(env, "TodoList", {});
	addTodos(env, "a", "b", "c");
	toggle(window, container.querySelectorAll("li")[1]);
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => marks(li, "todo", "done")), ["todo", "todo done", "todo"]);
	assert.equal(container.querySelectorAll("li input")[1].checked, true);
	assert.equal(footerText(container), "2 of 3 left");
	assert.equal(vdom.runtime.get(host.root(), "remaining"), 2);
});

test("todos: an item asks the list to remove it; keyed by id, the others keep their nodes", (env) => {
	const { window, container } = env;
	mountRoot(env, "TodoList", {});
	addTodos(env, "a", "b", "c");
	const third = container.querySelectorAll("li")[2];
	click(window, buttons(container, "x")[0]);
	assert.deepEqual(todoTexts(container), ["b", "c"]);
	assert.equal(container.querySelectorAll("li")[1], third);
});

test("todos: the list sends every item setDone, then drops the done ones", (env) => {
	const { window, container } = env;
	mountRoot(env, "TodoList", {});
	addTodos(env, "a", "b", "c");
	click(window, buttons(container, "all done")[0]);
	assert.equal(footerText(container), "0 of 3 left");
	toggle(window, container.querySelectorAll("li")[0]);
	click(window, buttons(container, "clear done")[0]);
	assert.deepEqual(todoTexts(container), ["a"]);
	assert.equal(footerText(container), "1 of 1 left");
});

test("todos: items made outside the list compose the same", (env) => {
	const { vdom, container, scope } = env;
	const { runtime } = vdom;
	const items = ["x", "y"].map((text, id) => runtime.make(scope, "TodoItem", { id, text, done: id === 1 }));
	const root = runtime.make(scope, "TodoList", { items, nextId: 2 });
	runtime.createHost(env.document, container, root).mount();
	assert.deepEqual(todoTexts(container), ["x", "y"]);
	assert.equal(footerText(container), "1 of 2 left");
	assert.deepEqual(runtime.issues(scope, "TodoItem", { id: 0, text: "z", done: "no" }), [{ field: "done", problem: "wrong type" }]);
});

// ---- Views as data, and walking them ----------------------------------------

test("walk: every kind in tutuca's Walker order, element by attrs, key, children, handlers", ({ vdom }) => {
	const { view: v } = vdom;
	const tree = v.h(
		"li",
		{ class: v.if(v.field("done"), "done", v.provided("theme")), key: v.lookupBind("key"), "on:click": v.send("pick", v.targetValue(), v.sourceKey(), v.dragKey()) },
		v.frag(v.seqItem("items", "sel"), v.render(v.field("child"), "card")),
		v.each(v.field("items"), v.renderIt()),
		v.renderEach(v.field("items")),
		v.scope("s", v.pushView("compact", "x")),
	);
	assert.deepEqual(v.kinds([tree]), [
		"el",
		...["if", "field", "const", "provided"],
		"lookupBind",
		...["frag", "seqItem", "render", "field"],
		...["each", "field", "renderIt"],
		...["renderEach", "field"],
		...["scope", "pushView", "const", "const"],
		...["action", "targetValue", "sourceKey", "dragKey"],
	]);
});

test("walk: a render_each defaults to each and a render_it to render", ({ vdom }) => {
	const { view: v } = vdom;
	const tree = v.h("ul", {}, v.each(v.field("a"), v.renderIt()), v.renderEach(v.field("b")), v.render(v.field("c")));
	assert.deepEqual(v.loops([tree]), ["each", "renderIt", "renderEach", "render"]);
});

test("collect: classes are the constants in class attrs, every if branch and loop body, each once", ({ vdom }) => {
	const { view: v } = vdom;
	const views = [
		v.h(
			"div",
			{ class: " a  b\tc ", title: "not-a-class" },
			v.h("p", { class: v.if(v.field("on"), "on b", "off") }, "text"),
			v.each(v.field("items"), v.h("li", { class: v.field("computed") }, v.h("i", { class: "icon" }))),
		),
		v.h("span", { class: "a d" }),
	];
	assert.deepEqual(v.classes(views), ["a", "b", "c", "on", "off", "icon", "d"]);
});

test("collect: templates in walk order, constant attrs static, the rest dynamic, tids from 1", ({ vdom, document, container }) => {
	const { view: v, sem } = vdom;
	const input = v.h("input", { placeholder: "say", value: v.field("draft"), "on:input": v.send("set", v.targetValue()) });
	const views = [v.h("section", { class: "todos" }, input, v.h("button", { "on:click": v.send("add", 10, v.if(true, "a", v.sourceKey())) }, "add"))];
	const ts = v.templates(views);
	assert.deepEqual(ts.map(v.tid), [1, 2, 3]);
	assert.equal(v.templateOf(input), ts[1]);
	// The input's template: placeholder static, value dynamic, data-eid since it has a handler.
	sem.render(document, container, [sem.el(ts[1], ["hi"])]);
	const el = container.firstChild;
	assert.deepEqual(el.getAttributeNames().sort(), ["data-eid", "placeholder"]);
	assert.equal(el.getAttribute("data-eid"), "2");
	assert.equal(el.value, "hi");
	// Without handlers, no data-eid.
	sem.render(document, container, [sem.el(ts[0], [])]);
	assert.deepEqual(container.firstChild.getAttributeNames(), ["class"]);
});

test("collect: an element shared by two views is one template; one already another type's fails", ({ vdom }) => {
	const { view: v } = vdom;
	const shared = v.h("b", {}, v.h("i"));
	assert.deepEqual(v.templates([v.h("p", {}, shared), shared]).map(v.tid), [1, 2, 3]);
	assert.throws(() => v.templates([v.h("p", {}, shared)]), /one component type/);
});

test("collect: a send argument reading the state fails", ({ vdom }) => {
	const { view: v } = vdom;
	assert.throws(() => v.templates([v.h("button", { "on:click": v.send("go", v.field("x")) })]), /send argument/);
});

test("views: scopes, loop hooks, seq items, floats, provided values, pushView and renderIt", async ({ vdom, window, document, container, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.showcase, scope);
	const note = (text) => runtime.make(scope, "Note", { text });
	const books = [
		{ title: "Dune", year: 1965, read: true },
		{ title: "Emma", year: 1815, read: false },
		{ title: "Ulysses", year: 1922, read: false },
	];
	const fields = { books, onlyUnread: false, tags: ["a", "b", "c"], current: 1, theme: "dark", note: note("pinned"), notes: [note("x"), note("y")] };
	runtime.createHost(document, container, runtime.make(scope, "Shelf", fields)).mount();
	const texts = (selector) => [...container.querySelectorAll(selector)].map((e) => e.textContent);
	// A scope's binds.
	assert.equal(container.querySelector("h2").textContent, "3 books");
	// enrich's label, and the item's own fields read in the body.
	assert.deepEqual(texts("li"), ["Dune (1965)", "Emma (1815)", "Ulysses (1922)"]);
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => marks(li, "read", "unread")), ["read", "unread", "unread"]);
	// tags[current], and a float as String(n) writes it.
	assert.equal(container.querySelector("p.tag").textContent, "b");
	assert.equal(container.querySelectorAll("section > p")[1].textContent, String(1 / 3));
	// pushView: the pinned note renders its compact view, with the theme Shelf provides.
	assert.equal(container.querySelector("small").className, "dark");
	assert.equal(container.querySelector("small").textContent, "pinned");
	// renderIt: each note in its main view.
	assert.deepEqual(texts("div.notes p.note"), ["x", "y"]);
	// byYear: its prepare sorts the indexes by year, its iter gives the books in that order.
	assert.deepEqual(texts("div.by-year span"), ["Emma", "Ulysses", "Dune"]);
	// The filter drops the read ones; keyed by title, Emma keeps its node.
	const emma = container.querySelectorAll("li")[1];
	click(window, buttons(container, "only unread")[0]);
	assert.deepEqual(texts("li"), ["Emma (1815)", "Ulysses (1922)"]);
	assert.equal(container.querySelectorAll("li")[0], emma);
	assert.equal(buttons(container, "show all").length, 1);
});

// ---- Drag and drop, through components/showcase --------------------------
// Shelf's books are draggable, data-dragtype "book", and each one is a drop
// target; its notes element is one too, for drops on the Notes in it.

const BOOKS = [
	{ title: "Dune", year: 1965, read: true },
	{ title: "Emma", year: 1815, read: false },
	{ title: "Ulysses", year: 1922, read: false },
];
const mountShelf = async ({ vdom, document, container, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.showcase, scope);
	const note = (text) => runtime.make(scope, "Note", { text });
	const fields = { books: BOOKS, onlyUnread: false, tags: ["a"], current: 0, theme: "dark", note: note("pinned"), notes: [note("x"), note("y")] };
	return runtime.createHost(document, container, runtime.make(scope, "Shelf", fields)).mount();
};
// A drag event of type on node, cancelable, with init's fields (relatedTarget).
const dragEvent = (window, type, node, init = {}) => {
	const e = new window.Event(type, { bubbles: true, cancelable: true });
	Object.assign(e, init);
	node.dispatchEvent(e);
	return e;
};
const shelfBooks = (container) => [...container.querySelectorAll("ul li")];

test("drag and drop: a book dropped on another moves there, with what's dragged in ctx.drag", async (env) => {
	const { window, container } = env;
	const host = await mountShelf(env);
	const [dune, emma, ulysses] = shelfBooks(container);
	dragEvent(window, "dragstart", dune);
	assert.equal(dune.dataset.dragging, "");
	// Over a drop target the drop is let happen, and the target is marked with the dragged type.
	assert.equal(dragEvent(window, "dragover", ulysses).defaultPrevented, true);
	assert.equal(ulysses.dataset.draggingover, "book");
	// Over something else it isn't, and the mark goes.
	assert.equal(dragEvent(window, "dragover", container.querySelector("h2")).defaultPrevented, false);
	assert.equal(ulysses.dataset.draggingover, undefined);
	// Leaving for another node inside keeps the mark; leaving the container drops it.
	dragEvent(window, "dragover", ulysses);
	dragEvent(window, "dragleave", ulysses, { relatedTarget: emma });
	assert.equal(ulysses.dataset.draggingover, "book");
	dragEvent(window, "dragleave", ulysses, { relatedTarget: null });
	assert.equal(ulysses.dataset.draggingover, undefined);
	dragEvent(window, "dragover", ulysses);
	assert.equal(dragEvent(window, "drop", ulysses).defaultPrevented, true);
	dragEvent(window, "dragend", dune);
	// moveBook(dragKey, sourceKey): Dune, at 0, to Ulysses' place, 2.
	assert.deepEqual(
		shelfBooks(container).map((li) => li.textContent),
		["Emma (1815)", "Ulysses (1922)", "Dune (1965)"],
	);
	// Keyed by title, Dune's node moved with it; the marks are gone.
	assert.equal(shelfBooks(container)[2], dune);
	assert.equal(dune.dataset.dragging, undefined);
	assert.equal(container.querySelector("[data-draggingover]"), null);
	// ctx.drag: its type, its value when the drag started, its key in Shelf.
	assert.deepEqual(host.logs, [{ type: "book", value: BOOKS[0], key: 0 }]);
	assert.deepEqual(host.failures, []);
});

test("drag and drop: drop events reach the nearest enclosing component that handles them", async (env) => {
	const { window, container } = env;
	const host = await mountShelf(env);
	const [, emma] = shelfBooks(container);
	const notes = container.querySelector("div.notes");
	const [x] = notes.querySelectorAll("p.note");
	dragEvent(window, "dragstart", emma);
	// A Note handles no drop: Shelf's notes element, around it, does.
	assert.equal(dragEvent(window, "dragover", x).defaultPrevented, true);
	assert.equal(notes.dataset.draggingover, "book");
	dragEvent(window, "drop", x);
	dragEvent(window, "dragend", emma);
	// noteBook(dragKey, sourceKey): Emma, at 1, to the note at 0, by sendAt.
	assert.deepEqual([...notes.querySelectorAll("p.note")].map((p) => p.textContent), ["Emma", "y"]);
	assert.equal(notes.dataset.draggingover, undefined);
	assert.deepEqual(host.failures, []);
});

test("drag and drop: something dragged from elsewhere has no drag and no key", async (env) => {
	const { window, container } = env;
	const host = await mountShelf(env);
	const [, , ulysses] = shelfBooks(container);
	dragEvent(window, "dragover", ulysses);
	assert.equal(ulysses.dataset.draggingover, "external");
	dragEvent(window, "drop", ulysses);
	assert.deepEqual(host.logs, [null]);
	assert.deepEqual(shelfBooks(container).map((li) => li.textContent), ["Dune (1965)", "Emma (1815)", "Ulysses (1922)"]);
	assert.equal(ulysses.dataset.draggingover, undefined);
});

test("drag and drop: a todo dropped on another takes its place, through the item to the list's on:drop", (env) => {
	const { window, container } = env;
	const { host } = mountRoot(env, "TodoList", {});
	addTodos(env, "a", "b", "c");
	const [a, , c] = container.querySelectorAll("li");
	// TodoItem handles no drop: the drop on its elements reaches TodoList's list.
	dragEvent(window, "dragstart", a.querySelector("span"));
	assert.equal(a.dataset.dragging, "");
	assert.equal(dragEvent(window, "dragover", c.querySelector("span")).defaultPrevented, true);
	assert.equal(container.querySelector("ul").dataset.draggingover, "todo");
	dragEvent(window, "drop", c.querySelector("span"));
	dragEvent(window, "dragend", a);
	assert.deepEqual(todoTexts(container), ["b", "c", "a"]);
	// Keyed by id, a's node moved with it.
	assert.equal(container.querySelectorAll("li")[2], a);
	assert.equal(container.querySelector("[data-dragging], [data-draggingover]"), null);
	assert.deepEqual(host.failures, []);
});

// ---- The JSON viewer and editor, through components/json --------------------

// The components for a JSON value, made in scope (fromJson in tutuca's
// components/json).
const fromJson = (runtime, scope, v) => {
	const make = (type, fields = {}) => runtime.make(scope, type, fields);
	if (v === null) return make("JsonNull");
	if (typeof v === "boolean") return make("JsonBool", { value: v });
	if (typeof v === "number") return make("JsonNumber", { value: v, text: String(v) });
	if (typeof v === "string") return make("JsonString", { value: v });
	if (Array.isArray(v)) return make("JsonArray", { items: v.map((x) => fromJson(runtime, scope, x)) });
	return make("JsonObject", { entries: Object.entries(v).map(([key, x]) => make("JsonEntry", { key, value: fromJson(runtime, scope, x) })) });
};
const DOC = { name: 'say "hi"\n', count: 2.5, tags: ["a", 1, true, null], empty: [], nested: { none: {}, ok: false } };
const mountJson = async ({ vdom, document, container, modules }, doc = DOC) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.json, scope);
	const root = runtime.make(scope, "JsonEditor", { value: fromJson(runtime, scope, doc), mode: "view", showText: true });
	return runtime.createHost(document, container, root).mount();
};
const jsonText = (container) => container.querySelector("pre").textContent;
const input = (window, node, value) => {
	node.value = value;
	node.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const toggleText = (window, container) => toggle(window, container.querySelector("label"));

test("json: the viewer renders a document read only, and its text as JSON.stringify writes it", async (env) => {
	const { container } = env;
	const host = await mountJson(env);
	assert.equal(jsonText(container), JSON.stringify(DOC, null, 2));
	assert.equal(container.querySelectorAll("input:not([type=checkbox])").length, 0);
	// Commas after every item but the last, from the loop's prepare and enrich.
	const tags = [...container.querySelectorAll("div.group")].map((row) => row.textContent);
	assert.ok(tags.includes('"a",') && tags.includes("null"), tags.join(" | "));
	assert.ok(container.textContent.includes("2.5"));
	// The text toggles.
	toggleText(env.window, container);
	assert.equal(container.querySelector("pre"), null);
	assert.deepEqual(host.failures, []);
});

test("json: the editor edits every value in place, its text following", async (env) => {
	const { window, container } = env;
	const host = await mountJson(env, { s: "x", n: 1, b: false, list: [1, 2] });
	click(window, buttons(container, "Edit")[0]);
	const inputs = () => [...container.querySelectorAll("input:not([type=checkbox])")];
	// Keys and strings and numbers are inputs; booleans toggle.
	const [keyS, valueS] = inputs();
	assert.equal(keyS.value, "s");
	input(window, valueS, 'y"');
	input(window, keyS, "str");
	const number = container.querySelector("input[inputmode=decimal]");
	input(window, number, "4e1");
	assert.ok(!number.classList.contains("text-error"));
	input(window, number, "abc");
	assert.ok(number.classList.contains("text-error"), "not a number: marked, and the value stays");
	click(window, buttons(container, "false")[0]);
	// The list: move its second item up, remove the one now second, add an
	// item and pick its type. The rows' buttons come in document order: the
	// object's s, n and b, the list's two items, then the list's own.
	click(window, container.querySelectorAll("button[title='Move up']")[4]);
	assert.deepEqual(JSON.parse(jsonText(container)).list, [2, 1]);
	click(window, container.querySelectorAll("button[title=Remove]")[4]);
	click(window, buttons(container, "+ item")[0]);
	assert.deepEqual(JSON.parse(jsonText(container)).list, [2, null]);
	click(window, container.querySelector("[aria-label='Pick a type'] button[title=string]"));
	click(window, buttons(container, "+ entry")[0]);
	click(window, [...container.querySelectorAll("[aria-label='Pick a type'] button[title=array]")].at(-1));
	assert.equal(jsonText(container), JSON.stringify({ str: 'y"', n: 40, b: true, list: [2, ""], key5: [] }, null, 2));
	// Back to view: the same tree, read only.
	click(window, buttons(container, "View")[0]);
	assert.equal(inputs().length, 0);
	assert.deepEqual(host.failures, []);
});

// ---- Schemas, dev checks, interfaces, through components/probe and the todos ---
// Probe breaks its own schema on purpose; Pretender registers as TodoItem
// without implementing TodoList's interface, and Impostor declares it with
// done an s32.

const probeScope = async ({ vdom, modules }) => {
	const scope = vdom.runtime.scope();
	await vdom.loadComponent(modules.probe, scope);
	return scope;
};
// A headless dev host for a Probe, and what each message sent to it reported.
const probeHost = async (env) => {
	const { runtime } = env.vdom;
	const scope = await probeScope(env);
	const host = runtime.createHost(null, null, runtime.make(scope, "Probe", { count: 0, label: "" }), { dev: true }).mount();
	const step = (name, args = []) => {
		const before = host.issues.length;
		host.send(name, args);
		return host.issues.slice(before);
	};
	return { host, step };
};

test("schemas: a component type's schema reads as data, types as TCD writes them", async (env) => {
	const { vdom, scope } = env;
	const { runtime } = vdom;
	const counter = runtime.schema(runtime.make(scope, "Counter", { count: 1 }));
	assert.deepEqual(counter.fields, [{ name: "count", type: "s32", constraints: [], sync: "shared" }]);
	const add = counter.messages.find((m) => m.name === "add");
	assert.deepEqual(add, {
		name: "add",
		args: [{ name: "n", type: "s32", constraints: [], sync: "shared" }],
		sourceKey: null,
		pre: false,
		post: true,
		changes: ["count"],
		emits: [],
	});
	assert.deepEqual(counter.messages.find((m) => m.name === "inc").emits, [{ kind: "notify", name: "changed" }]);
	const list = runtime.schema(runtime.make(scope, "TodoList", {}));
	assert.equal(list.fields[0].type, "list<TodoItem>");
	assert.deepEqual(list.messages.find((m) => m.name === "moveItem").args.map((a) => [a.type, a.constraints]), [
		["option<s32>", ["in keys(items)"]],
		["option<s32>", ["in keys(items)"]],
	]);
	assert.deepEqual(list.invariants, ["idsBelowNextId"]);
	assert.deepEqual(runtime.schema(runtime.make(scope, "TodoItem", { id: 0, text: "a", done: false })).interfaces, ["TodoItem"]);
	assert.deepEqual(runtime.interface(scope, "TodoItem").fields.map((f) => `${f.name}: ${f.type}`), ["id: s32", "text: string", "done: bool"]);
	assert.equal(runtime.interface(scope, "Nope"), null);
	// Generated by tcd from counter.tcd, like Counter's.
	assert.deepEqual(runtime.schema(runtime.make(scope, "Label", { text: "x" })).fields, [{ name: "text", type: "string", constraints: [], sync: "shared" }]);
});

test("schemas: arguments that don't fit are rejected before the handler, saying why", async (env) => {
	const { runtime } = env.vdom;
	const scope = await probeScope(env);
	const host = runtime.createHost(null, null, runtime.make(scope, "Probe", { count: 2 }));
	const before = host.root();
	for (const args of [[0], ["x"], []]) host.send("bump", args);
	host.send("fail");
	assert.deepEqual(
		host.failures.map((e) => e.rejection),
		[
			{ message: "bump", component: "Probe", reason: "invalidArg", index: 0, problem: "argument 0 (n): must be at least 1, got 0" },
			{ message: "bump", component: "Probe", reason: "wrongArgType", index: 0, problem: 'argument 0 (n): expected s32, got "x"' },
			{ message: "bump", component: "Probe", reason: "wrongArity", problem: "it takes 1 argument, got 0" },
			{ message: "fail", component: "Probe", reason: "failed", problem: "out of luck", detail: "out of luck" },
		],
	);
	assert.equal(host.failures[0].message, "The component rejected the message bump: argument 0 (n): must be at least 1, got 0");
	assert.equal(host.root(), before, "nothing committed");
});

test("dev: messages are checked against their contracts, fields after each task, invariants when settled", async (env) => {
	const { host, step } = await probeHost(env);
	assert.deepEqual(host.issues, [], "a valid start");
	assert.deepEqual(step("bump", [2]), []);
	// bump(3) adds 4: its post doesn't hold.
	assert.deepEqual(step("bump", [3]), [{ kind: "messageInvalid", message: "bump", component: "Probe", issues: ["post"] }]);
	// 7 is odd: the invariant is checked once the queue is empty.
	assert.deepEqual(step("bump", [1]), [
		{
			kind: "stateInvalid",
			settled: true,
			issues: [{ path: [], component: "Probe", field: null, reason: "invariant:even", problem: "the invariant even doesn't hold" }],
		},
	]);
	// Past 10: the field's constraint.
	assert.deepEqual(step("bump", [5]), [
		{
			kind: "stateInvalid",
			task: "bump",
			issues: [{ path: ["count"], component: "Probe", field: "count", value: 12, reason: "invalid", problem: "must be at most 10, got 12" }],
		},
	]);
	// At 12, bump's pre (count < 10) doesn't hold either.
	// It still runs (dev mode reports, it doesn't reject): 13 is past 10, and odd.
	const atTwelve = step("bump", [1]);
	assert.deepEqual(
		atTwelve.map((i) => [i.kind, i.issues.map((x) => (typeof x === "string" ? x : x.reason))]),
		[
			["messageInvalid", ["pre"]],
			["stateInvalid", ["invalid"]],
			["stateInvalid", ["invariant:even"]],
		],
	);
	// rename changes count too, outside its changes, and the label is too long.
	assert.deepEqual(step("rename", ["toolong"]), [
		{ kind: "messageInvalid", message: "rename", component: "Probe", issues: ["changes:count"] },
		{
			kind: "stateInvalid",
			task: "rename",
			issues: [{ path: ["label"], component: "Probe", field: "label", value: "toolong", reason: "invalid", problem: "must have at most 5 characters, got 7" }],
		},
	]);
	// shout may emit nothing, and notifies.
	assert.deepEqual(step("shout"), [{ kind: "messageInvalid", message: "shout", component: "Probe", issues: ["emits:notify:shouted"] }]);
	assert.deepEqual(host.failures, []);
});

test("dev: a host checks the whole state when it starts", async (env) => {
	const { runtime } = env.vdom;
	const scope = await probeScope(env);
	const host = runtime.createHost(null, null, runtime.make(scope, "Probe", { count: 11, label: "" }), { dev: true });
	assert.deepEqual(
		host.issues.map((i) => [i.kind, i.task, i.issues.map((x) => x.problem)]),
		[["stateInvalid", null, ["must be at most 10, got 11", "the invariant even doesn't hold"]]],
	);
});

test("interfaces: a type made or registered as an interface's name must implement it", async (env) => {
	const { vdom, modules } = env;
	const { runtime } = vdom;
	// Probe first: no interface yet, so Pretender registers as TodoItem.
	const scope = await probeScope(env);
	await vdom.loadComponent(modules.todo_list, scope);
	assert.throws(() => runtime.make(scope, "TodoItem"), /Pretender can't be a TodoItem: it doesn't declare that it implements TodoItem/);
	assert.throws(() => runtime.make(scope, "Impostor"), /Impostor can't be a TodoItem: its field done is s32, TodoItem's is bool/);
	// The other way around, registering fails, and the module doesn't load.
	const later = runtime.scope();
	await vdom.loadComponent(modules.todo_list, later);
	await assert.rejects(vdom.loadComponent(modules.probe, later), /Pretender can't be a TodoItem/);
	// The real ones implement it: the shared scope's todo_item, and todo_card.
	assert.equal(runtime.typeName(runtime.make(env.scope, "TodoItem", { id: 1, text: "a", done: false })), "TodoItem");
	const cards = runtime.scope();
	await vdom.loadComponent(modules.todo_list, cards);
	await vdom.loadComponent(modules.todo_card, cards);
	assert.deepEqual(runtime.schema(runtime.make(cards, "TodoItem", { id: 1, text: "a", done: false })).interfaces, ["TodoItem"]);
});

test("events: modifiers pick the events a handler takes, and prevent or stop them", async (env) => {
	const { window, document, container, vdom } = env;
	const { host } = mountRoot(env, "TodoList", {});
	typeDraft(window, container, "by enter");
	const input = container.querySelector("input:not([type])");
	const key = (k) => {
		const e = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
		input.dispatchEvent(e);
		return e;
	};
	assert.equal(key("a").defaultPrevented, false);
	assert.deepEqual(todoTexts(container), []);
	assert.equal(key("Enter").defaultPrevented, true, "+prevent");
	assert.deepEqual(todoTexts(container), ["by enter"]);
	// +ctrl and +stop, on a Probe in a container inside another element.
	const outer = document.createElement("section");
	const inner = document.createElement("div");
	outer.append(inner);
	const reached = [];
	outer.addEventListener("click", (e) => reached.push(e.target.className));
	const scope = await probeScope(env);
	const probe = vdom.runtime.createHost(document, inner, vdom.runtime.make(scope, "Probe", {})).mount();
	const click = (node, init = {}) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init }));
	click(inner.querySelector(".with-ctrl"));
	click(inner.querySelector(".with-ctrl"), { ctrlKey: true });
	click(inner.querySelector(".stopper"));
	assert.deepEqual(probe.logs, ["ctrl", "inner"], "the ctrl click only, and the stopper");
	assert.deepEqual(reached, ["with-ctrl", "with-ctrl"], "the stopper's click stopped at the container");
	assert.deepEqual(host.failures, []);
});

test("events: handlers read the pointer's data through event(name)", async (env) => {
	const { window, document, vdom } = env;
	const scope = await probeScope(env);
	const container = document.createElement("div");
	const host = vdom.runtime.createHost(document, container, vdom.runtime.make(scope, "Probe", {})).mount();
	container
		.querySelector(".pad")
		.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 20, shiftKey: true }));
	assert.deepEqual(host.logs, [[10, 20, true]]);
});

test("hosts: a headless host runs tasks without a document", (env) => {
	const { runtime } = env.vdom;
	const host = runtime.createHost(null, null, runtime.make(env.scope, "Counter", { count: 1 })).mount();
	host.send("add", [2]);
	assert.equal(runtime.get(host.root(), "count"), 3);
	assert.equal(host.headless, true);
	assert.deepEqual(host.failures, []);
});

// ---- Testing from the TCD model, through components/pbt (js/pbt.js) -----------
// pbt.tcd's Tally has a seeded bug (add(4) past 8 adds 5); its Lamp breaks for
// good and has a message that's never enabled.

const pbtScope = async ({ vdom, modules }) => {
	const scope = vdom.runtime.scope();
	await vdom.loadComponent(modules.pbt, scope);
	return scope;
};

test("pbt: random walks find a broken ensures and shrink it to the messages that break it", async (env) => {
	const { runtime } = env.vdom;
	const scope = await pbtScope(env);
	const found = walk({ runtime, scope, model: env.models.pbt, component: "Tally", runs: 200, steps: 30, seed: 7 });
	assert.equal(found.ok, false);
	const last = found.trace.at(-1);
	assert.deepEqual([last.name, last.args], ["add", [4]], JSON.stringify(found.trace));
	assert.deepEqual(found.issues[0], { kind: "messageInvalid", message: "add", component: "Tally", issues: ["post"] });
	// Shrunk: it fails, and without any one of its steps it doesn't.
	const run = (trace) => fails({ runtime, scope, model: env.models.pbt, component: "Tally", start: found.start, trace });
	assert.ok(run(found.trace));
	found.trace.forEach((_, i) => assert.ok(!run(found.trace.filter((_, j) => j !== i)), `step ${i} of ${JSON.stringify(found.trace)} can go`));
	// The count was past 8 when add(4) ran.
	let count = found.start.count;
	for (const s of found.trace.slice(0, -1)) count = s.name === "reset" ? 0 : s.name === "inc" ? count + 1 : s.name === "add" ? count + s.args[0] : count;
	assert.ok(count >= 8, `count ${count} before add(4)`);
});

test("pbt: a correct component's walks find nothing", async (env) => {
	const { runtime } = env.vdom;
	const found = walk({ runtime, scope: env.scope, model: env.models.counter, component: "Counter", runs: 30, steps: 20, seed: 3 });
	assert.deepEqual(found, { ok: true, runs: 30 });
});

test("pbt: exhaustive exploration finds messages never enabled and states where none is", async (env) => {
	const { runtime } = env.vdom;
	const scope = await pbtScope(env);
	const found = exhaust({ runtime, scope, model: env.models.pbt, component: "Lamp", start: { mode: "off", parts: [] } });
	assert.equal(found.states, 3);
	assert.deepEqual(found.neverEnabled, ["repair"]);
	assert.deepEqual(found.deadlocks, [{ $: "Lamp", mode: "broken", parts: [] }]);
	assert.deepEqual(found.issues, []);
});

test("pbt: example blocks run, and say which expect didn't hold", async (env) => {
	const { runtime } = env.vdom;
	const scope = await pbtScope(env);
	assert.deepEqual(examples({ runtime, scope, model: env.models.pbt }), [
		{ name: "adds", ok: true, failures: [] },
		{ name: "wrong_on_purpose", ok: false, failures: ["expected count == 4"] },
	]);
	assert.deepEqual(
		examples({ runtime, scope: env.scope, model: env.models.counter }).map((e) => e.ok),
		[true],
	);
});

// ---- Hosts: what they listen to, and how long a run takes ------------------

test("hosts listen to the events the types in their scope tree handle, the drag events with drop", async ({ vdom, document, container, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.showcase, scope);
	const listened = [];
	const add = container.addEventListener.bind(container);
	container.addEventListener = (type, ...rest) => {
		listened.push(type);
		add(type, ...rest);
	};
	// The root, a Note, handles nothing; Shelf, registered next to it, does.
	const host = runtime.createHost(document, container, runtime.make(scope, "Note", { text: "x" })).mount();
	assert.deepEqual(listened, ["click", "drop", "dragstart", "dragend", "dragenter", "dragover", "dragleave"]);
	// Types loaded later, in a child scope too, once the host runs again: only the new events.
	await vdom.loadComponent(modules.counter, runtime.enter(scope, "inner"));
	host.send("nope");
	assert.deepEqual(listened.slice(7), ["input"]);
});

test("hosts run tasks for up to 16ms, render, and run the rest on the next tick", async (env) => {
	const { window, container } = env;
	const { host } = mountRoot(env, "Board", { counters: [], total: 0 });
	for (let i = 0; i < 3; i++) click(window, buttons(container, "add")[0]);
	click(window, buttons(container, "+")[0]);
	assert.deepEqual(counts(container), ["1", "1", "2"]);
	// A clock that moves 10ms each time it's read: resetAll runs, then the
	// first counter's reset, and the run is past 16ms.
	const now = Date.now;
	let t = 0;
	Date.now = () => (t += 10);
	try {
		click(window, buttons(container, "reset all")[0]);
	} finally {
		Date.now = now;
	}
	assert.deepEqual(counts(container), ["0", "1", "2"]);
	await host.settled();
	assert.deepEqual(counts(container), ["0", "0", "0"]);
	assert.deepEqual(host.failures, []);
});

// ---- CSS: the classes loaded modules' views use, compiled ------------------

test("classes: loading a module reports the constant classes of the types it registers", async ({ vdom, modules }) => {
	const scope = vdom.runtime.scope();
	const counter = await vdom.loadComponent(modules.counter, scope);
	for (const c of ["counter", "card", "btn", "btn-ghost", "input", "tabular-nums", "italic"]) assert.ok(counter.classes.includes(c), c);
	assert.ok(!counter.classes.includes("todos"));
	assert.equal(new Set(counter.classes).size, counter.classes.length);
	// Both branches of an if: done or not.
	const item = await vdom.loadComponent(modules.todo_item, scope);
	for (const c of ["todo", "done", "list-row", "opacity-60", "checkbox", "line-through"]) assert.ok(item.classes.includes(c), c);
	assert.ok(!item.classes.includes("counter"));
});

test("classes: classStyles compiles the whole set again only when it grows", async ({ vdom, modules }) => {
	const scope = vdom.runtime.scope();
	const compiled = [];
	const style = { textContent: "" };
	const styles = classStyles((classes) => {
		compiled.push([...classes]);
		return [...classes].join(",");
	}, style, ["page  shell"]);
	assert.deepEqual(compiled, [["page", "shell"]]);
	assert.equal(styles.add((await vdom.loadComponent(modules.counter, scope)).classes), true);
	assert.equal(compiled.length, 2);
	// Nothing new: no compile.
	assert.equal(styles.add(["btn", "card"]), false);
	assert.equal(compiled.length, 2);
	assert.equal(styles.add((await vdom.loadComponent(modules.todo_list, scope)).classes), true);
	assert.equal(compiled.length, 3);
	const all = compiled.at(-1);
	for (const c of ["page", "counter", "todos", "join"]) assert.ok(all.includes(c), c);
	assert.equal(style.textContent, all.join(","));
});

test("css: margaui-css compiles the collected classes, ignoring unknown ones", async ({ vdom, modules }) => {
	const css = await loadCssCompiler(modules.margaui);
	const base = css([]);
	const out = css(["btn", "zzz-not-a-class"]);
	assert.ok(out.length > base.length);
	assert.ok(out.includes(".btn"));
	assert.ok(!out.includes("zzz-not-a-class"));
	const { classes } = await vdom.loadComponent(modules.todo_item, vdom.runtime.scope());
	const items = css(classes);
	for (const rule of [".checkbox", ".list-row", ".line-through"]) assert.ok(items.includes(rule), rule);
});

// ---- Component modules: loading them at run time --------------------------

// A module whose tutuca_abi_version returns 99, and nothing else.
const OTHER_ABI = new Uint8Array([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version
	0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, // types: () -> i32
	0x03, 0x02, 0x01, 0x00, // functions: one of type 0
	0x07, 0x16, 0x01, 0x12, ...[..."tutuca_abi_version"].map((c) => c.charCodeAt(0)), 0x00, 0x00, // exports
	0x0a, 0x07, 0x01, 0x05, 0x00, 0x41, 0xe3, 0x00, 0x0b, // code: i32.const 99
]);

test("modules: a component module registers its types in the scope it's loaded into", async ({ vdom, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	assert.throws(() => runtime.make(scope, "Counter"), /No component type is registered as Counter/);
	const loaded = await vdom.loadComponent(modules.counter, scope);
	assert.equal(runtime.typeName(runtime.make(scope, "Counter", { count: 1 })), "Counter");
	assert.deepEqual(loaded.exports.sort(), ["tutuca_abi_version", "tutuca_register"]);
	assert.deepEqual([...new Set(loaded.imports.map((i) => i.module))].filter((m) => m !== "'").sort(), ["tutuca", "wasm:js-string"].filter((m) => loaded.imports.some((i) => i.module === m)));
	assert.ok(loaded.imports.some((i) => i.module === "tutuca" && i.name === "scope_register"));
	assert.equal(loaded.size, modules.counter.byteLength);
});

test("modules: types from different modules compose through the scope, once both are loaded", async ({ vdom, window, document, container, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.todo_list, scope);
	const host = runtime.createHost(document, container, runtime.make(scope, "TodoList", {})).mount();
	typeDraft(window, container, "milk");
	click(window, buttons(container, "add")[0]);
	// TodoList makes a TodoItem by name: no module registered one yet.
	assert.equal(host.failures.length, 1);
	assert.ok(/Can't make a component of type TodoItem/.test(host.failures[0].message), host.failures[0].message);
	assert.deepEqual(todoTexts(container), []);
	// The failed task committed nothing, so the draft is still there.
	await vdom.loadComponent(modules.todo_item, scope);
	click(window, buttons(container, "add")[0]);
	assert.deepEqual(todoTexts(container), ["milk"]);
	toggle(window, container.querySelector("li"));
	assert.equal(footerText(container), "0 of 1 left");
	assert.equal(host.failures.length, 1);
});

// todo_card's TodoItem: the same interface as todo_item's, another layout.
const cardTexts = (container) => [...container.querySelectorAll(".todo-card-text")].map((s) => s.textContent);
const cards = (container) => [...container.querySelectorAll("li.todo-card")];
const cardButton = (li, cls) => li.querySelector(`.todo-card-actions button.${cls}`);

test("modules: TodoList works with another implementation of TodoItem's interface", async ({ vdom, window, document, container, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.todo_list, scope);
	await vdom.loadComponent(modules.todo_card, scope);
	const host = runtime.createHost(document, container, runtime.make(scope, "TodoList", {})).mount();
	addTodos({ window, container }, "milk", "a", "eggs");
	assert.deepEqual(cardTexts(container), ["milk", "a", "eggs"]);
	assert.deepEqual([...container.querySelectorAll(".todo-card-meta")].map((s) => s.textContent), ["4 chars · #0", "1 char · #1", "4 chars · #2"]);
	assert.equal(container.querySelectorAll("input[type=checkbox]").length, 0);
	// Its own toggle button instead of a checkbox; the list counts it the same.
	const first = cards(container)[0];
	click(window, cardButton(first, "done-toggle"));
	assert.equal(marks(first, "todo-card", "done"), "todo-card done");
	assert.equal(cardButton(first, "done-toggle").textContent, "✓ done");
	assert.equal(cardButton(first, "done-toggle").title, "mark as to do");
	assert.equal(footerText(container), "2 of 3 left");
	// A star the list knows nothing about.
	click(window, cardButton(cards(container)[1], "star"));
	assert.equal(marks(cardButton(cards(container)[1], "star"), "star", "on"), "star on");
	const items = runtime.get(host.root(), "items");
	assert.deepEqual(items.map((c) => runtime.get(c, "starred")), [false, true, false]);
	// The rest of the interface: removeMe, setDone, done.
	click(window, cardButton(cards(container)[2], "remove"));
	assert.deepEqual(cardTexts(container), ["milk", "a"]);
	click(window, buttons(container, "all done")[0]);
	assert.equal(footerText(container), "0 of 2 left");
	click(window, buttons(container, "clear done")[0]);
	assert.deepEqual(cardTexts(container), []);
	assert.deepEqual(host.failures, []);
});

test("modules: another implementation loaded later takes the name over for the items made after", async ({ vdom, window, document, container, modules }) => {
	const { runtime } = vdom;
	const scope = runtime.scope();
	await vdom.loadComponent(modules.todo_list, scope);
	await vdom.loadComponent(modules.todo_item, scope);
	runtime.createHost(document, container, runtime.make(scope, "TodoList", {})).mount();
	addTodos({ window, container }, "checkbox");
	await vdom.loadComponent(modules.todo_card, scope);
	addTodos({ window, container }, "card");
	// One list, two implementations of its items.
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => marks(li, "todo", "todo-card", "done")), ["todo", "todo-card"]);
	click(window, buttons(container, "all done")[0]);
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => marks(li, "todo", "todo-card", "done")), ["todo done", "todo-card done"]);
	assert.equal(footerText(container), "0 of 2 left");
});

test("modules: the loader takes only modules that import the ABI, of the runtime's version", async ({ vdom, modules }) => {
	const scope = vdom.runtime.scope();
	// The runtime itself imports the DOM and the host.
	await assert.rejects(vdom.loadComponent(modules.runtime, scope), /imports only from tutuca, wasm:js-string and ', not from dom, env, host/);
	await assert.rejects(vdom.loadComponent(OTHER_ABI, scope), /for ABI version 99, the runtime's is 3/);
});

// What every case gets besides its DOM, from the runtime vdom and bytesOf,
// which reads a module of dist/ by its path without .wasm: a scope the
// component modules are loaded into, and the modules' bytes, the runtime's
// as runtime.
export async function prepare(vdom, bytesOf, textOf) {
	const scope = vdom.runtime.scope();
	const modules = { runtime: await bytesOf("tutuca-rt") };
	for (const name of MODULES) {
		modules[name] = await bytesOf(`components/${name}`);
		await vdom.loadComponent(modules[name], scope);
	}
	for (const name of OWN_SCOPE_MODULES) modules[name] = await bytesOf(`components/${name}`);
	// The CSS compiler, vendored next to dist/.
	modules.margaui = await bytesOf("../vendor/margaui/margaui-css");
	const models = {};
	for (const name of TCD_MODULES) models[name] = JSON.parse(await textOf(`components/${name}.model.json`));
	return { scope, modules, models };
}

// Runs every case against a fresh container, resolving with one result per
// case: { name, ok, error }. shared is what prepare made.
export async function run({ vdom, window }, shared) {
	const results = [];
	for (const { name, fn } of cases) {
		const document = window.document;
		const container = document.createElement("div");
		try {
			await fn({ vdom, window, document, container, ...shared });
			results.push({ name, ok: true });
		} catch (error) {
			results.push({ name, ok: false, error: `${error.message}\n${error.stack ?? ""}` });
		}
	}
	return results;
}

// Differential tests against tutuca's own runtime (../src), in jsdom:
//
// - the vdom: random vnode trees with keys, fragments, attrs and namespaces;
// - the metadata comments: random frames, against JSON.stringify(toMeta());
// - lowering: random semantic trees, against a lowering made of the
//   runtime's own pieces (wrapMeta, Frame.toMeta, view.js's loop fragments).
//
// Trees are rendered as a sequence by both sides. After every render the two
// containers must hold the same markup, and the render must have caused the
// same DOM mutations, so the port patches with the same operations, not just
// to the same result.
import test from "node:test";
import { JSDOM } from "jsdom";
import { wrapMeta } from "../../src/meta.js";
import { Frame } from "../../src/paths.js";
import { Shape, VComment, VFragment, VNode, VText, render as jsRender } from "../../src/vdom.js";
import { load } from "../js/tutuca-rt.js";
import * as assert from "./assert.mjs";

const vdom = await load();

// mulberry32: a small seeded PRNG, so a failure names its seed.
const prng = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TAGS = ["div", "p", "span", "li", "svg", "g"];
const ATTRS = { class: ["a", "b"], title: ["t", "u"], "data-k": [true, false, "x"], hidden: [true, false] };
const KEYS = ["a", "b", "c", "d", "e"];

// A tree as plain data, built into each implementation's vnodes below.
function genChilds(rand, depth) {
	const n = Math.floor(rand() * (depth > 2 ? 2 : 5));
	const keys = [...KEYS].sort(() => rand() - 0.5);
	const out = [];
	for (let i = 0; i < n; i++) {
		const key = rand() < 0.5 ? keys.pop() : undefined;
		const r = rand();
		if (r < 0.3) out.push({ t: "text", s: String(Math.floor(rand() * 3)) });
		else if (r < 0.45) out.push({ t: "frag", key, childs: genChilds(rand, depth + 1) });
		else {
			const attrs = {};
			for (const [name, values] of Object.entries(ATTRS)) {
				if (rand() < 0.4) attrs[name] = values[Math.floor(rand() * values.length)];
			}
			const tag = TAGS[Math.floor(rand() * TAGS.length)];
			out.push({ t: "el", tag, attrs, key, childs: genChilds(rand, depth + 1) });
		}
	}
	return out;
}

const jsShapes = new Map();
const toJs = (node) => {
	if (node.t === "text") return new VText(node.s);
	if (node.t === "frag") return new VFragment(node.childs.map(toJs), node.key);
	const names = Object.keys(node.attrs);
	const id = JSON.stringify([node.tag, names]);
	if (!jsShapes.has(id)) jsShapes.set(id, new Shape(node.tag, null, {}, names));
	return new VNode(jsShapes.get(id), Object.values(node.attrs), node.childs.map(toJs), node.key);
};

const toWasm = (node) => {
	if (node.t === "text") return vdom.text(node.s);
	if (node.t === "frag") return vdom.frag(node.childs.map(toWasm), node.key);
	return vdom.h(node.tag, { ...node.attrs, key: node.key }, node.childs.map(toWasm));
};

// What a mutation did, by node and data rather than identity.
const describe = (r) => [
	r.type,
	r.target.nodeName,
	r.attributeName,
	r.type === "characterData" ? r.target.data : null,
	[...r.addedNodes].map((n) => n.nodeName),
	[...r.removedNodes].map((n) => n.nodeName),
];

const watch = (window, node) => {
	const observer = new window.MutationObserver(() => {});
	observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
	return () => {
		const records = observer.takeRecords().map(describe);
		observer.disconnect();
		return records;
	};
};

const SEEDS = 300;
const STEPS = 5;

test(`renders like tutuca's vdom, step by step (${SEEDS} seeds x ${STEPS} renders)`, () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const rand = prng(seed);
		const { window } = new JSDOM("");
		const { document } = window;
		const jsContainer = document.createElement("div");
		const wasmContainer = document.createElement("div");
		let jsPrev;
		let wasmPrev = null;
		for (let step = 0; step < STEPS; step++) {
			const tree = genChilds(rand, 0);
			const jsDone = watch(window, jsContainer);
			const jsChilds = tree.map(toJs);
			jsRender(document, jsContainer, jsChilds, jsPrev);
			jsPrev = jsChilds;
			const jsRecords = jsDone();
			const wasmDone = watch(window, wasmContainer);
			wasmPrev = vdom.render(document, wasmContainer, tree.map(toWasm), wasmPrev);
			const wasmRecords = wasmDone();
			const where = `seed ${seed}, step ${step}:`;
			assert.equal(wasmContainer.innerHTML, jsContainer.innerHTML, where);
			assert.deepEqual(wasmRecords, jsRecords, `${where} mutations`);
		}
	}
});

// ---- the semantic tree: metadata comments and lowering --------------------

// Strings that JSON.stringify escapes, or that look like they might need it.
const UNITS = ['"', "\\", "\n", "\t", "\b", "\f", "\r", "\u0001", "\u001f", "\u007f", "é", "§", "😀", "\ud800", "\udc00", "a", "Z", "/", "<", " "];
const randomString = (rand) => {
	let s = "";
	const n = Math.floor(rand() * 6);
	for (let i = 0; i < n; i++) s += UNITS[Math.floor(rand() * UNITS.length)];
	return s;
};
const randomKey = (rand) => (rand() < 0.4 ? Math.floor(rand() * 1000) : randomString(rand));
const randomFrame = (rand) => {
	const keys = Array.from({ length: Math.floor(rand() * 3) }, () => randomKey(rand));
	const item = rand() < 0.5 ? randomKey(rand) : null;
	const provider =
		rand() < 0.3
			? { name: randomString(rand), depth: Math.floor(rand() * 5), keys: Array.from({ length: Math.floor(rand() * 3) }, () => randomKey(rand)) }
			: null;
	return { keys, item, provider };
};
const jsFrame = (f) => new Frame(f.keys, f.item, f.provider);
const waxFrame = (f) => vdom.sem.frame(f);

test("metadata comments are JSON.stringify of the runtime's meta objects (2000 frames)", () => {
	const rand = prng(7);
	for (let i = 0; i < 2000; i++) {
		const f = randomFrame(rand);
		assert.equal(vdom.sem.frameMeta(waxFrame(f)), `§${JSON.stringify(jsFrame(f).toMeta())}§`, JSON.stringify(f));
	}
});

// Random semantic trees, lowered by tutuca's runtime pieces (wrapMeta,
// Frame.toMeta, the loop fragments of view.js) and by the wax lowering, then
// rendered by each side's vdom.
const TEMPLATES = [
	{ tid: 1, tag: "div", names: ["class"] },
	{ tid: 2, tag: "button", staticAttrs: { type: "button" }, names: ["title"], handlers: [{ event: "click", name: "go" }] },
	{ tid: 3, tag: "li", names: [] },
	{ tid: 4, tag: "svg", names: ["width"] },
];
const VALUES = { class: ["a", "b"], title: ["t", "u"], width: ["1", "2"] };

// keys is the sibling key scope: wrappers (components, frames) splice their
// children into it, so they share it; elements, groups and loop items start
// their own.
function genSem(rand, depth, keys = [...KEYS].sort(() => rand() - 0.5)) {
	const n = Math.floor(rand() * (depth > 2 ? 2 : 4));
	const out = [];
	for (let i = 0; i < n; i++) {
		const r = rand();
		const key = () => (rand() < 0.5 ? keys.pop() : undefined);
		if (r < 0.2) out.push({ t: "text", s: String(Math.floor(rand() * 3)) });
		else if (r < 0.25) out.push({ t: "comment", s: randomString(rand) });
		else if (r < 0.35) out.push({ t: "group", key: key(), childs: genSem(rand, depth + 1) });
		else if (r < 0.45) out.push({ t: "component", name: "C", childs: genSem(rand, depth + 1, keys) });
		else if (r < 0.55) out.push({ t: "enter", frame: randomFrame(rand), childs: genSem(rand, depth + 1, keys) });
		else if (r < 0.7) {
			const itemKeys = [...KEYS].sort(() => rand() - 0.5).slice(0, Math.floor(rand() * 4));
			out.push({
				t: "items",
				entries: itemKeys.map((k, j) => ({ key: k, frame: { keys: ["xs"], item: j }, body: genSem(rand, depth + 1) })),
			});
		} else {
			const tmpl = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
			const values = tmpl.names.map((name) => VALUES[name][Math.floor(rand() * 2)]);
			out.push({ t: "el", tmpl, values, key: key(), childs: genSem(rand, depth + 1) });
		}
	}
	return out;
}

// Templates are made once per run on each side, as a component type's are.
const jsTemplates = new Map();
const jsShapeOf = (tmpl) => {
	if (!jsTemplates.has(tmpl.tid)) {
		const staticAttrs = { ...tmpl.staticAttrs };
		if (tmpl.handlers) staticAttrs["data-eid"] = tmpl.tid;
		jsTemplates.set(tmpl.tid, new Shape(tmpl.tag, null, staticAttrs, tmpl.names));
	}
	return jsTemplates.get(tmpl.tid);
};
const waxTemplates = new Map();
const waxTemplateOf = (tmpl) => {
	if (!waxTemplates.has(tmpl.tid)) waxTemplates.set(tmpl.tid, vdom.sem.template(tmpl.tid, tmpl.tag, tmpl));
	return waxTemplates.get(tmpl.tid);
};

const jsLower = (n) => {
	switch (n.t) {
		case "text":
			return [new VText(n.s)];
		case "comment":
			return [new VComment(n.s)];
		case "group":
			return [new VFragment(n.childs.flatMap(jsLower), n.key)];
		case "el":
			return [new VNode(jsShapeOf(n.tmpl), n.values, n.childs.flatMap(jsLower), n.key)];
		case "component":
			return wrapMeta({ t: "component" }, n.childs.flatMap(jsLower)).flat();
		case "enter":
			return wrapMeta(jsFrame(n.frame).toMeta(), n.childs.flatMap(jsLower)).flat();
		case "items":
			return [
				new VFragment(
					n.entries.map(
						(e) => new VFragment(wrapMeta(jsFrame(e.frame).toMeta(), e.body.flatMap(jsLower)).flat(), e.key),
					),
				),
			];
	}
};

const toSem = (n) => {
	const { sem } = vdom;
	switch (n.t) {
		case "text":
			return sem.text(n.s);
		case "comment":
			return sem.comment(n.s);
		case "group":
			return sem.group(n.childs.map(toSem), n.key);
		case "el":
			return sem.el(waxTemplateOf(n.tmpl), n.values, n.childs.map(toSem), n.key);
		case "component":
			return sem.component(n.name, n.childs.map(toSem));
		case "enter":
			return sem.enter(waxFrame(n.frame), n.childs.map(toSem));
		case "items":
			return sem.items(n.entries.map((e) => ({ key: e.key, frame: waxFrame(e.frame), body: e.body.map(toSem) })));
	}
};

test(`lowers like tutuca's runtime, step by step (${SEEDS} seeds x ${STEPS} renders)`, () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const rand = prng(seed * 31);
		const { window } = new JSDOM("");
		const { document } = window;
		const jsContainer = document.createElement("div");
		const waxContainer = document.createElement("div");
		let jsPrev;
		let waxPrev = null;
		for (let step = 0; step < STEPS; step++) {
			const tree = genSem(rand, 0);
			const jsDone = watch(window, jsContainer);
			const jsChilds = tree.flatMap(jsLower);
			jsRender(document, jsContainer, jsChilds, jsPrev);
			jsPrev = jsChilds;
			const jsRecords = jsDone();
			const waxDone = watch(window, waxContainer);
			waxPrev = vdom.sem.render(document, waxContainer, tree.map(toSem), waxPrev);
			const waxRecords = waxDone();
			const where = `seed ${seed}, step ${step}:`;
			assert.equal(waxContainer.innerHTML, jsContainer.innerHTML, where);
			assert.deepEqual(waxRecords, jsRecords, `${where} mutations`);
		}
	}
});

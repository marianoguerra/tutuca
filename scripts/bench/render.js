// The render cache benchmark (docs/render-cache.md), shared by its two runners: Node on jsdom
// (scripts/bench-render.js) and a browser page on a real DOM (scripts/bench/render.html). Each
// shape starts a host and applies the same updates with NullCache, WeakMapCache and CopyCache,
// timing the whole update (render + morph) and a render alone (renderView, no DOM). With a gc
// (node --expose-gc, or Chrome's --js-flags=--expose-gc) it also says how much heap each cache
// holds after them, every state the updates went through still alive, as an undo history would
// keep them. And it times DepsWalker's pass alone: what a two-pass cache (walk the tree for the
// provided values it reads, then render keyed by them) adds to a cached render, and a first
// render: the root rendered and all its DOM made.
import { renderView } from "../../src/core/view/view.js";
import { DepsWalker } from "../../src/tutuca.dev.js";
import {
	$if,
	CopyCache,
	component,
	field,
	Host,
	h,
	NullCache,
	provided,
	RenderContext,
	render,
	renderEach,
	t,
	WeakMapCache,
} from "../../src/tutuca.js";

// A row with some substance: a few elements, attrs and texts.
const row = (...extra) =>
	h(
		"li",
		{ class: "row", "data-n": field("n") },
		h("span", { class: "label" }, field("label")),
		h("span", { class: "n" }, field("n")),
		h("button", { type: "button" }, "edit"),
		...extra,
	);
const Item = component({
	name: "Item",
	fields: { n: t.number(), label: t.string() },
	view: row(),
});
const ThemedItem = component({
	name: "ThemedItem",
	fields: { n: t.number(), label: t.string() },
	view: row(h("em", {}, provided("tick"))),
});
const List = component({
	name: "List",
	fields: { items: t.array(), tick: t.number() },
	provides: { tick: "tick" },
	view: h("ul", {}, renderEach(field("items"))),
});
const TreeNode = component({
	name: "TreeNode",
	fields: { n: t.number(), kids: t.array() },
	view: h("div", { class: "node" }, h("b", {}, field("n")), renderEach(field("kids"))),
});
const Tree = component({
	name: "Tree",
	fields: { top: t.component("TreeNode") },
	view: h("section", {}, render(field("top"))),
});
const Tabs = component({
	name: "Tabs",
	fields: { a: t.component("List"), b: t.component("List"), onA: t.boolean() },
	view: h("main", {}, $if(field("onA"), render(field("a")), render(field("b")))),
});
const specs = { Item, ThemedItem, List, TreeNode, Tree, Tabs };

const items = (C, Comp, SIZE) =>
	Array.from({ length: SIZE }, (_, n) => C[Comp]({ n, label: `item ${n}` }));
const tree = (C, depth, counter = { n: 0 }) =>
	C.TreeNode({
		n: counter.n++,
		kids: depth === 0 ? [] : [tree(C, depth - 1, counter), tree(C, depth - 1, counter)],
	});
const depthFor = (size) => Math.max(1, Math.round(Math.log2(size + 1)) - 1);
const leafPath = (r, i) => {
	let node = r.top;
	for (let bit = 0; node.kids.length > 0; bit++) node = node.kids[(i >> bit) & 1];
	return node;
};

const shapes = (SIZE) => [
	{
		name: `list of ${SIZE}, one item edited`,
		start: (C) => C.List({ items: items(C, "Item", SIZE), tick: 0 }),
		update: (r, i) => {
			r.items[(i * 7919) % SIZE].n += 1;
		},
	},
	{
		name: `tree of ${2 ** (depthFor(SIZE) + 1) - 1}, one leaf edited`,
		start: (C) => C.Tree({ top: tree(C, depthFor(SIZE)) }),
		update: (r, i) => {
			leafPath(r, i).n += 1;
		},
	},
	{
		name: `list of ${SIZE} reading a provided value, one item edited`,
		start: (C) => C.List({ items: items(C, "ThemedItem", SIZE), tick: 0 }),
		update: (r, i) => {
			r.items[(i * 7919) % SIZE].n += 1;
		},
	},
	{
		name: `two tabs of ${SIZE} items, switched every update`,
		start: (C) =>
			C.Tabs({
				a: C.List({ items: items(C, "Item", SIZE), tick: 0 }),
				b: C.List({ items: items(C, "Item", SIZE), tick: 0 }),
				onA: true,
			}),
		update: (r) => {
			r.onA = !r.onA;
		},
	},
	{
		name: `worst case: list of ${SIZE} reading a provided value that changes every update`,
		start: (C) => C.List({ items: items(C, "ThemedItem", SIZE), tick: 0 }),
		update: (r) => {
			r.tick += 1;
		},
	},
];

// Mean ms per call of fn over each of xs, timed as one run: a browser's clock moves in steps of
// 0.1 ms or more, too coarse to time a cached render one at a time.
const meanTime = (xs, fn) => {
	const t0 = performance.now();
	for (const x of xs) fn(x);
	return (performance.now() - t0) / xs.length;
};

// The roots an update sequence goes through, made once so every cache renders the same states.
const rootsFor = (shape, updates) => {
	const host = new Host();
	host.scope.register(specs);
	host.start(shape.start(host.scope.components));
	const roots = [host.root];
	for (let i = 0; i < updates; i++) {
		host.applyChange((r) => shape.update(r, i));
		roots.push(host.root);
	}
	return roots;
};
const CACHES = {
	none: () => new NullCache(),
	weakmap: () => new WeakMapCache(),
	copy: () => new CopyCache(),
};
// The heap in use after a full gc, or null without one.
const heapUsed = () => {
	if (typeof globalThis.gc !== "function") return null;
	globalThis.gc();
	return globalThis.process?.memoryUsage().heapUsed ?? performance.memory?.usedJSHeapSize ?? null;
};
// Mean ms of an update, rendered and morphed into a fresh root from mount() with a cache from
// make, and the heap its cache holds after them (null without a gc).
const hostUpdates = (roots, make, mount) => {
	const { document, rootNode, unmount } = mount();
	const host = new Host({ document, rootNode, renderCache: make() });
	host.start(roots[0]);
	const update = meanTime(roots.slice(1), (r) => {
		host.root = r;
		host.render();
	});
	// What dropping the cache frees: the heap with it, less the heap without it.
	const withCache = heapUsed();
	host.renderCache = null;
	const without = heapUsed();
	unmount();
	return { time: update, held: withCache === null ? null : withCache - without };
};
// Mean ms of a first render: the root rendered and its DOM made, in a fresh root from mount().
const MOUNTS = 5;
const mountTime = (root, mount) =>
	meanTime(Array.from({ length: MOUNTS }), () => {
		const { document, rootNode, unmount } = mount();
		new Host({ document, rootNode }).start(root);
		unmount();
	});
// Mean ms of a render alone (no DOM), with a cache from make.
const renderOnly = (roots, make) => {
	const cache = make();
	const renderOne = (r) => {
		cache.begin();
		const vdom = renderView(r, RenderContext.root(r, { cache }));
		cache.end(r, null, vdom);
	};
	renderOne(roots[0]);
	return meanTime(roots.slice(1), renderOne);
};
const walkOnly = (roots) => meanTime(roots.slice(1), (r) => DepsWalker.depsOf(r));

const ms = (x) => `${x.toFixed(3)} ms`.padStart(10);
const mb = (x) => (x === null ? "" : `${(x / 2 ** 20).toFixed(1)} MB`.padStart(9));
// Runs every shape, mount() giving each host { document, rootNode, unmount }, log(line) getting
// the report; returns the results as data: [{ shape, caches: { name: { update, render, held } },
// walk, mount }]. Awaits between shapes, so a page can show its progress.
export const runBench = async ({ size = 2000, updates = 40, mount, log = () => {} }) => {
	const results = [];
	log(`render cache benchmark: ${updates} updates per shape, mean per update\n`);
	if (heapUsed() === null) log("(no gc exposed: no heap numbers)\n");
	for (const shape of shapes(size)) {
		const roots = rootsFor(shape, updates);
		// Warm up the JIT on each path before measuring.
		for (let i = 0; i < 2; i++) {
			for (const make of Object.values(CACHES)) {
				hostUpdates(roots, make, mount);
				renderOnly(roots, make);
			}
			walkOnly(roots);
			mountTime(roots[0], mount);
		}
		log(shape.name);
		log("             update     render  cache heap");
		const caches = {};
		for (const [name, make] of Object.entries(CACHES)) {
			const { time: update, held } = hostUpdates(roots, make, mount);
			const render = renderOnly(roots, make);
			caches[name] = { update, render, held };
			const speedup = name === "none" ? "" : `   ${(caches.none.update / update).toFixed(1)}x`;
			log(`  ${name.padEnd(8)} ${ms(update)} ${ms(render)} ${mb(held)}${speedup}`);
		}
		const walk = walkOnly(roots);
		log(`  DepsWalker pass ${ms(walk)}`);
		const mounted = mountTime(roots[0], mount);
		log(`  first render    ${ms(mounted)}`);
		log("");
		results.push({ shape: shape.name, caches, walk, mount: mounted });
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return results;
};

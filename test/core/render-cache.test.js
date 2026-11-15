// The render caches (src/core/view/render-cache.js): a component renders again only when its
// instance, its place or a provided value read anywhere below it changed. Every scenario runs
// with WeakMapCache and CopyCache, counting what renders, and with each in a CheckCache, where
// each render is also compared to an uncached one and its recorded deps to DepsWalker's
// (console.assert throws while these run; the uncached render counts too, so counts aren't
// checked there).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CheckCache, DepsWalker } from "../../src/tutuca.dev.js";
import {
	$if,
	CopyCache,
	component,
	field,
	h,
	provided,
	pushView,
	render,
	renderEach,
	send,
	t,
	ViewNode,
	WeakMapCache,
} from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const realAssert = console.assert;
before(() => {
	console.assert = (ok, message, ...rest) => {
		if (!ok) throw new Error(`${message} ${JSON.stringify(rest)}`);
	};
});
after(() => {
	console.assert = realAssert;
});

// A node that counts its evaluations: how many times the view it's in rendered.
class Count extends ViewNode {
	constructor(counts, name) {
		super();
		this.counts = counts;
		this.name = name;
	}
	eval() {
		this.counts[this.name] = (this.counts[this.name] ?? 0) + 1;
		return null;
	}
}

const CACHES = {
	weakmap: () => new WeakMapCache(),
	copy: () => new CopyCache(),
	"check:weakmap": () => new CheckCache(new WeakMapCache()),
	"check:copy": () => new CheckCache(new CopyCache()),
};
// test(name, fn) for each cache, fn getting setup and expectCounts for it; only uses lists the
// caches it runs with, by name.
const cacheTest = (name, fn, only = Object.keys(CACHES)) => {
	for (const cacheName of only) {
		const checked = cacheName.startsWith("check:");
		test(`${name} (${cacheName})`, () =>
			fn({
				cacheName,
				setup: (specs, root) => setup(CACHES[cacheName](), specs, root),
				expectCounts: (actual, expected) => {
					if (!checked) assert.deepEqual(actual, expected);
				},
			}));
	}
};
const setup = (renderCache, specs, root) => {
	const s = setupHost(specs, { sync: true, renderCache });
	s.host.start(root(s.C));
	return { ...s, change: (fn) => s.host.applyChange(fn), text: () => s.rootNode.textContent };
};

const specs = (counts, { middleProvides = false } = {}) => ({
	Leaf: component({
		name: "Leaf",
		fields: { label: t.string() },
		view: h("span", {}, new Count(counts, "leaf"), field("label"), ":", provided("theme")),
	}),
	Middle: component({
		name: "Middle",
		fields: { leaf: t.component("Leaf"), theme: t.string() },
		provides: middleProvides ? { theme: (pb) => pb.field("theme") } : {},
		view: h("div", {}, new Count(counts, "middle"), render(field("leaf"))),
	}),
	Root: component({
		name: "Root",
		fields: { middle: t.component("Middle"), theme: t.string(), other: t.number() },
		provides: { theme: (pb) => pb.field("theme") },
		view: h("main", {}, new Count(counts, "root"), render(field("middle"))),
	}),
});
const tree = (C, { theme = "dark", middleTheme = "inner" } = {}) =>
	C.Root({ theme, middle: C.Middle({ theme: middleTheme, leaf: C.Leaf({ label: "x" }) }) });

cacheTest("an unchanged subtree isn't rendered again", ({ setup, expectCounts }) => {
	const counts = {};
	const { change, text } = setup(specs(counts), (C) => tree(C));
	assert.equal(text(), "x:dark");
	change((r) => {
		r.other = 1;
	});
	expectCounts(counts, { root: 2, middle: 1, leaf: 1 });
	assert.equal(text(), "x:dark");
});

cacheTest(
	"a provided value read by a grandchild under an unchanged middle renders again",
	({ setup, expectCounts }) => {
		const counts = {};
		const { change, text } = setup(specs(counts), (C) => tree(C));
		change((r) => {
			r.theme = "light";
		});
		assert.equal(text(), "x:light");
		// The middle's instance didn't change, but its leaf reads theme: both render again.
		expectCounts(counts, { root: 2, middle: 2, leaf: 2 });
	},
);

cacheTest(
	"a name the middle provides itself hides the root's changes from its subtree",
	({ setup, expectCounts }) => {
		const counts = {};
		const { change, text } = setup(specs(counts, { middleProvides: true }), (C) => tree(C));
		assert.equal(text(), "x:inner");
		change((r) => {
			r.theme = "light";
		});
		assert.equal(text(), "x:inner");
		expectCounts(counts, { root: 2, middle: 1, leaf: 1 });
		change((r) => {
			r.middle.theme = "other";
		});
		assert.equal(text(), "x:other");
		expectCounts(counts, { root: 3, middle: 2, leaf: 2 });
	},
);

cacheTest(
	"the same instance moved from where nothing is provided to where it is renders again",
	({ setup }) => {
		const counts = {};
		const Leaf = specs(counts).Leaf;
		const Plain = component({
			name: "Plain",
			fields: { leaves: t.array() },
			view: h("p", {}, renderEach(field("leaves"))),
		});
		const Themed = component({
			name: "Themed",
			fields: { leaves: t.array() },
			provides: { theme: (pb) => pb.field("tone") },
			methods: {
				get tone() {
					return "warm";
				},
			},
			view: h("p", {}, renderEach(field("leaves"))),
		});
		const Root = component({
			name: "Root",
			fields: { plain: t.component("Plain"), themed: t.component("Themed") },
			view: h("main", {}, render(field("plain")), render(field("themed"))),
		});
		const leaf = (C) => C.Leaf({ label: "x" });
		const { change, text, host } = setup({ Leaf, Plain, Themed, Root }, (C) =>
			C.Root({ plain: C.Plain({ leaves: [leaf(C)] }), themed: C.Themed({ leaves: [] }) }),
		);
		assert.equal(text(), "x:");
		const moved = host.root.plain.leaves[0];
		change((r) => {
			r.themed.leaves.push(r.plain.leaves.pop());
		});
		assert.equal(host.root.themed.leaves[0], moved);
		assert.equal(text(), "x:warm");
	},
);

cacheTest(
	"a pushed view below an unchanged middle switches the leaf's view",
	({ setup, expectCounts }) => {
		const counts = {};
		const Leaf = component({
			name: "Leaf",
			views: { main: h("span", {}, "main"), alt: h("span", {}, "alt") },
		});
		const Middle = component({
			name: "Middle",
			fields: { leaf: t.component("Leaf") },
			view: h("div", {}, new Count(counts, "middle"), render(field("leaf"))),
		});
		const Root = component({
			name: "Root",
			fields: { middle: t.component("Middle"), mode: t.string() },
			view: h("main", {}, pushView(field("mode"), render(field("middle")))),
		});
		const { change, text } = setup({ Leaf, Middle, Root }, (C) =>
			C.Root({ mode: "main", middle: C.Middle({ leaf: C.Leaf() }) }),
		);
		assert.equal(text(), "main");
		change((r) => {
			r.mode = "alt";
		});
		assert.equal(text(), "alt");
		expectCounts(counts.middle, 2);
	},
);

cacheTest("a list renders only the item that changed", ({ setup, expectCounts }) => {
	const counts = {};
	const Item = component({
		name: "Item",
		fields: { n: t.number() },
		view: h("li", {}, new Count(counts, "item"), field("n")),
	});
	const List = component({
		name: "List",
		fields: { items: t.array() },
		view: h("ul", {}, renderEach(field("items"))),
	});
	const { change, text } = setup({ Item, List }, (C) =>
		C.List({ items: [1, 2, 3, 4].map((n) => C.Item({ n })) }),
	);
	expectCounts(counts.item, 4);
	change((r) => {
		r.items[2].n = 30;
	});
	assert.equal(text(), "12304");
	expectCounts(counts.item, 5);
	change((r) => {
		r.items.reverse();
	});
	assert.equal(text(), "43021");
	expectCounts(counts.item, 5);
});

// A tree of TreeNodes depth levels deep, each counting its renders.
const treeSpecs = (counts) => ({
	TreeNode: component({
		name: "TreeNode",
		fields: { n: t.number(), kids: t.array() },
		view: h("div", {}, new Count(counts, "node"), field("n"), renderEach(field("kids"))),
	}),
});
const makeTree = (C, depth) =>
	C.TreeNode({ n: 0, kids: depth === 0 ? [] : [makeTree(C, depth - 1), makeTree(C, depth - 1)] });
const leafAt = (node, path) => path.reduce((n, i) => n.kids[i], node);

cacheTest("edits in two leaves render only each one's path", ({ setup, expectCounts }) => {
	const counts = {};
	const { change } = setup(treeSpecs(counts), (C) => makeTree(C, 3));
	expectCounts(counts, { node: 15 });
	change((r) => {
		leafAt(r, [0, 0, 0]).n = 1;
	});
	expectCounts(counts, { node: 19 });
	// A CopyCache keeps the entries under the hits of the last render: the other half's.
	change((r) => {
		leafAt(r, [1, 1, 1]).n = 1;
	});
	expectCounts(counts, { node: 23 });
});

cacheTest("a tab switched away and back", ({ cacheName, setup, expectCounts }) => {
	const counts = {};
	const Tab = component({
		name: "Tab",
		fields: { name: t.string() },
		view: h("section", {}, new Count(counts, "tab"), field("name")),
	});
	const Tabs = component({
		name: "Tabs",
		fields: { a: t.component("Tab"), b: t.component("Tab"), onA: t.boolean() },
		view: h("main", {}, $if(field("onA"), render(field("a")), render(field("b")))),
	});
	const { change, text } = setup({ Tab, Tabs }, (C) =>
		C.Tabs({ a: C.Tab({ name: "a" }), b: C.Tab({ name: "b" }), onA: true }),
	);
	const toggle = (r) => {
		r.onA = !r.onA;
	};
	change(toggle);
	change(toggle);
	assert.equal(text(), "a");
	// WeakMapCache keeps a's render while a lives; CopyCache keeps only the last render's.
	expectCounts(counts, { tab: cacheName === "weakmap" ? 2 : 3 });
});

cacheTest(
	"a CopyCache keeps only what the last render reached",
	({ setup }) => {
		const counts = {};
		const Item = component({
			name: "Item",
			fields: { n: t.number() },
			view: h("li", {}, new Count(counts, "item"), field("n")),
		});
		const List = component({
			name: "List",
			fields: { items: t.array() },
			view: h("ul", {}, renderEach(field("items"))),
		});
		const { change, host } = setup({ Item, List }, (C) =>
			C.List({ items: [1, 2, 3].map((n) => C.Item({ n })) }),
		);
		const removed = host.root.items[1];
		change((r) => {
			r.items.splice(1, 1);
		});
		const kept = [];
		const walk = (children) => {
			for (const [instance, had] of children.byInstance) {
				kept.push(instance);
				for (const e of [had].flat()) if (e.children !== null) walk(e.children);
			}
		};
		const cache = host.renderCache.inner ?? host.renderCache;
		walk(cache.tree);
		assert.equal(kept.length, 3); // The list and its two items.
		assert.ok(!kept.includes(removed));
	},
	["copy", "check:copy"],
);

test("DepsWalker finds the provided names a subtree reads, less the ones it provides", () => {
	const counts = {};
	const s = setupHost(specs(counts), { sync: true });
	const root = tree(s.C);
	assert.deepEqual(
		DepsWalker.depsOf(root).map(([name]) => name),
		[],
	);
	const middleDeps = [];
	DepsWalker.depsOf(root, {
		onComponent(instance, _view, _ctx, deps) {
			if (instance === root.middle) middleDeps.push(...deps.map(([name]) => name));
		},
	});
	assert.deepEqual(middleDeps, ["theme"]);
	// The walker renders nothing.
	assert.deepEqual(counts, {});
});

// A Group that provides its items to the Panel inside it, which renders them: every frame inside
// the Group is relative to it, so it renders the same wherever it is.
const movingSpecs = (counts) => ({
	Item: component({
		name: "Item",
		fields: { n: t.number() },
		view: h("button", { "on:click": send("inc") }, new Count(counts, "item"), field("n")),
		on: {
			inc(next) {
				next.n++;
			},
		},
	}),
	Panel: component({
		name: "Panel",
		view: h("div", {}, new Count(counts, "panel"), renderEach(provided("items"))),
	}),
	Group: component({
		name: "Group",
		fields: { items: t.array(), panel: t.component("Panel") },
		provides: { items: (pb) => pb.field("items") },
		view: h("section", {}, render(field("panel"))),
	}),
	Wrap: component({
		name: "Wrap",
		fields: { groups: t.array() },
		view: h("div", {}, renderEach(field("groups"))),
	}),
	Root: component({
		name: "Root",
		fields: { groups: t.array(), wrap: t.component("Wrap") },
		view: h("main", {}, renderEach(field("groups")), render(field("wrap"))),
	}),
});

cacheTest(
	"a subtree moved a level deeper renders what it rendered, and its events still arrive",
	({ cacheName, setup, expectCounts }) => {
		const counts = {};
		const { change, text, host, rootNode, click } = setup(movingSpecs(counts), (C) =>
			C.Root({
				groups: [C.Group({ items: [C.Item({ n: 1 }), C.Item({ n: 2 })], panel: C.Panel() })],
				wrap: C.Wrap({ groups: [] }),
			}),
		);
		assert.equal(text(), "12");
		change((r) => {
			r.wrap.groups.push(r.groups.pop());
		});
		assert.equal(text(), "12");
		// WeakMapCache finds the Group's render at its new depth; CopyCache only looks under the
		// same parent.
		expectCounts(counts, cacheName === "weakmap" ? { panel: 1, item: 2 } : { panel: 2, item: 4 });
		click(rootNode.querySelectorAll("button")[1]);
		assert.equal(host.root.wrap.groups[0].items[1].n, 3);
		assert.equal(text(), "13");
	},
);

cacheTest(
	"a provided value read farther from its provider than before renders again",
	({ setup, expectCounts }) => {
		const counts = {};
		const Leaf = specs(counts).Leaf;
		const Wrap = component({
			name: "Wrap",
			fields: { leaves: t.array() },
			view: h("div", {}, renderEach(field("leaves"))),
		});
		const Root = component({
			name: "Root",
			fields: { leaves: t.array(), wrap: t.component("Wrap"), theme: t.string() },
			provides: { theme: (pb) => pb.field("theme") },
			view: h("main", {}, renderEach(field("leaves")), render(field("wrap"))),
		});
		const { change, text } = setup({ Leaf, Wrap, Root }, (C) =>
			C.Root({ theme: "dark", leaves: [C.Leaf({ label: "x" })], wrap: C.Wrap({ leaves: [] }) }),
		);
		assert.equal(text(), "x:dark");
		change((r) => {
			r.wrap.leaves.push(r.leaves.pop());
		});
		assert.equal(text(), "x:dark");
		expectCounts(counts, { leaf: 2 });
	},
);

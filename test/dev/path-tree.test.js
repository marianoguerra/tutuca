import assert from "node:assert/strict";
import test from "node:test";
import { appScope, makeApp } from "../../components/tutuca-dev/path-tree-app.js";
import { pathOfMarkers } from "../../src/core/host/events.js";
import { isMarkerOpen, MARKER_CLOSE, parseMarker } from "../../src/core/view/markers.js";
import { RenderContext, renderView } from "../../src/core/view/view.js";
import { expand, pathTree, stepsOf } from "../../src/dev/path-tree.js";
import { pathTreeText } from "../../src/dev/path-tree-text.js";
import { DispatchPath, Frame } from "../../src/tutuca.js";
import { toVChildren, VComment } from "../../src/vdom/index.js";

const app = (todos = 4) => makeApp(appScope().components, { todos });
const docsSidebar = new DispatchPath([Frame.node("pages", "docs"), Frame.node("sidebar")]);

test("with no path every step is active and walked, items past siblings collapse", () => {
	assert.equal(
		pathTreeText(pathTree(app(), { siblings: 2 })),
		`● · App
├─● .header Title
├─● .pages[.current="docs"] Page
│  ├─● .title Title
│  └─● .sidebar Sidebar
│     ├─● .search Search
│     └─● *theme ^2.theme Theme
├─● each .todos |open (3/4)
│  ├─● [0] Todo
│  │  └─● each .tags (1)
│  │     └─● [0] Tag
│  ├─● [2] Todo
│  │  └─● each .tags (1)
│  │     └─● [0] Tag
│  └─○ … 1 more
└─● each .todos (4)
   ├─● [0]
   │  └─● it Todo:row
   ├─● [1]
   │  └─● it Todo:row
   └─○ … 2 more`,
	);
});

test("a path's steps are active, the ones it doesn't take are listed inactive and unwalked", () => {
	assert.equal(
		pathTreeText(pathTree(app(), { path: docsSidebar })),
		`● · App
├─○ .header Title
├─● .pages[.current="docs"] Page
│  ├─○ .title Title
│  └─◆ .sidebar Sidebar
│     ├─○ .search Search
│     └─○ *theme ^2.theme Theme
├─○ each .todos |open (4) ▸
└─○ each .todos (4) ▸`,
	);
});

test("a path through a loop item keeps it past siblings and elides the rest", () => {
	const path = new DispatchPath([new Frame(["todos"], 3, null, true), Frame.node("tags", 0)]);
	const text = pathTreeText(pathTree(app(6), { path, siblings: 1 }));
	assert.match(text, /├─● \[3\] Todo\n│ {2}│ {2}└─● each \.tags \(1\)\n│ {2}│ {5}└─◆ \[0\] Tag/);
	assert.match(text, /└─○ … 3 more/);
});

test("expand walks an inactive step, its steps inactive too", () => {
	const tree = pathTree(app(), { path: docsSidebar });
	const loop = tree.children.find((s) => s.step.t === "each" && s.step.loop === "open");
	assert.equal(loop.children, null);
	const items = expand(loop);
	assert.deepEqual(
		items.map((s) => [s.step.key, s.spec, s.active]),
		[
			[0, "Todo", false],
			[2, "Todo", false],
			[3, "Todo", false],
		],
	);
	assert.equal(loop.step.kept, 3);
	assert.equal(expand(items[0]).length, 1);
});

// The DispatchPath of each component a real render wraps, as events read it from markers.
const renderedPaths = (root) => {
	const paths = [];
	const stack = [];
	const visit = (nodes) => {
		for (const n of nodes) {
			if (n instanceof VComment) {
				if (n.text === MARKER_CLOSE) stack.pop();
				else if (isMarkerOpen(n.text)) {
					const marker = parseMarker(n.text);
					stack.push(marker);
					if (marker.t === "component") paths.push(String(pathOfMarkers([...stack].reverse())));
				}
			} else if (n.children) visit(n.children);
		}
	};
	visit(toVChildren(renderView(root, RenderContext.root(root))));
	return paths;
};

test("each component step's path is the one a render's markers give it", () => {
	const root = app();
	const walked = [...stepsOf(pathTree(root, { siblings: Infinity }))]
		.filter((s) => s.spec !== null)
		.map((s) => String(s.path));
	assert.deepEqual(walked.toSorted(), renderedPaths(root).toSorted());
});

test("a step is active exactly when the path starts with its path", () => {
	const path = new DispatchPath([Frame.node("pages", "docs"), Frame.node("title")]);
	for (const step of stepsOf(pathTree(app(), { path }))) {
		if (step.step.t === "more" || step.step.t === "each") continue;
		assert.equal(step.active, path.startsWith(step.path), String(step.path));
	}
});

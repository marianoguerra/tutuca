import { lint } from "../../src/lint/index.js";
import {
	devComponents,
	devNode,
	lintRecords,
	makeDevPanel,
} from "../../src/panels/ui/dev-panel.js";
import { makePathTree, pathTreeComponents } from "../../src/panels/ui/path-tree.js";
import { book, step } from "../../src/storybook/index.js";
import {
	Address,
	apply,
	DispatchPath,
	Frame,
	Scope,
	Target,
	Task,
	Transition,
} from "../../src/tutuca.js";
import { fromJson, jsonComponents } from "../json/index.js";
import { todoComponents } from "../todo/index.js";
import { appScope, makeApp } from "./path-tree-app.js";

// Values to inspect, made in a scope of their own like an app's.
const app = new Scope();
app.register(jsonComponents);
const doc = fromJson(app.components, [[1, true], "two"]);
const path = new DispatchPath([new Frame(["items"], 1, null, true)]);
const task = new Task("toggle", [], new Address(path, 1), new Target(path), null);
const specs = Object.values(jsonComponents);

// An app whose render takes every kind of path step, for the path tree.
const pathApp = makeApp(appScope().components, { todos: 12 });
const docsSidebar = new DispatchPath([Frame.node("pages", "docs"), Frame.node("sidebar")]);
const todoTags = new DispatchPath([new Frame(["todos"], 5, null, true), Frame.node("tags", 0)]);
const stepTo =
	(...rows) =>
	(b) =>
		rows.reduce((sel, i) => sel.item("rows", i), b.field("tree"));
const rowsOf = (s, ...rows) => rows.reduce((step, i) => step.rows[i], s.tree);

const opened = (node) => node.isOpen && node.rows.length > 0;

export default book({
	title: "Dev",
	components: { ...devComponents, ...pathTreeComponents },
	stories: {
		"Node/Component instance": {
			make: (C) => devNode(C, "root", doc),
			sequences: {
				"open the instance, then an item": [
					step.send("toggle"),
					step.check(
						"shows the fields (items, open) and spec",
						(s) => opened(s) && s.rows.length === 4,
					),
					step.send("toggle", [], { to: (b) => b.item("rows", 0) }),
					step.check("the items array opens", (s) => opened(s.rows[0])),
					step.send("toggle", [], { to: (b) => b.item("rows", 0).item("rows", 0) }),
					step.check("an item opens", (s) => opened(s.rows[0].rows[0])),
					step.send("toggle"),
					step.check("closing keeps the rows", (s) => !s.isOpen && s.rows.length === 4),
				],
			},
			stress: { maxCommands: 8 },
		},
		"Node/Component spec": {
			make: (C) => devNode(C, "", todoComponents.TodoTask),
			sequences: {
				"open the spec and a view": [
					step.send("toggle"),
					step.check("fields, views and sections", (s) => s.rows.length > 5),
					step.check("a view reads as code", (s) =>
						s.rows.some((r) => r.label === "view main" && r.tokens[0].text === "h"),
					),
					step.check("and in words", (s) =>
						s.rows.some((r) => r.label === "view main" && r.title === "<div> element"),
					),
					step.check("so do field types", (s) =>
						s.rows.some(
							(r) =>
								r.label === "priority" &&
								r.title === "one of 4, 1, 2, 3" &&
								r.detail === "default 4",
						),
					),
				],
			},
		},
		"Node/Path": {
			make: (C) => devNode(C, "path", path),
			sequences: { words: [step.check("items → 1", (s) => s.detail === "items → 1")] },
		},
		"Node/Task": {
			make: (C) => devNode(C, "task", task),
			sequences: { words: [step.check("a message", (s) => s.title === "message “toggle”")] },
		},
		"Node/Primitives": {
			make: (C) =>
				C.DevSection({
					title: "Primitives",
					nodes: [
						devNode(C, "string", "hello"),
						devNode(C, "number", 42),
						devNode(C, "bool", true),
						devNode(C, "null", null),
						devNode(C, "array", [1, 2, 3]),
						devNode(C, "set", new Set(["a", "b"])),
					],
				}),
		},
		"Path tree/Focused": {
			make: (C) => makePathTree(C, pathApp, { path: docsSidebar }),
			sequences: {
				"open a step off the path, then focus one": [
					step.check("the loops are closed", (s) => !rowsOf(s, 2).isOpen && rowsOf(s, 2).canOpen),
					step.send("toggle", [], { to: stepTo(2) }),
					step.check("the loop lists its items", (s) => rowsOf(s, 2).rows.length === 9),
					step.check("inactive", (s) => rowsOf(s, 2, 0).mark === "inactive"),
					step.send("focus", [], { to: stepTo(0) }),
					step.check("the header is the focus", (s) => s.focusText === ".header"),
					step.check("and the path's last step", (s) => rowsOf(s, 0).mark === "last"),
					step.send("clearFocus"),
					step.check(
						"no focus: every step active",
						(s) => s.focusText === "" && rowsOf(s, 2).mark === "active",
					),
				],
			},
		},
		"Path tree/Loop item": {
			make: (C) => makePathTree(C, pathApp, { path: todoTags, siblings: 2 }),
			sequences: {
				"the focused item stays past siblings": [
					step.check(
						"two items, the focused one and … more",
						(s) =>
							rowsOf(s, 2)
								.rows.map((r) => r.parts.map((p) => p.text).join(""))
								.join(" ") === "[0] [2] [5] … 8 more",
					),
					step.check("its tag is the last step", (s) => rowsOf(s, 2, 2, 0, 0).mark === "last"),
				],
			},
		},
		"Path tree/Whole tree": {
			make: (C) => makePathTree(C, pathApp, { siblings: 3 }),
			sequences: {
				"everything active": [
					step.check("no focus", (s) => s.focusText === "" && rowsOf(s, 1).isOpen),
				],
			},
		},
		"Lint/Clean": { make: (C) => C.DevLint() },
		"Lint/Issues": {
			make: (C) => C.DevLint({ issues: lintRecords(lint(specs)) }),
		},
		"Panel/JSON app": {
			make: (C) => {
				const issues = lint(specs, Object.keys(jsonComponents));
				const transitions = [{ label: "", value: Transition.of(task, "handled") }];
				const data = { state: doc, transitions, specs, issues };
				return apply(makeDevPanel(C), "showApp", data);
			},
			sequences: {
				"switch to code and back": [
					step.check("readable", (s) => s.view === "main"),
					step.event("click", "button:nth-of-type(2)"),
					step.check("code", (s) => s.view === "code"),
					step.send("setView", ["main"]),
				],
			},
		},
	},
});

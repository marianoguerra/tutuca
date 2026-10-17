import { lint } from "../../src/lint/index.js";
import { step, stories } from "../../src/storybook/index.js";
import { DispatchPath, Frame, Scope, Target, Task } from "../../src/tutuca.js";
import { fromJson, jsonComponents } from "../json/index.js";
import { todoComponents } from "../todo/index.js";
import { devComponents, devNode, lintRecords, makeDevPanel, updateDevPanel } from "./index.js";

// Values to inspect, made in a scope of their own like an app's.
const app = new Scope(() => {});
app.register(jsonComponents);
const doc = fromJson(app.components, [[1, true], "two"]);
const path = new DispatchPath([new Frame(["items"], 1, null, true)]);
const task = new Task("toggle", [], path, new Target(path), null);
const specs = Object.values(jsonComponents);

const opened = (node) => node.isOpen && node.rows.length > 0;

export default stories({
	title: "Dev",
	components: devComponents,
	stories: {
		"Node/Component instance": {
			make: (C) => devNode(C, "root", doc),
			sequences: {
				"open the instance, then an item": [
					step.send("toggle"),
					step.check("shows the fields and spec", (s) => opened(s) && s.rows.length === 3),
					step.send("toggle", [], { at: (b) => b.item("rows", 0) }),
					step.check("the items array opens", (s) => opened(s.rows[0])),
					step.send("toggle", [], { at: (b) => b.item("rows", 0).item("rows", 0) }),
					step.check("an item opens", (s) => opened(s.rows[0].rows[0])),
					step.send("toggle"),
					step.check("closing keeps the rows", (s) => !s.isOpen && s.rows.length === 3),
				],
			},
			pbt: { maxCommands: 8 },
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
								r.label === "nextSubId" &&
								r.title === "whole number" &&
								r.detail === "at least 1, default 1",
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
		"Lint/Clean": { make: (C) => C.DevLint() },
		"Lint/Issues": {
			make: (C) => C.DevLint({ issues: lintRecords(lint(specs)) }),
		},
		"Panel/JSON app": {
			make: (C) => {
				const panel = makeDevPanel(C);
				const issues = lint(specs, Object.keys(jsonComponents));
				const data = { state: doc, tasks: [{ label: "", value: task }], specs, issues };
				const sections = Object.fromEntries(
					["state", "tasks", "specs", "lint"].map((k) => [k, { ...panel[k] }]),
				);
				updateDevPanel(C, sections, data);
				return C.DevPanel({
					state: C.DevSection(sections.state),
					tasks: C.DevSection(sections.tasks),
					specs: C.DevSection(sections.specs),
					lint: C.DevLint(sections.lint),
				});
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

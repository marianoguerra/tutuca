import { step, stories } from "../../src/storybook/index.js";
import { langComponents, sample } from "./index.js";

const editor =
	(notation, mode = "view") =>
	(C) =>
		C.Editor({ mode, notation, program: sample(C) });
const outputIs = (expected) => (s) => s.output === expected;

export default stories({
	title: "Lang",
	components: langComponents,
	stories: {
		"Editor/Lisp": {
			make: editor("lisp"),
			sequences: {
				"switch notations": [
					step.event("click", '[data-notation="forth"]'),
					step.check("Forth", (s) => s.viewName === "viewForth"),
					step.event("click", '[data-mode="edit"]'),
					step.check("editing Forth", (s) => s.viewName === "editForth"),
					step.event("click", '[data-notation="python"]'),
					step.check("editing Python", (s) => s.viewName === "editPython"),
				],
			},
		},
		"Editor/Python": { make: editor("python") },
		"Editor/JavaScript": { make: editor("js") },
		"Editor/Forth": { make: editor("forth") },
		"Editor/Edit": {
			make: editor("python", "edit"),
			sequences: {
				"edit a number": [
					step.check("ADA!", outputIs('"ADA!"')),
					step.event("input", '[aria-label="number"]', { value: "2" }),
					step.check("total is too small, so max(2, 3)", outputIs('"3"')),
				],
				"clear the result and fill it again": [
					step.event("click", 'pre > div > div:last-child > span > button[title="Clear"]'),
					step.check("an empty hole", outputIs("Error: the program has an empty hole")),
					step.event("click", '[aria-label="Pick a node"]'),
					step.event("click", '[data-kind="Num"]'),
					step.check("a zero", outputIs("0")),
				],
				"add a statement": [
					step.send("add", [], { at: (b) => b.field("program") }),
					step.check("its value is a hole", (s) => s.isError),
				],
			},
			pbt: { events: true, maxCommands: 10 },
		},
		"Editor/Empty": { make: (C) => C.Editor({ mode: "edit" }) },
	},
});

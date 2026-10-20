import { step, stories } from "../../src/storybook/index.js";
import { specOf } from "../../src/tutuca.js";
import { NOW } from "../thing-tracker/fixtures.js";
import { compositionComponents, notebook } from "./index.js";

// The component names of the cells' contents, in order.
const names = (s) => s.order.map((key) => specOf(s.entries[key].content).name);
const cells = (s) => s.order.map((key) => s.entries[key]);
// The n-th cell's header, the n-th gap before a cell, and the last gap.
const cellHeader = (n) => `:scope > div > div:nth-of-type(${n}) header`;
const gapBefore = (n) => `:scope > div > div:nth-of-type(${n}) > div:first-child`;
const lastGap = ":scope > div > div:last-child";
const ALL = ["notes", "todos", "kanban", "drawing", "tracker", "notebook"];

export default stories({
	title: "Composition",
	components: compositionComponents,
	stories: {
		"Notebook/New": {
			make: (C) => notebook(C, { now: NOW }),
			sequences: {
				"a picker becomes notes": [
					step.event("click", '[data-choice="notes"]'),
					step.check("notes", (s) => names(s).join() === "Notes"),
				],
				"a tracker asks which things first": [
					step.event("click", '[data-choice="tracker"]'),
					step.check("still picking", (s) => names(s).join() === "Picker"),
					step.event("click", '[data-choice="group:mood/mood"]'),
					step.check("a tracker of moods", (s) => cells(s)[0].content.section.title === "Mood"),
					step.event("click", '[aria-label^="Log Calm"]'),
					step.check("logged", (s) => cells(s)[0].content.things.some((t) => t.total === 1)),
				],
				"a notebook inside the notebook": [
					step.event("click", '[data-choice="notebook"]'),
					step.event("click", '[data-choice="kanban"]'),
					step.check("a board in the inner notebook", (s) => {
						const inner = cells(s)[0].content;
						return names(inner).join() === "Board" && names(s).join() === "Notebook";
					}),
				],
				"add one before, one after, then remove the first": [
					step.event("click", '[data-choice="kanban"]'),
					step.event("click", '[title="Add a cell here"]'),
					step.event("click", '[title="Add a cell at the end"]'),
					step.check("pickers around the board", (s) => names(s).join() === "Picker,Board,Picker"),
					step.event("click", '[title="Remove this cell"]'),
					step.check("first gone", (s) => names(s).join() === "Board,Picker"),
				],
			},
			pbt: { events: true, maxCommands: 10 },
		},
		"Notebook/One of each": {
			make: (C) => notebook(C, { kinds: ALL, now: NOW }),
			sequences: {
				"drag the first cell to the end": [
					step.drag(cellHeader(1), lastGap),
					step.check("notes last", (s) => names(s).at(-1) === "Notes"),
				],
				"drag the last cell before the second": [
					step.drag(cellHeader(6), gapBefore(2)),
					step.check("notebook second", (s) => names(s)[1] === "Notebook"),
				],
				"collapse one, then ctrl+click to expand every cell": [
					step.event("click", '[title^="Collapse or expand"]'),
					step.check("first collapsed", (s) => cells(s)[0].collapsed && !cells(s)[1].collapsed),
					step.check("only the first", (s) => cells(s).filter((c) => c.collapsed).length === 1),
				],
			},
		},
	},
});

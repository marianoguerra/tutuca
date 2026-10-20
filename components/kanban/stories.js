import { step, stories } from "../../src/storybook/index.js";
import { kanbanComponents } from "./index.js";

const COLUMNS = [
	["To do", ["Write the drag and drop docs", "Port the touch support", "Try the kanban demo"]],
	["Doing", ["Review the event routing"]],
	["Done", []],
];
// A board with the columns above; card ids are c<column><position>.
export const sampleBoard = (C) =>
	C.Board({
		columns: COLUMNS.map(([title, cards], i) =>
			C.Column({
				title,
				cards: cards.map((cardTitle, j) => C.Card({ id: `c${i}${j}`, title: cardTitle })),
			}),
		),
	});

const titles = (s, column) => s.columns[column].cards.map((card) => card.title);
const card = (column, n) =>
	`.grid > :nth-child(${column}) [data-dragtype="card"]:nth-of-type(${n})`;
const column = (n) => `.grid > :nth-child(${n})`;

export default stories({
	title: "Kanban",
	components: kanbanComponents,
	stories: {
		"Board/Week": {
			make: sampleBoard,
			sequences: {
				"move a card to the next column": [
					step.drag(card(1, 1), column(2)),
					step.check("left To do", (s) => titles(s, 0).length === 2),
					step.check(
						"at the end of Doing",
						(s) => titles(s, 1)[1] === "Write the drag and drop docs",
					),
				],
				"drop a card on another one": [
					step.drag(card(1, 3), card(2, 1)),
					step.check(
						"above it, with no position",
						(s) => titles(s, 1)[0] === "Try the kanban demo",
					),
				],
				"move a card to an empty column": [
					step.drag(card(2, 1), column(3)),
					step.check("in Done", (s) => titles(s, 2)[0] === "Review the event routing"),
				],
				"move a card to the end of its own column": [
					step.drag(card(1, 1), column(1)),
					step.check("last now", (s) => titles(s, 0)[2] === "Write the drag and drop docs"),
				],
				"add, then remove a card": [
					step.event("input", `${column(3)} input`, { value: "Ship it" }),
					step.event("submit", `${column(3)} form`),
					step.check("added", (s) => titles(s, 2)[0] === "Ship it"),
					step.event("click", `${column(3)} button[title="Remove"]`),
					step.check("removed", (s) => titles(s, 2).length === 0),
				],
			},
		},
		"Board/DOM events": { make: sampleBoard, pbt: { events: true, maxCommands: 15 } },
		"Board/Empty": {
			make: (C) => C.Board({ columns: COLUMNS.map(([title]) => C.Column({ title })) }),
		},
	},
});

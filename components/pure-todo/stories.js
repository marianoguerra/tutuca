import { book, step } from "../../src/storybook/index.js";
import { pureTodoComponents } from "./index.js";

export default book({
	title: "Pure-js handlers",
	components: pureTodoComponents,
	stories: {
		"Todo list/Empty": {
			make: (C) => C.PureTodoList(),
			sequences: {
				"add two, finish one, remove one": [
					step.event("input", "input", { value: "Buy milk" }),
					step.event("click", "button"),
					step.event("input", "input", { value: "  Write docs " }),
					step.event("click", "button"),
					step.check(
						"two, trimmed",
						(s) => s.items.length === 2 && s.items[1].title === "Write docs",
					),
					step.event("change", '[type="checkbox"]'),
					step.check("one left", (s) => s.left === 1 && s.items[0].done),
					step.event("click", "li button"),
					step.check("one item", (s) => s.items.length === 1 && s.items[0].title === "Write docs"),
				],
				"nothing to add": [
					step.event("input", "input", { value: "   " }),
					step.event("click", "button"),
					step.check("still empty", (s) => s.items.length === 0),
				],
			},
		},
		"Todo list/A few items": {
			make: (C) =>
				C.PureTodoList({
					items: [
						{ title: "Read the guide", done: true },
						{ title: "Edit this example", done: false },
					],
				}),
		},
	},
});

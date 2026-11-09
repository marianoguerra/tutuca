import { book, step } from "../../src/storybook/index.js";
import { components, jsonViewArgs, listOf } from "./index.js";

const order = {
	id: "o-1042",
	customer: { name: "Ada", email: "ada@example.com" },
	items: [
		{ sku: "pen", qty: 2, price: 1.5 },
		{ sku: "pad", qty: 1, price: 4 },
	],
	paid: true,
	note: null,
};

const people = Array.from({ length: 12 }, (_, i) => ({
	name: `Person ${i + 1}`,
	age: 20 + ((i * 7) % 30),
	active: i % 3 !== 0,
}));

export default book({
	title: "Data views",
	components,
	stories: {
		"JsonView/Tree": {
			make: (C) => C.JsonView(jsonViewArgs(order, { label: "Order" })),
			sequences: {
				"switch to raw": [
					step.event("click", "button.join-item:nth-child(2)"),
					step.check("raw", (s) => s.mode === "raw" && !s.showTree),
				],
				"fold the root": [
					step.event("click", "div.font-mono > div"),
					step.check("folded", (s) => s.collapsed.includes("") && s.treeRows.length === 1),
				],
			},
		},
		"JsonView/Editable": {
			make: (C) => C.JsonView(jsonViewArgs(order, { label: "Order", mode: "raw", editable: true })),
			sequences: {
				"broken JSON shows an error": [
					step.event("input", "textarea", { value: "{" }),
					step.check("error", (s) => s.hasError),
				],
			},
		},
		"JsonView/Plain text": {
			make: (C) => C.JsonView(jsonViewArgs("not JSON, just text", { json: false })),
		},
		"DataTable/People": {
			make: (C) => C.DataTable({ id: "people", kind: "table", rows: people, pageSize: 5 }),
			sequences: {
				"next page": [
					step.send("page_next"),
					step.check("second page", (s) => s.page === 1 && s.pagedRows[0].name === "Person 6"),
				],
			},
		},
		"List/Views": {
			make: (C) =>
				listOf(
					C,
					"views",
					[C.JsonView(jsonViewArgs({ a: 1 })), C.JsonView(jsonViewArgs([1, 2, 3]))],
					{ addLabel: "view" },
				),
		},
	},
});

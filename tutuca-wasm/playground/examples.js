// The playground's examples: pure-tutuca component modules, with what each needs to show (the
// modules it composes with, loaded before it) and the root to mount. Fields are JSON;
// { "$make": Type, "fields": {...} } makes a component and { "$json": value } the
// components/json tree of a JSON value.

const CLICKER = `// Your own component: edit it, compile (Ctrl/Cmd-Enter), and it shows on the right.
import { button, div, field, send, span } from "tutuca/view";

/** A counter that remembers its best. */
export type Clicker = { count: number; best: number };

export const Clicker = {
	defaults: { count: 0, best: 0 },
	constraints: { count: { int: true, min: 0 }, best: { int: true, min: 0 } },
	invariants: {
		bestSoFar(): boolean {
			return this.best >= this.count;
		},
	},
	on: {
		click: {
			pure: true,
			changes: ["count", "best"],
			post(prev, next, []: []) {
				return next.count === prev.count + 1;
			},
			run(next, []: []) {
				next.count = this.count + 1;
				if (next.count > this.best) next.best = next.count;
			},
		},
		reset: {
			pure: true,
			changes: ["count"],
			post(prev, next, []: []) {
				return next.count === 0;
			},
			run(next, []: []) {
				next.count = 0;
			},
		},
	},
	view: div(
		{ class: "flex items-center gap-2" },
		button({ class: "btn btn-sm btn-primary", "on:click": send("click") }, "click"),
		span({ class: "tabular-nums" }, field("count"), " (best ", field("best"), ")"),
		button({ class: "btn btn-sm btn-ghost", "on:click": send("reset") }, "reset"),
	),
	// Test runs these, and random walks of the messages checking the contracts.
	examples: {
		bestStays: {
			start: { count: 0, best: 0 },
			steps: [{ send: "click" }, { send: "click" }, { send: "reset" }, { send: "click" }, { expect: { count: 1, best: 2 } }],
		},
	},
};

export const register = { Clicker: "Clicker" };
`;

// A TodoList holding two TodoItems (whichever module registers TodoItem).
const TODOS = {
	items: [
		{ $make: "TodoItem", fields: { id: 0, text: "write a component", done: true } },
		{ $make: "TodoItem", fields: { id: 1, text: "compile it in the browser", done: false } },
	],
	nextId: 2,
};

const BOOKS = [
	{ title: "Dune", year: 1965, read: true },
	{ title: "Emma", year: 1815, read: false },
	{ title: "Ulysses", year: 1922, read: false },
];

export const EXAMPLES = [
	{
		id: "clicker",
		title: "Your own: a clicker",
		description: "A starting point: a component written here.",
		main: "mine/clicker.tutuca.ts",
		sources: { "mine/clicker.tutuca.ts": CLICKER },
		root: "Clicker",
		fields: { count: 0, best: 0 },
	},
	{
		id: "counter",
		title: "Counter, Label and Board",
		description: "Notifies, asks answered now and later, a swap, sends to children by selector.",
		main: "components/counter/counter.tutuca.ts",
		uses: ["components/meta/meta.tutuca.ts"],
		root: "Board",
		fields: { counters: [], total: 0 },
		asks: { fetchCount: () => new Promise((resolve) => setTimeout(() => resolve(7), 500)) },
	},
	{
		id: "todo_list",
		title: "TodoList",
		description: "Declares the TodoItem interface; composes with the todo_item module.",
		main: "components/todo_list/todo_list.tutuca.ts",
		uses: ["components/meta/meta.tutuca.ts"],
		deps: ["todo_item"],
		root: "TodoList",
		fields: TODOS,
	},
	{
		id: "todo_item",
		title: "TodoItem, a checkbox",
		description:
			"Implements TodoList's interface (imported from todo_list.tutuca.ts); the TodoList module holds it.",
		main: "components/todo_item/todo_item.tutuca.ts",
		uses: ["components/todo_list/todo_list.tutuca.ts", "components/meta/meta.tutuca.ts"],
		deps: ["todo_list"],
		root: "TodoList",
		fields: TODOS,
	},
	{
		id: "todo_card",
		title: "TodoItem, a card",
		description: "Another implementation of the same interface, registered as TodoItem.",
		main: "components/todo_card/todo_card.tutuca.ts",
		uses: ["components/todo_list/todo_list.tutuca.ts", "components/meta/meta.tutuca.ts"],
		deps: ["todo_list"],
		root: "TodoList",
		fields: TODOS,
	},
	{
		id: "showcase",
		title: "Shelf and Note",
		description:
			"Scopes, loop hooks (key, filter, enrich, prepare, iter), provides, pushView, renderIt, drag and drop.",
		main: "components/showcase/showcase.tutuca.ts",
		uses: ["components/meta/meta.tutuca.ts"],
		root: "Shelf",
		fields: {
			books: BOOKS,
			onlyUnread: false,
			tags: ["classic", "novel"],
			current: 1,
			theme: "badge badge-secondary",
			note: { $make: "Note", fields: { text: "pinned" } },
			notes: [
				{ $make: "Note", fields: { text: "drop a book here" } },
				{ $make: "Note", fields: { text: "or here" } },
			],
		},
	},
	{
		id: "json",
		title: "JSON viewer and editor",
		description:
			"Nine types implementing a JsonValue interface; the editor pushes its mode's view.",
		main: "components/json/json.tutuca.ts",
		uses: ["components/meta/meta.tutuca.ts"],
		root: "JsonEditor",
		fields: {
			value: {
				$json: {
					name: "tutuca-wasm",
					version: 1,
					wasm: true,
					tags: ["pure-js", "pure-tutuca"],
					deps: {},
				},
			},
			mode: "edit",
			showText: true,
		},
	},
	{
		id: "layout",
		title: "Layouts and holes",
		description:
			"A Screen toggles between using a layout and editing it (its layoutEdit views); edited, Hbox, Vbox, Tabs and Grid hold Holes, and a hole's + asks what its scope can make and swaps itself for the one picked.",
		main: "components/layout/layout.tutuca.ts",
		uses: ["components/meta/meta.tutuca.ts"],
		// meta's schemas fill in the defaults of what the hole's choices say.
		deps: ["meta", "counter"],
		root: "Screen",
		fields: {
			content: { $make: "Vbox", fields: { items: [{ $make: "Hole", fields: {} }] } },
			editing: true,
		},
	},
];

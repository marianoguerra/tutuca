// TodoItem again, as a card: another component module registering a type as TodoItem, with the
// same interface and a different implementation: buttons instead of a checkbox, the text's length,
// and a star the list knows nothing about. Loaded into a scope where TodoItem is registered
// already, it takes the name over for the items made from then on.
import type { Display } from "../meta/meta.tutuca";
import type { TodoItem } from "../todo_list/todo_list.tutuca";
import { button, div, field, li, send, span, when } from "tutuca/view";

export type TodoCard = {
	id: number;
	text: string;
	done: boolean;
	/** Not part of the interface, so the list never passes it. */
	starred: boolean;
	/** The text's length and the id: "5 chars · #2". */
	readonly meta: string;
};
export interface TodoCardNotifies {
	removeMe(): void;
}

export const TodoCard = {
	implements: ["TodoItem"],
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Todo card",
			icon: "🗒️",
			description: "One thing to do, as a card.",
		},
	},
	defaults: { id: 0, text: "", done: false, starred: false },
	constraints: { id: { int: true, min: 0 } },
	queries: {
		get meta(): string {
			const n = this.text.length;
			return `${n}${n === 1 ? " char · #" : " chars · #"}${this.id}`;
		},
	},
	on: {
		toggle: {
			pure: true,
			changes: ["done"],
			post(prev, next, []: []) {
				return next.done === !prev.done;
			},
			run(next, []: []) {
				next.done = !this.done;
			},
		},
		star: {
			pure: true,
			changes: ["starred"],
			post(prev, next, []: []) {
				return next.starred === !prev.starred;
			},
			run(next, []: []) {
				next.starred = !this.starred;
			},
		},
		setDone: {
			pure: true,
			changes: ["done"],
			post(prev, next, [done]: [boolean]) {
				return next.done === done;
			},
			run(next, [done]: [boolean]) {
				next.done = done;
			},
		},
		remove: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("removeMe", []);
			},
		},
	},
	view: li(
		{
			class: when(
				field("done"),
				"todo-card done card card-border bg-base-200 flex-row items-center justify-between gap-3 p-3 opacity-70",
				"todo-card card card-border bg-base-100 flex-row items-center justify-between gap-3 p-3",
			),
			draggable: "true",
			"data-dragtype": "todo",
		},
		div(
			{ class: "todo-card-main flex flex-col min-w-0" },
			span({ class: "todo-card-text font-semibold break-words" }, field("text")),
			span({ class: "todo-card-meta text-xs opacity-60 tabular-nums" }, field("meta")),
		),
		div(
			{ class: "todo-card-actions flex gap-1 shrink-0" },
			button(
				{
					class: when(
						field("done"),
						"done-toggle on btn btn-xs btn-success rounded-full",
						"done-toggle btn btn-xs btn-outline rounded-full",
					),
					title: when(field("done"), "mark as to do", "mark as done"),
					"on:click": send("toggle"),
				},
				when(field("done"), "✓ done", "○ to do"),
			),
			button(
				{
					class: when(
						field("starred"),
						"star on btn btn-xs btn-ghost text-warning",
						"star btn btn-xs btn-ghost opacity-50",
					),
					title: when(field("starred"), "unstar", "star"),
					"on:click": send("star"),
				},
				when(field("starred"), "★", "☆"),
			),
			button({ class: "remove btn btn-xs btn-ghost text-error", "on:click": send("remove") }, "remove"),
		),
	),
};

export const register = { TodoCard: "TodoItem" };

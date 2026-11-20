// TodoItem, a component module of its own: a todo with a checkbox it handles itself and an x that
// asks its parent to remove it. It implements TodoList's TodoItem interface, so the list can make
// it by that name.
import type { Display } from "../meta/meta.tutuca";
import type { TodoItem as TodoItemInterface } from "../todo_list/todo_list.tutuca";
import { button, field, input, li, send, span, when } from "tutuca/view";

export type TodoItem = { id: number; text: string; done: boolean };
export interface TodoItemNotifies {
	removeMe(): void;
}

export const TodoItem = {
	implements: ["TodoItem"],
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Todo",
			icon: "☑️",
			description: "One thing to do, done or not.",
		},
	},
	defaults: { id: 0, text: "", done: false },
	constraints: { id: { int: true, min: 0 } },
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
		/** Applied by the list: completeAll applies setDone(true) to every item. */
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
		/** The list holds the items, so removing is the list's to do: ask it. */
		remove: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("removeMe", []);
			},
		},
	},
	view: li(
		{
			class: when(field("done"), "todo done list-row items-center opacity-60", "todo list-row items-center"),
			draggable: "true",
			"data-dragtype": "todo",
		},
		input({ type: "checkbox", class: "checkbox checkbox-sm", checked: field("done"), "on:change": send("toggle") }),
		span({ class: when(field("done"), "list-col-grow line-through", "list-col-grow") }, field("text")),
		button({ class: "btn btn-xs btn-ghost", "on:click": send("remove") }, "x"),
	),
};

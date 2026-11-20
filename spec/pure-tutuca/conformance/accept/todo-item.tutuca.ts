// A todo item for todo-items: id, text, done; setDone is pure, removeMe notifies.
import { button, field, input, li, send, span } from "tutuca/view";

export type TodoItem = { id: number; text: string; done: boolean };
export interface TodoItemNotifies {
	removeMe(): void;
}

export const TodoItem = {
	defaults: { id: 0, text: "", done: false },
	constraints: { id: { int: true, min: 0 } },
	on: {
		setDone: {
			pure: true,
			run(next, [done]: [boolean]) {
				next.done = done;
			},
		},
		toggle: {
			run(next) {
				next.done = !this.done;
			},
		},
		removeMe: {
			run(next, [], ctx) {
				ctx.notify("removeMe", []);
			},
		},
	},
	view: li(
		{},
		input({ type: "checkbox", checked: field("done"), "on:change": send("toggle") }),
		span({}, field("id")),
		button({ "on:click": send("removeMe") }, "x"),
	),
};

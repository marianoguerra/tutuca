// A list of child components through an interface: tutuca.apply of a pure message, ctx.make.
import { div, field, renderEach } from "tutuca/view";

export interface TodoItem {
	readonly id: number;
	readonly done: boolean;
	setDone(done: boolean): Pure;
	removeMe(): Notify;
}

export type TodoItems = { items: TodoItem[]; nextId: number; readonly remaining: number };

export const TodoItems = {
	defaults: { items: [], nextId: 0 },
	constraints: { nextId: { int: true, min: 0 } },
	queries: {
		get remaining(): number {
			return this.items.filter((it) => !it.done).length;
		},
	},
	on: {
		completeAll: {
			pure: true,
			run(next) {
				next.items = this.items.map((it) => tutuca.apply(it, "setDone", true));
			},
		},
		add: {
			run(next, [], ctx) {
				next.items.push(ctx.make("TodoItem", { id: this.nextId }));
				next.nextId += 1;
			},
		},
	},
	view: div({}, renderEach(field("items"))),
};

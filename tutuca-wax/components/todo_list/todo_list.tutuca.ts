// TodoList, a component module of its own: it holds TodoItem components in a field and renders
// each in a keyed loop. TodoItem is an interface, declared here and registered with the list:
// any module's component implementing it can be made as TodoItem (todo_item and todo_card do).
import type { Display } from "../meta/meta.tutuca";
import {
	button,
	div,
	field,
	footer,
	input,
	renderEach,
	section,
	send,
	sourceKey,
	dragKey,
	span,
	targetValue,
	ul,
} from "tutuca/view";

/** What TodoList needs of the items it makes by name. */
export interface TodoItem {
	readonly id: number;
	readonly text: string;
	readonly done: boolean;
	/** Pure: the list applies it to the items it holds. */
	setDone(done: boolean): Pure;
	/** To the list, asking to be removed. */
	removeMe(): Notify;
}

export type TodoList = {
	items: TodoItem[];
	draft: string;
	nextId: number;
	readonly remaining: number;
	readonly count: number;
};

export const TodoList = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Todos",
			icon: "✅",
			description: "A list of things to do, added, checked off and removed.",
		},
	},
	defaults: { items: [], draft: "", nextId: 0 },
	constraints: { nextId: { int: true, min: 0 } },
	queries: {
		get remaining(): number {
			return this.items.filter((it) => !it.done).length;
		},
		get count(): number {
			return this.items.length;
		},
	},
	invariants: {
		/** Every item's id is below nextId, so the next one made is new. */
		idsBelowNextId() {
			return this.items.every((it) => it.id < this.nextId);
		},
	},
	on: {
		setDraft: {
			pure: true,
			changes: ["draft"],
			post(prev, next, [text]: [string]) {
				return next.draft === text;
			},
			run(next, [text]: [string]) {
				next.draft = text;
			},
		},
		addTodo: {
			changes: ["items", "draft", "nextId"],
			run(next, [], ctx) {
				// An empty draft adds nothing.
				if (this.draft === "") return;
				next.items.push(ctx.make("TodoItem", { id: this.nextId, text: this.draft, done: false }));
				next.draft = "";
				next.nextId = this.nextId + 1;
			},
		},
		/** Each item changes itself: the list applies their pure setDone and keeps what they become. */
		completeAll: {
			pure: true,
			changes: ["items"],
			run(next) {
				next.items = this.items.map((it) => tutuca.apply(it, "setDone", true));
			},
		},
		clearDone: {
			pure: true,
			changes: ["items"],
			run(next) {
				if (!this.items.some((it) => it.done)) return;
				next.items = this.items.filter((it) => !it.done);
			},
		},
		/** The item dragged from from, dropped on the one at to, takes its place; something dragged
		 * from elsewhere has no key. */
		moveItem: {
			pure: true,
			changes: ["items"],
			constraints: { from: { keyOf: "items" }, to: { keyOf: "items" } },
			post(prev, next, [from, to]: [number | null, number | null]) {
				return next.items.length === prev.items.length;
			},
			run(next, [from, to]: [number | null, number | null]) {
				if (from === null || to === null || from === to) return;
				const moved = this.items[from];
				if (moved === undefined) return;
				next.items.splice(from, 1);
				next.items.splice(to, 0, moved);
			},
		},
		/** An item's notify: the source key says which wants to go. */
		removeMe: {
			sourceKey: { keyOf: "items" },
			changes: ["items"],
			run(next, [], ctx) {
				if (ctx.sourceKey !== undefined) next.items.splice(ctx.sourceKey, 1);
			},
		},
	},
	loops: {
		/** Keyed by the item's id, so an item keeps its DOM when the ones before it go. */
		items: {
			key(key: number, item: TodoItem): number {
				return item.id;
			},
		},
	},
	view: section(
		{ class: "todos flex flex-col gap-2" },
		div(
			{ class: "join w-full" },
			input({
				class: "input input-sm join-item w-full",
				placeholder: "What needs doing?",
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
				"on:keydown+enter+prevent": send("addTodo"),
			}),
			button({ class: "btn btn-sm btn-primary join-item", "on:click": send("addTodo") }, "add"),
		),
		ul(
			{
				class: "list bg-base-100 rounded-box border border-base-300",
				"on:drop": send("moveItem", dragKey(), sourceKey()),
			},
			renderEach(field("items"), "items"),
		),
		footer(
			{ class: "flex items-center gap-2 text-sm" },
			span(
				{ class: "flex-1 opacity-70 tabular-nums" },
				field("remaining"),
				" of ",
				field("count"),
				" left",
			),
			button({ class: "btn btn-xs", "on:click": send("completeAll") }, "all done"),
			button({ class: "btn btn-xs", "on:click": send("clearDone") }, "clear done"),
		),
	),
};

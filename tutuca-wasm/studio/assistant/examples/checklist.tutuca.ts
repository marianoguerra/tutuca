// Example: a component holding others. CheckItem notifies its parent; the checklist makes items
// by name (ctx.make), finds which one notified by the source key, filters what it renders with a
// loop hook, and reads a field of each item.
import { button, div, field, input, label, li, renderEach, section, send, span, targetValue, ul, when } from "tutuca/view";

/** One thing to check. */
export type CheckItem = { text: string; done: boolean };
export interface CheckItemNotifies {
	/** To the parent, asking to be removed. */
	removeMe(): void;
}

export const CheckItem = {
	defaults: { text: "", done: false },
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
		/** The parent decides: this only asks. */
		remove: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("removeMe", []);
			},
		},
	},
	view: li(
		{ class: "flex items-center gap-2" },
		input({ type: "checkbox", class: "checkbox checkbox-sm", checked: field("done"), "on:change": send("toggle") }),
		span({ class: when(field("done"), "flex-1 line-through opacity-50", "flex-1") }, field("text")),
		button({ class: "btn btn-xs btn-ghost", title: "Remove", "on:click": send("remove") }, "×"),
	),
};

/** Things to check, and whether to show the checked ones. */
export type Checklist = {
	items: CheckItem[];
	draft: string;
	hideDone: boolean;
	/** How many aren't checked. */
	readonly left: number;
};

export const Checklist = {
	defaults: { items: [], draft: "", hideDone: false },
	constraints: { items: { maxLength: 50 }, left: { int: true, min: 0 } },
	queries: {
		get left(): number {
			return this.items.filter((item) => !item.done).length;
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
		/** A new unchecked item with the draft's text; the draft starts over. pre is only checked
		 * in dev mode: the handler checks it too. */
		add: {
			changes: ["items", "draft"],
			pre(prev, []: []) {
				return this.draft !== "";
			},
			run(next, [], ctx) {
				if (this.draft === "") return;
				next.items.push(ctx.make("CheckItem", { text: this.draft, done: false }));
				next.draft = "";
			},
		},
		setHideDone: {
			pure: true,
			changes: ["hideDone"],
			post(prev, next, [hide]: [boolean]) {
				return next.hideDone === hide;
			},
			run(next, [hide]: [boolean]) {
				next.hideDone = hide;
			},
		},
		/** An item's notify: the source key says which one. */
		removeMe: {
			sourceKey: { keyOf: "items" },
			changes: ["items"],
			post(prev, next, []: []) {
				return next.items.length === prev.items.length - 1;
			},
			run(next, [], ctx) {
				const at = ctx.sourceKey;
				if (at !== undefined) next.items.splice(at, 1);
			},
		},
	},
	loops: {
		/** The items rendered: all of them, or the unchecked ones. */
		shown: {
			filter(key: number, item: CheckItem): boolean {
				return !(this.hideDone && item.done);
			},
		},
	},
	view: section(
		{ class: "flex flex-col gap-2" },
		div(
			{ class: "join" },
			input({
				class: "input input-sm join-item",
				placeholder: "Something to check",
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
				"on:keydown+enter+prevent": send("add"),
			}),
			button({ class: "btn btn-sm btn-primary join-item", "on:click": send("add") }, "add"),
		),
		ul({ class: "flex flex-col gap-1" }, renderEach(field("items"), "shown")),
		label(
			{ class: "flex items-center gap-2 text-sm" },
			input({
				type: "checkbox",
				class: "toggle toggle-sm",
				checked: field("hideDone"),
				"on:change": send("setHideDone", targetValue()),
			}),
			"hide checked · ",
			field("left"),
			" left",
		),
	),
	examples: {
		addOne: {
			start: { draft: "milk" },
			steps: [{ send: "add" }, { expect: { draft: "", left: 1 } }],
		},
	},
};

export const register = { CheckItem: "CheckItem", Checklist: "Checklist" };

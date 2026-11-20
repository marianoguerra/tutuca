// Example: what a new component in the studio starts from. One component that a layout's hole
// can make with no fields, keeping a list of records (not of components) and editing them in
// place: messages that take an index into the list (the item's sourceKey()) and an argument with
// its own constraint, a loop that filters the rows and enriches each with what it shows,
// computed properties, an invariant, an ask answered by the module's own askHandlers (whose
// answer is a record, and may ask again), a field with a few values, examples, and a layoutEdit
// view for a screen being edited.
import {
	button,
	div,
	each,
	field,
	h3,
	input,
	li,
	lookupBind,
	option,
	section,
	select,
	send,
	sourceKey,
	span,
	targetValue,
	ul,
	when,
} from "tutuca/view";

/** A priority: 0 low, 1 mid, 2 high. */
export type Task = { text: string; done: boolean; priority: number };
/** Which items are shown. */
export type Show = "all" | "open" | "done";
/** What suggest answers: an idea, and the taken it answers. */
export type Suggestion = { idea: string; taken: number };

/** Things to do, each with a priority, filtered by whether they're done. */
export type Tasks = {
	title: string;
	items: Task[];
	/** What's being typed for the next item. */
	draft: string;
	show: Show;
	/** How many aren't done. */
	readonly left: number;
	/** "2 of 5 left", or "nothing yet". */
	readonly summary: string;
	/** Whether the filter hides some. */
	readonly filtered: boolean;
};
export interface TasksAsks {
	/** Something to do, picked by the module's ask handler; taken says how many items there
	 * are, so the pick changes as the list grows. The answer says which taken it answers, and an
	 * idea already in the list is asked again with the next one. */
	suggest(taken: number): Suggestion;
}

export const Tasks = {
	defaults: { title: "Tasks", items: [], draft: "", show: "all" },
	constraints: {
		title: { maxLength: 40 },
		items: { maxLength: 50 },
		draft: { maxLength: 80 },
		left: { int: true, min: 0 },
	},
	queries: {
		get left(): number {
			return this.items.filter((item) => !item.done).length;
		},
		get summary(): string {
			return this.items.length === 0 ? "nothing yet" : `${this.left} of ${this.items.length} left`;
		},
		get filtered(): boolean {
			return this.show !== "all";
		},
	},
	invariants: {
		leftCountsItems(): boolean {
			return this.left <= this.items.length;
		},
	},
	on: {
		setTitle: {
			pure: true,
			changes: ["title"],
			constraints: { title: { maxLength: 40 } },
			post(prev, next, [title]: [string]) {
				return next.title === title;
			},
			run(next, [title]: [string]) {
				next.title = title;
			},
		},
		setDraft: {
			pure: true,
			changes: ["draft"],
			constraints: { text: { maxLength: 80 } },
			post(prev, next, [text]: [string]) {
				return next.draft === text;
			},
			run(next, [text]: [string]) {
				next.draft = text;
			},
		},
		/** A new open item, low priority, with the draft's text; the draft starts over. pre says
		 * the draft isn't empty; a button can still send it, so it's checked here too. */
		add: {
			pure: true,
			changes: ["items", "draft"],
			pre(prev, []: []) {
				return this.draft !== "";
			},
			post(prev, next, []: []) {
				return next.items.length === prev.items.length + 1 && next.draft === "";
			},
			run(next, []: []) {
				if (this.draft === "") return;
				next.items.push({ text: this.draft, done: false, priority: 0 });
				next.draft = "";
			},
		},
		toggle: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				const item = at === null ? undefined : this.items[at];
				if (at === null || item === undefined) return;
				next.items[at] = { text: item.text, done: !item.done, priority: item.priority };
			},
		},
		/** Priority goes 0, 1, 2 and back to 0. */
		bump: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				const item = at === null ? undefined : this.items[at];
				if (at === null || item === undefined) return;
				next.items[at] = { text: item.text, done: item.done, priority: (item.priority + 1) % 3 };
			},
		},
		/** The item's text in the draft again. */
		again: {
			pure: true,
			changes: ["draft"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				const item = at === null ? undefined : this.items[at];
				if (item !== undefined) next.draft = item.text;
			},
		},
		removeAt: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				if (at !== null && this.items[at] !== undefined) next.items.splice(at, 1);
			},
		},
		/** to is what the select's option says: a name that isn't one of show's leaves it as it is. */
		setShow: {
			pure: true,
			changes: ["show"],
			run(next, [to]: [string]) {
				if (to === "all" || to === "open" || to === "done") next.show = to;
			},
		},
		clearDone: {
			pure: true,
			changes: ["items"],
			pre(prev, []: []) {
				return this.left < this.items.length;
			},
			post(prev, next, []: []) {
				return next.items.length === prev.left;
			},
			run(next, []: []) {
				next.items = this.items.filter((item) => !item.done);
			},
		},
		/** The answer comes back to answers.suggest. */
		suggestOne: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("suggest", [this.items.length]);
			},
		},
	},
	answers: {
		/** An idea already in the list asks for the next one, up to the four there are. */
		suggest: {
			ok(next, [answer]: [Suggestion], ctx) {
				const known = this.items.some((item) => item.text === answer.idea);
				if (known && answer.taken < this.items.length + 3) {
					ctx.ask("suggest", [answer.taken + 1]);
					return;
				}
				next.draft = answer.idea;
			},
		},
	},
	loops: {
		/** The rows shown: the items the filter lets through, each with its priority as a badge,
		 * and hot when it's urgent and not done. */
		shown: {
			filter(key: number, item: Task): boolean {
				if (this.show === "open") return !item.done;
				if (this.show === "done") return item.done;
				return true;
			},
			enrich(key: number, item: Task) {
				const badge = item.priority === 2 ? "!!" : item.priority === 1 ? "!" : "·";
				return { badge, hot: item.priority === 2 && !item.done };
			},
		},
	},
	view: section(
		{ class: "card card-border bg-base-100 gap-2 p-3" },
		div(
			{ class: "flex items-center justify-between gap-2" },
			h3({ class: "font-semibold" }, field("title")),
			span({ class: "text-xs opacity-70 tabular-nums" }, field("summary")),
		),
		div(
			{ class: "join" },
			input({
				class: "input input-sm join-item flex-1",
				placeholder: "Something to do",
				"aria-label": "New task",
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
				"on:keydown+enter+prevent": send("add"),
			}),
			button({ class: "btn btn-sm join-item", title: "Suggest one", "on:click": send("suggestOne") }, "idea"),
			button({ class: "btn btn-sm btn-primary join-item", "on:click": send("add") }, "add"),
		),
		ul(
			{ class: "flex flex-col gap-1" },
			each(
				field("items"),
				li(
					{
						class: when(
							lookupBind("hot"),
							"flex items-center gap-2 rounded-box bg-error/10 px-1",
							"flex items-center gap-2 px-1",
						),
					},
					input({
						type: "checkbox",
						class: "checkbox checkbox-sm",
						checked: field("done"),
						"on:change": send("toggle", sourceKey()),
					}),
					span({ class: when(field("done"), "flex-1 line-through opacity-50", "flex-1") }, field("text")),
					// The item's key: the handler reads its text.
					button(
						{ class: "btn btn-xs btn-ghost", title: "Again: put this in the draft", "on:click": send("again", sourceKey()) },
						"again",
					),
					button(
						{ class: "btn btn-xs btn-ghost tabular-nums", title: "Change the priority", "on:click": send("bump", sourceKey()) },
						lookupBind("badge"),
					),
					button(
						{ class: "btn btn-xs btn-ghost text-error", title: "Remove", "on:click": send("removeAt", sourceKey()) },
						"×",
					),
				),
				"shown",
			),
		),
		div(
			{ class: "flex flex-wrap items-center gap-1 text-xs" },
			select(
				{ class: "select select-xs w-24", "aria-label": "Show", value: field("show"), "on:change": send("setShow", targetValue()) },
				option({ value: "all" }, "all"),
				option({ value: "open" }, "open"),
				option({ value: "done" }, "done"),
			),
			when(field("filtered"), span({ class: "opacity-70" }, "some hidden")),
			button({ class: "btn btn-xs btn-ghost ml-auto", "on:click": send("clearDone") }, "clear done"),
		),
	),
	views: {
		// While a studio screen is edited: only the title, to name it there.
		layoutEdit: section(
			{ class: "card border border-dashed border-base-300 gap-1 p-2" },
			input({ class: "input input-xs", "aria-label": "Title", value: field("title"), "on:input": send("setTitle", targetValue()) }),
			span({ class: "text-xs opacity-70" }, field("summary")),
		),
	},
	examples: {
		addThenFinish: {
			start: { draft: "write the docs" },
			steps: [
				{ send: "add" },
				{ expect: { draft: "", left: 1 } },
				{ send: "toggle", args: [0] },
				{ expect: { left: 0 } },
				{ send: "clearDone" },
				{ expect: { items: [] } },
			],
		},
		priorityWraps: {
			start: { draft: "ship it" },
			steps: [
				{ send: "add" },
				{ send: "bump", args: [0] },
				{ send: "bump", args: [0] },
				{ send: "bump", args: [0] },
				{ expect: { items: [{ text: "ship it", done: false, priority: 0 }] } },
			],
		},
	},
};

export const register = { Tasks: "Tasks" };

/** One of a few ideas, by how many items there are. */
function ideaFor(taken: number): string {
	const pick = taken % 4;
	if (pick === 1) return "answer the email";
	if (pick === 2) return "take a walk";
	if (pick === 3) return "read a chapter";
	return "water the plants";
}

/** suggest: answered here, from the scope the asker is in. */
export const askHandlers = {
	suggest(taken: number): Suggestion {
		return { idea: ideaFor(taken), taken };
	},
};

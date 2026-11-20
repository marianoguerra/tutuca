// Example: one component with typed fields, defaults and constraints, a computed property,
// messages with guards and contracts, and a view that reads fields and sends messages (input
// events, a key modifier).
import { button, div, field, input, send, span, targetValue, textarea, when } from "tutuca/view";

/** A short note that can be pinned. */
export type Note = {
	title: string;
	body: string;
	pinned: boolean;
	/** How many characters the body has left. */
	readonly left: number;
};

export const Note = {
	defaults: { title: "Untitled", body: "", pinned: false },
	constraints: { title: { maxLength: 60 }, body: { maxLength: 280 }, left: { int: true, min: 0 } },
	queries: {
		get left(): number {
			return 280 - this.body.length;
		},
	},
	on: {
		// An argument that breaks its constraints is rejected before the handler runs.
		setTitle: {
			pure: true,
			changes: ["title"],
			constraints: { title: { maxLength: 60 } },
			post(prev, next, [title]: [string]) {
				return next.title === title;
			},
			run(next, [title]: [string]) {
				next.title = title;
			},
		},
		setBody: {
			pure: true,
			changes: ["body"],
			constraints: { text: { maxLength: 280 } },
			post(prev, next, [text]: [string]) {
				return next.body === text;
			},
			run(next, [text]: [string]) {
				next.body = text;
			},
		},
		togglePin: {
			pure: true,
			changes: ["pinned"],
			post(prev, next, []: []) {
				return next.pinned === !prev.pinned;
			},
			run(next, []: []) {
				next.pinned = !this.pinned;
			},
		},
		// pre: only while there's something to clear.
		clear: {
			pure: true,
			changes: ["body"],
			pre(prev, []: []) {
				return this.body.length > 0;
			},
			post(prev, next, []: []) {
				return next.body.length === 0;
			},
			run(next, []: []) {
				next.body = "";
			},
		},
	},
	view: div(
		{
			class: when(field("pinned"), "card card-border bg-warning/10 gap-2 p-3", "card card-border bg-base-100 gap-2 p-3"),
		},
		div(
			{ class: "flex items-center gap-2" },
			input({
				class: "input input-sm input-ghost flex-1 font-semibold",
				"aria-label": "Title",
				value: field("title"),
				"on:input": send("setTitle", targetValue()),
				"on:keydown+escape": send("setTitle", "Untitled"),
			}),
			button({ class: "btn btn-xs btn-ghost", "on:click": send("togglePin") }, when(field("pinned"), "unpin", "pin")),
		),
		// flex-1: the body takes the height the card has left.
		textarea({
			class: "textarea textarea-sm w-full flex-1",
			"aria-label": "Body",
			value: field("body"),
			"on:input": send("setBody", targetValue()),
		}),
		div(
			{ class: "flex items-center justify-between text-xs" },
			span({ class: "opacity-70 tabular-nums" }, field("left"), " left"),
			button({ class: "btn btn-xs", "on:click": send("clear") }, "clear"),
		),
	),
	examples: {
		pinTwice: {
			start: {},
			steps: [{ send: "togglePin" }, { send: "togglePin" }, { expect: { pinned: false } }],
		},
		clearEmpties: {
			start: { body: "hello" },
			steps: [{ send: "clear" }, { expect: { body: "" } }],
		},
	},
};

export const register = { Note: "Note" };

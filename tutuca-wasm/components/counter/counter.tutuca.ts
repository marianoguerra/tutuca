// The counter component module: Counter, Label and the Board that holds counters.
import type { Display } from "../meta/meta.tutuca";
import { button, div, field, input, p, renderEach, section, send, span, targetValue } from "tutuca/view";

/** A count, with buttons to change it and an input to type it. */
export type Counter = { count: number };
export interface CounterNotifies {
	/** To the parent, with the new count, when + was clicked. */
	changed(count: number): void;
	/** To the parent, asking to be removed. */
	removeMe(): void;
}
export interface CounterAsks {
	/** Answered now, by this module's ask handler. */
	loadCount(): number;
	/** Answered later, by the host. */
	fetchCount(): number;
}

export const Counter = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Counter",
			icon: "🔢",
			description: "A count, with buttons to change it and an input to type it.",
		},
	},
	defaults: { count: 0 },
	constraints: { count: { int: true } },
	on: {
		inc: {
			changes: ["count"],
			post(prev, next, []: []) {
				return next.count === prev.count + 1;
			},
			run(next, [], ctx) {
				ctx.notify("changed", [this.count + 1]);
				next.count = this.count + 1;
			},
		},
		add: {
			pure: true,
			changes: ["count"],
			constraints: { n: { int: true } },
			post(prev, next, [n]: [number]) {
				return next.count === prev.count + n;
			},
			run(next, [n]: [number]) {
				next.count = this.count + n;
			},
		},
		/** From the input: the text typed, kept when it isn't a whole number yet. */
		set: {
			pure: true,
			changes: ["count"],
			run(next, [text]: [string]) {
				const n = Number(text);
				if (text.trim() === "" || !Number.isInteger(n)) return;
				next.count = n;
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
		remove: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("removeMe", []);
			},
		},
		load: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("loadCount", []);
			},
		},
		fetch: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("fetchCount", []);
			},
		},
		/** Swaps itself for a Label saying what the count was. */
		toLabel: {
			swap: true,
			run(next, [], ctx) {
				return ctx.make("Label", { text: `was ${this.count}` });
			},
		},
	},
	answers: {
		loadCount: {
			ok(next, [count]: [number], ctx) {
				next.count = count;
			},
			/** The error, logged. */
			error(next, [error]: [unknown], ctx) {
				ctx.log(error);
			},
		},
		fetchCount: {
			ok(next, [count]: [number], ctx) {
				next.count = count;
			},
		},
	},
	view: div(
		{ class: "counter card card-border bg-base-100 w-fit h-fit flex-row items-center gap-2 p-2" },
		button({ class: "btn btn-sm", "on:click": send("inc") }, "+"),
		span({ class: "min-w-10 text-center font-semibold tabular-nums" }, field("count")),
		button({ class: "btn btn-sm", "on:click": send("add", 10) }, "+10"),
		input({ class: "input input-sm w-20", value: field("count"), "on:input": send("set", targetValue()) }),
		button({ class: "btn btn-sm btn-ghost", "on:click": send("remove") }, "x"),
	),
	examples: {
		addThenReset: {
			start: { count: 1 },
			steps: [{ send: "add", args: [5] }, { expect: { count: 6 } }, { send: "reset" }, { expect: { count: 0 } }],
		},
	},
};

/** What a counter swaps itself for. */
export type Label = { text: string };
export const Label = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Label", icon: "🏷️", description: "What a counter swaps itself for." },
	},
	defaults: { text: "" },
	view: p({ class: "text-sm italic opacity-70" }, field("text")),
};

/** The root: a list of counters, and how many times they were incremented. */
/** A counter in counters may have swapped itself for a Label. */
export type Board = { counters: (Counter | Label)[]; total: number };
export const Board = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Counters",
			icon: "🧮",
			description: "A list of counters, and how many times they were incremented.",
		},
	},
	defaults: { counters: [], total: 0 },
	constraints: { total: { int: true } },
	on: {
		addCounter: {
			changes: ["counters"],
			run(next, [], ctx) {
				next.counters.push(ctx.make("Counter", { count: this.counters.length }));
			},
		},
		resetAll: {
			changes: [],
			run(next, [], ctx) {
				this.counters.forEach((c, i) => {
					ctx.sendAt("reset", [], { item: "counters", key: i });
				});
			},
		},
		/** A counter's notify: one more increment. */
		changed: {
			pure: true,
			changes: ["total"],
			constraints: { count: { int: true } },
			post(prev, next, [count]: [number]) {
				return next.total === prev.total + 1;
			},
			run(next, [count]: [number]) {
				next.total = this.total + 1;
			},
		},
		/** A counter's notify: the source key says which wants to go. */
		removeMe: {
			sourceKey: { keyOf: "counters" },
			changes: ["counters"],
			post(prev, next, []: []) {
				return next.counters.length === prev.counters.length - 1;
			},
			run(next, [], ctx) {
				if (ctx.sourceKey !== undefined) next.counters.splice(ctx.sourceKey, 1);
			},
		},
	},
	view: section(
		{ class: "flex flex-col items-start gap-2" },
		div(
			{ class: "flex items-center gap-2" },
			button({ class: "btn btn-sm", "on:click": send("addCounter") }, "add"),
			button({ class: "btn btn-sm btn-outline", "on:click": send("resetAll") }, "reset all"),
			p({ class: "font-semibold tabular-nums" }, "total ", field("total")),
		),
		renderEach(field("counters")),
	),
};

export const register = { Counter: "Counter", Label: "Label", Board: "Board" };

/** The asks this module answers, wherever it's registered: loadCount now, with 42. */
export const askHandlers = {
	loadCount(): number {
		return 42;
	},
};
/** The asks the host answers: fetchCount, later. */
export const hostAsks = ["fetchCount"];

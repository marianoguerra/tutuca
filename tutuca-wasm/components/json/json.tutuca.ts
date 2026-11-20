// The json component module: a JSON tree, read only in each value's main view, edited in place
// in its edit view (components/json in tutuca's JS). JsonEditor pushes its mode's view above the
// tree, so "edit" switches the whole tree; values without an edit view keep main. Every value
// implements JsonValue: its json query is its compact JSON text, which the collections compose
// and the editor indents.
import type { Display } from "../meta/meta.tutuca";
import { button, div, each, field, input, label, lookupBind, pre, pushView, render, renderIt, send, sourceKey, span, targetValue, when } from "tutuca/view";
import { parseJson, toJson } from "tutuca/data";

/** What every value is: its JSON text. */
export interface JsonValue {
	readonly json: string;
}

/** What a selector can become. */
export type JsonKind = "null" | "bool" | "number" | "string" | "array" | "object";

const MONO = "font-mono text-sm leading-6";
const PUNCT = "font-mono text-sm leading-6 opacity-50";
const INLINE_INPUT =
	"min-w-[1ch] [field-sizing:content] bg-transparent p-0 outline-none border-0 border-b border-dashed border-transparent hover:border-base-content/30 focus:border-primary";
const NUMBER_INPUT =
	"font-mono text-sm leading-6 text-info min-w-[1ch] [field-sizing:content] bg-transparent p-0 outline-none border-0 border-b border-dashed border-transparent hover:border-base-content/30 focus:border-primary";
const PICK = "font-mono text-sm leading-6 cursor-pointer rounded border border-dashed border-base-content/20 px-1 hover:border-current";
const ACTION =
	"cursor-pointer rounded px-1 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 focus:opacity-100";
const ADD = "cursor-pointer self-start rounded px-1 font-mono text-xs opacity-50 hover:opacity-100";

/** text as a number, as Number(text) reads it; null when it's blank or not a finite number. */
function numberOf(text: string): number | null {
	if (text.trim() === "") return null;
	const n = Number(text);
	return Number.isFinite(n) ? n : null;
}

/** items without the one at at. */
function withoutAt(items: readonly JsonValue[], at: number | null): JsonValue[] {
	return items.filter((_, i) => i !== at);
}

/** "," after every item but the last. */
function commaAfter(key: number, last: number): string {
	return key === last ? "" : ",";
}

/** null. */
export type JsonNull = { readonly json: string };
export const JsonNull = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON null", icon: "∅", description: "null." },
	},
	queries: {
		get json(): string {
			return "null";
		},
	},
	view: span({ class: `${MONO} text-warning` }, "null"),
};

/** true or false; edit toggles it. */
export type JsonBool = { value: boolean; readonly json: string };
export const JsonBool = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON boolean", icon: "⊤", description: "true or false." },
	},
	defaults: { value: false },
	queries: {
		get json(): string {
			return this.value ? "true" : "false";
		},
	},
	on: {
		toggle: {
			pure: true,
			changes: ["value"],
			post(prev, next, []: []) {
				return next.value === !prev.value;
			},
			run(next, []: []) {
				next.value = !this.value;
			},
		},
	},
	view: span({ class: `${MONO} text-accent` }, when(field("value"), "true", "false")),
	views: {
		edit: button(
			{
				class: `${MONO} text-accent cursor-pointer underline decoration-dashed decoration-transparent hover:decoration-current`,
				title: "Toggle",
				"aria-label": "boolean value",
				"on:click": send("toggle"),
			},
			when(field("value"), "true", "false"),
		),
	},
};

/** A number. text is what the user typed; value follows it whenever it reads as a number. */
export type JsonNumber = {
	value: number;
	text: string;
	/** Whether text reads as a number. */
	readonly valid: boolean;
	readonly json: string;
};
export const JsonNumber = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON number", icon: "#", description: "A number." },
	},
	defaults: { value: 0, text: "0" },
	queries: {
		get valid(): boolean {
			return numberOf(this.text) !== null;
		},
		get json(): string {
			return toJson(this.value, 0);
		},
	},
	on: {
		setText: {
			pure: true,
			changes: ["value", "text"],
			post(prev, next, [text]: [string]) {
				return next.text === text;
			},
			run(next, [text]: [string]) {
				const n = numberOf(text);
				if (n !== null) next.value = n;
				next.text = text;
			},
		},
	},
	view: span({ class: `${MONO} text-info` }, field("value")),
	views: {
		edit: input({
			class: when(field("valid"), NUMBER_INPUT, `${NUMBER_INPUT} text-error`),
			inputmode: "decimal",
			"aria-label": "number value",
			title: field("value"),
			value: field("text"),
			"on:input": send("setText", targetValue()),
		}),
	},
};

/** A string. */
export type JsonString = { value: string; readonly json: string };
export const JsonString = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON string", icon: '"', description: "A string." },
	},
	defaults: { value: "" },
	queries: {
		get json(): string {
			return toJson(this.value, 0);
		},
	},
	on: {
		setValue: {
			pure: true,
			changes: ["value"],
			post(prev, next, [value]: [string]) {
				return next.value === value;
			},
			run(next, [value]: [string]) {
				next.value = value;
			},
		},
	},
	view: span({ class: `${MONO} text-success` }, '"', field("value"), '"'),
	views: {
		edit: span(
			{ class: `${MONO} text-success` },
			'"',
			input({
				class: INLINE_INPUT,
				"aria-label": "string value",
				value: field("value"),
				"on:input": send("setValue", targetValue()),
			}),
			'"',
		),
	},
};

/** A value still to be chosen, in a new array item or object entry: setTo replaces it with an
 * empty value of the kind picked. */
export type JsonSelector = { readonly json: string };
export const JsonSelector = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON value", icon: "?", description: "A value still to be chosen." },
	},
	queries: {
		get json(): string {
			return "null";
		},
	},
	on: {
		setTo: {
			swap: true,
			changes: [],
			run(next, [kind]: [JsonKind], ctx) {
				if (kind === "bool") return ctx.make("JsonBool");
				if (kind === "number") return ctx.make("JsonNumber");
				if (kind === "string") return ctx.make("JsonString");
				if (kind === "array") return ctx.make("JsonArray");
				if (kind === "object") return ctx.make("JsonObject");
				return ctx.make("JsonNull");
			},
		},
	},
	view: span({ class: `${MONO} italic opacity-40` }, "…"),
	views: {
		edit: span(
			{ class: "inline-flex flex-wrap items-center gap-1", role: "group", "aria-label": "Pick a type" },
			button({ class: `${PICK} text-warning`, title: "null", "on:click": send("setTo", "null") }, "null"),
			button({ class: `${PICK} text-accent`, title: "bool", "on:click": send("setTo", "bool") }, "false"),
			button({ class: `${PICK} text-info`, title: "number", "on:click": send("setTo", "number") }, "0"),
			button({ class: `${PICK} text-success`, title: "string", "on:click": send("setTo", "string") }, '""'),
			button({ class: PICK, title: "array", "on:click": send("setTo", "array") }, "[]"),
			button({ class: PICK, title: "object", "on:click": send("setTo", "object") }, "{}"),
		),
	},
};

/** A list of values. */
export type JsonArray = { items: JsonValue[]; readonly isEmpty: boolean; readonly json: string };
export const JsonArray = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON array", icon: "[]", description: "A list of values." },
	},
	defaults: { items: [] },
	queries: {
		get isEmpty(): boolean {
			return this.items.length === 0;
		},
		get json(): string {
			return `[${this.items.map((v) => v.json).join(",")}]`;
		},
	},
	on: {
		add: {
			changes: ["items"],
			post(prev, next, []: []) {
				return next.items.length === prev.items.length + 1;
			},
			run(next, [], ctx) {
				next.items.push(ctx.make("JsonSelector"));
			},
		},
		removeAt: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number | null]) {
				next.items = withoutAt(this.items, at);
			},
		},
		moveUp: {
			pure: true,
			changes: ["items"],
			constraints: { at: { keyOf: "items" } },
			post(prev, next, [at]: [number | null]) {
				return next.items.length === prev.items.length;
			},
			run(next, [at]: [number | null]) {
				if (at === null || at === 0) return;
				const item = this.items[at];
				const before = this.items[at - 1];
				if (item === undefined || before === undefined) return;
				next.items[at - 1] = item;
				next.items[at] = before;
			},
		},
	},
	/** Commas after every item but the last. */
	loops: {
		items: {
			prepare(items: JsonValue[]): number {
				return items.length - 1;
			},
			enrich(key: number, item: JsonValue, last: number) {
				return { comma: commaAfter(key, last) };
			},
		},
	},
	view: when(
		field("isEmpty"),
		div({ class: "inline-flex items-baseline gap-1" }, span({ class: PUNCT }, "[]")),
		div(
			{ class: "inline-flex flex-col" },
			span({ class: PUNCT }, "["),
			div(
				{ class: "ml-1 flex flex-col border-l border-base-content/15 pl-4" },
				each(field("items"), div({ class: "group flex items-baseline gap-1" }, renderIt(), span({ class: PUNCT }, lookupBind("comma"))), "items"),
			),
			span({ class: PUNCT }, "]"),
		),
	),
	views: {
		edit: when(
			field("isEmpty"),
			div(
				{ class: "inline-flex items-baseline gap-1" },
				span({ class: PUNCT }, "[]"),
				button({ class: ADD, "on:click": send("add") }, "+ item"),
			),
			div(
				{ class: "inline-flex flex-col" },
				span({ class: PUNCT }, "["),
				div(
					{ class: "ml-1 flex flex-col border-l border-base-content/15 pl-4" },
					each(
						field("items"),
						div(
							{ class: "group flex items-baseline gap-1" },
							renderIt(),
							span({ class: PUNCT }, lookupBind("comma")),
							button({ class: ACTION, title: "Move up", "on:click": send("moveUp", sourceKey()) }, "↑"),
							button({ class: `${ACTION} text-error`, title: "Remove", "on:click": send("removeAt", sourceKey()) }, "×"),
						),
						"items",
					),
					button({ class: ADD, "on:click": send("add") }, "+ item"),
				),
				span({ class: PUNCT }, "]"),
			),
		),
	},
};

/** An object's entry: a key and its value, a selector until one is given. */
export type JsonEntry = { key: string; value: JsonSelector | JsonValue };
export const JsonEntry = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "JSON entry",
			icon: ":",
			description: "An object's entry: a key and its value.",
		},
	},
	defaults: { key: "" },
	on: {
		setKey: {
			pure: true,
			changes: ["key"],
			post(prev, next, [key]: [string]) {
				return next.key === key;
			},
			run(next, [key]: [string]) {
				next.key = key;
			},
		},
	},
	view: span(
		{ class: "inline-flex items-baseline gap-1" },
		span({ class: `${MONO} text-secondary` }, '"', field("key"), '"'),
		span({ class: PUNCT }, ":"),
		render(field("value")),
	),
	views: {
		edit: span(
			{ class: "inline-flex items-baseline gap-1" },
			span(
				{ class: `${MONO} text-secondary` },
				'"',
				input({ class: INLINE_INPUT, "aria-label": "key", value: field("key"), "on:input": send("setKey", targetValue()) }),
				'"',
			),
			span({ class: PUNCT }, ":"),
			render(field("value")),
		),
	},
};

/** Keys and values. Later entries win, as in JSON.parse. */
export type JsonObject = { entries: JsonEntry[]; readonly isEmpty: boolean; readonly json: string };
export const JsonObject = {
	implements: ["JsonValue"],
	meta: {
		"https://tutuca.dev/meta/display": { title: "JSON object", icon: "{}", description: "Keys and values." },
	},
	defaults: { entries: [] },
	queries: {
		get isEmpty(): boolean {
			return this.entries.length === 0;
		},
		/** As JSON.parse would read it back: a key's first entry places it, its last entry gives
		 * its value. */
		get json(): string {
			const parts: string[] = [];
			const placed: string[] = [];
			for (const entry of this.entries) {
				if (placed.includes(entry.key)) continue;
				placed.push(entry.key);
				let value = entry.value.json;
				for (const later of this.entries) if (later.key === entry.key) value = later.value.json;
				parts.push(`${toJson(entry.key, 0)}:${value}`);
			}
			return `{${parts.join(",")}}`;
		},
	},
	on: {
		add: {
			changes: ["entries"],
			post(prev, next, []: []) {
				return next.entries.length === prev.entries.length + 1;
			},
			run(next, [], ctx) {
				const value = ctx.make("JsonSelector");
				next.entries.push(ctx.make("JsonEntry", { key: `key${this.entries.length + 1}`, value }));
			},
		},
		removeAt: {
			pure: true,
			changes: ["entries"],
			constraints: { at: { keyOf: "entries" } },
			run(next, [at]: [number | null]) {
				next.entries = this.entries.filter((_, i) => i !== at);
			},
		},
		moveUp: {
			pure: true,
			changes: ["entries"],
			constraints: { at: { keyOf: "entries" } },
			post(prev, next, [at]: [number | null]) {
				return next.entries.length === prev.entries.length;
			},
			run(next, [at]: [number | null]) {
				if (at === null || at === 0) return;
				const entry = this.entries[at];
				const before = this.entries[at - 1];
				if (entry === undefined || before === undefined) return;
				next.entries[at - 1] = entry;
				next.entries[at] = before;
			},
		},
	},
	loops: {
		entries: {
			prepare(entries: JsonEntry[]): number {
				return entries.length - 1;
			},
			enrich(key: number, entry: JsonEntry, last: number) {
				return { comma: commaAfter(key, last) };
			},
		},
	},
	view: when(
		field("isEmpty"),
		div({ class: "inline-flex items-baseline gap-1" }, span({ class: PUNCT }, "{}")),
		div(
			{ class: "inline-flex flex-col" },
			span({ class: PUNCT }, "{"),
			div(
				{ class: "ml-1 flex flex-col border-l border-base-content/15 pl-4" },
				each(field("entries"), div({ class: "group flex items-baseline gap-1" }, renderIt(), span({ class: PUNCT }, lookupBind("comma"))), "entries"),
			),
			span({ class: PUNCT }, "}"),
		),
	),
	views: {
		edit: when(
			field("isEmpty"),
			div(
				{ class: "inline-flex items-baseline gap-1" },
				span({ class: PUNCT }, "{}"),
				button({ class: ADD, "on:click": send("add") }, "+ entry"),
			),
			div(
				{ class: "inline-flex flex-col" },
				span({ class: PUNCT }, "{"),
				div(
					{ class: "ml-1 flex flex-col border-l border-base-content/15 pl-4" },
					each(
						field("entries"),
						div(
							{ class: "group flex items-baseline gap-1" },
							renderIt(),
							span({ class: PUNCT }, lookupBind("comma")),
							button({ class: ACTION, title: "Move up", "on:click": send("moveUp", sourceKey()) }, "↑"),
							button({ class: `${ACTION} text-error`, title: "Remove", "on:click": send("removeAt", sourceKey()) }, "×"),
						),
						"entries",
					),
					button({ class: ADD, "on:click": send("add") }, "+ entry"),
				),
				span({ class: PUNCT }, "}"),
			),
		),
	},
};

/** A JSON document, shown read only or edited in place, with its JSON text; null until one is
 * given. */
export type JsonEditor = {
	value: JsonNull | JsonValue;
	mode: "view" | "edit";
	showText: boolean;
	readonly isEdit: boolean;
	readonly json: string;
	/** JSON.stringify(value, null, 2). */
	readonly text: string;
};
export const JsonEditor = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "JSON",
			icon: "{}",
			description: "A JSON value, viewed or edited in place, with its text.",
		},
	},
	defaults: { mode: "view", showText: false },
	queries: {
		get isEdit(): boolean {
			return this.mode === "edit";
		},
		get json(): string {
			return this.value.json;
		},
		get text(): string {
			return toJson(parseJson(this.value.json), 2);
		},
	},
	on: {
		setMode: {
			pure: true,
			changes: ["mode"],
			post(prev, next, [mode]: ["view" | "edit"]) {
				return next.mode === mode;
			},
			run(next, [mode]: ["view" | "edit"]) {
				next.mode = mode;
			},
		},
		setShowText: {
			pure: true,
			changes: ["showText"],
			post(prev, next, [showText]: [boolean]) {
				return next.showText === showText;
			},
			run(next, [showText]: [boolean]) {
				next.showText = showText;
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			div(
				{ class: "join", role: "group", "aria-label": "Mode" },
				button(
					{
						class: when(field("isEdit"), "btn btn-xs join-item", "btn btn-xs btn-primary join-item"),
						"on:click": send("setMode", "view"),
					},
					"View",
				),
				button(
					{
						class: when(field("isEdit"), "btn btn-xs btn-primary join-item", "btn btn-xs join-item"),
						"on:click": send("setMode", "edit"),
					},
					"Edit",
				),
			),
			label(
				{ class: "flex items-center gap-1 text-xs" },
				input({
					type: "checkbox",
					class: "checkbox checkbox-xs",
					checked: field("showText"),
					"on:change": send("setShowText", targetValue()),
				}),
				"JSON text",
			),
		),
		div({ class: "overflow-auto" }, pushView(field("mode"), render(field("value")))),
		when(field("showText"), pre({ class: "rounded bg-base-200 p-3 font-mono text-xs" }, field("text")), ""),
	),
};

export const register = {
	JsonNull: "JsonNull",
	JsonBool: "JsonBool",
	JsonNumber: "JsonNumber",
	JsonString: "JsonString",
	JsonSelector: "JsonSelector",
	JsonArray: "JsonArray",
	JsonEntry: "JsonEntry",
	JsonObject: "JsonObject",
	JsonEditor: "JsonEditor",
};

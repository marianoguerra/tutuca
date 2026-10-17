// A JSON tree. Every value shows read only in its main view; the ones that can change have
// an edit view, styled like main, that edits them in place. pushView("edit", ...) above a
// tree, as JsonEditor does, switches the whole tree; values without an edit view keep main.

import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	pushView,
	render,
	renderIt,
	scopeOf,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

export const VALUE_NAMES = [
	"JsonNull",
	"JsonBool",
	"JsonNumber",
	"JsonString",
	"JsonArray",
	"JsonObject",
	"JsonSelector",
];

// Shared looks, so an edit view reads like its main view.
const MONO = "font-mono text-sm leading-6";
const PUNCT = "opacity-50";
const TEXT = {
	null: `${MONO} text-warning`,
	bool: `${MONO} text-accent`,
	number: `${MONO} text-info`,
	string: `${MONO} text-success`,
	key: `${MONO} text-secondary`,
};
// An input that looks like text: no box, sized to its content, a dashed underline on hover.
const INLINE =
	"min-w-[1ch] [field-sizing:content] bg-transparent p-0 outline-none border-0 border-b border-dashed border-transparent hover:border-base-content/30 focus:border-primary";
const ACTION =
	"cursor-pointer rounded px-1 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 focus:opacity-100";
const ADD = "cursor-pointer self-start rounded px-1 font-mono text-xs opacity-50 hover:opacity-100";
const BLOCK = "ml-1 flex flex-col border-l border-base-content/15 pl-4";

const { div, input, label, pre, span } = tag;

export const JsonNull = component({
	name: "JsonNull",
	methods: {
		toJson() {
			return null;
		},
	},
	view: span({ class: TEXT.null }, "null"),
});

export const JsonBool = component({
	name: "JsonBool",
	fields: (t) => ({ value: t.boolean() }),
	methods: {
		toJson() {
			return this.value;
		},
	},
	views: {
		main: span({ class: TEXT.bool }, $if(field("value"), "true", "false")),
		edit: button(
			{
				class: `${TEXT.bool} cursor-pointer underline decoration-dashed decoration-transparent hover:decoration-current`,
				title: "Toggle",
				"aria-label": "boolean value",
				"@on.click": send("toggle"),
			},
			$if(field("value"), "true", "false"),
		),
	},
	on: {
		toggle: {
			args: [],
			post: (prev, next) => next.value === !prev.value,
			run(draft) {
				draft.value = !this.value;
			},
		},
	},
});

// text is what the user typed; value follows it whenever it reads as a number.
const asNumber = (text) => (text.trim() === "" ? Number.NaN : Number(text));
export const JsonNumber = component({
	name: "JsonNumber",
	fields: (t) => ({ value: t.number(), text: t.string("0") }),
	invariants: {
		valueFollowsText() {
			const n = asNumber(this.text);
			return !Number.isFinite(n) || n === this.value;
		},
	},
	methods: {
		toJson() {
			return this.value;
		},
		get textClass() {
			return Number.isFinite(asNumber(this.text))
				? `${TEXT.number} ${INLINE}`
				: `${TEXT.number} ${INLINE} text-error`;
		},
	},
	views: {
		main: span({ class: TEXT.number }, field("value")),
		edit: input({
			class: field("textClass"),
			inputmode: "decimal",
			"aria-label": "number value",
			title: field("value"),
			value: field("text"),
			"@on.input": send("setText", targetValue()),
		}),
	},
	on: {
		setText: {
			args: [t.string()],
			post: (_prev, next, [text]) => next.text === text,
			run(draft, [text]) {
				draft.text = text;
				const n = asNumber(text);
				if (Number.isFinite(n)) draft.value = n;
			},
		},
	},
});

export const JsonString = component({
	name: "JsonString",
	fields: (t) => ({ value: t.string() }),
	methods: {
		toJson() {
			return this.value;
		},
	},
	views: {
		main: span({ class: TEXT.string }, '"', field("value"), '"'),
		edit: span(
			{ class: TEXT.string },
			'"',
			input({
				class: INLINE,
				"aria-label": "string value",
				value: field("value"),
				"@on.input": send("setValue", targetValue()),
			}),
			'"',
		),
	},
	on: {
		setValue: {
			args: [t.string()],
			post: (_prev, next, [value]) => next.value === value,
			run(draft, [value]) {
				draft.value = value;
			},
		},
	},
});

// A value still to be chosen, in a new array item or object entry.
const CHOICES = {
	null: ["JsonNull", "null", TEXT.null],
	bool: ["JsonBool", "false", TEXT.bool],
	number: ["JsonNumber", "0", TEXT.number],
	string: ["JsonString", '""', TEXT.string],
	array: ["JsonArray", "[]", MONO],
	object: ["JsonObject", "{}", MONO],
};
export const JsonSelector = component({
	name: "JsonSelector",
	methods: {
		toJson() {
			return null;
		},
	},
	views: {
		main: span({ class: `${MONO} italic opacity-40` }, "…"),
		edit: span(
			{
				class: "inline-flex flex-wrap items-center gap-1",
				role: "group",
				"aria-label": "Pick a type",
			},
			...Object.entries(CHOICES).map(([type, [, label, cls]]) =>
				button(
					{
						class: `${cls} cursor-pointer rounded border border-dashed border-base-content/20 px-1 hover:border-current`,
						title: type,
						"@on.click": send("setTo", type),
					},
					label,
				),
			),
		),
	},
	on: {
		// Replaces itself with an empty value of type.
		setTo: {
			args: [t.enum(...Object.keys(CHOICES))],
			run(_draft, [type]) {
				const [name] = CHOICES[type];
				return scopeOf(this).make(name, {});
			},
		},
	},
});

// Loop state for commas: an item is last when no other follows it.
const commas = {
	prepare(items) {
		return { last: items.length - 1 };
	},
	enrich({ key }, { last }) {
		return { comma: key === last ? "" : "," };
	},
};

const removeButton = button(
	{ class: `${ACTION} text-error`, title: "Remove", "@on.click": send("removeAt", sourceKey()) },
	"×",
);
const moveButton = button(
	{ class: ACTION, title: "Move up", "@on.click": send("moveUp", sourceKey()) },
	"↑",
);

const itemRow = (...extra) =>
	div(
		{ class: "group flex items-baseline gap-1" },
		renderIt(),
		span({ class: `${MONO} ${PUNCT}` }, lookupBind("comma")),
		...extra,
	);
const collectionView = (open, close, itemsField, rowExtras, addLabel) =>
	$if(
		field("isEmpty"),
		div(
			{ class: "inline-flex items-baseline gap-1" },
			span({ class: `${MONO} ${PUNCT}` }, open + close),
			...(addLabel ? [button({ class: ADD, "@on.click": send("add") }, addLabel)] : []),
		),
		div(
			{ class: "inline-flex flex-col" },
			span({ class: `${MONO} ${PUNCT}` }, open),
			div(
				{ class: BLOCK },
				each(field(itemsField), itemRow(...rowExtras), "items"),
				...(addLabel ? [button({ class: ADD, "@on.click": send("add") }, addLabel)] : []),
			),
			span({ class: `${MONO} ${PUNCT}` }, close),
		),
	);
const moveUp = (items, key) => {
	if (key > 0) [items[key - 1], items[key]] = [items[key], items[key - 1]];
};

export const JsonArray = component({
	name: "JsonArray",
	fields: (t) => ({ items: t.array(t.component(VALUE_NAMES)) }),
	methods: {
		toJson() {
			return this.items.map((item) => item.toJson());
		},
		get isEmpty() {
			return this.items.length === 0;
		},
	},
	loops: { items: commas },
	views: {
		main: collectionView("[", "]", "items", [], null),
		edit: collectionView("[", "]", "items", [moveButton, removeButton], "+ item"),
	},
	on: {
		add: {
			args: [],
			post: (prev, next) => next.items.length === prev.items.length + 1,
			run(draft) {
				draft.items.push(scopeOf(this).make("JsonSelector", {}));
			},
		},
		removeAt: {
			args: [t.index("items")],
			post: (prev, next) => next.items.length === prev.items.length - 1,
			run(draft, [key]) {
				draft.items.splice(key, 1);
			},
		},
		moveUp: {
			args: [t.index("items")],
			run(draft, [key]) {
				moveUp(draft.items, key);
			},
		},
	},
});

export const JsonEntry = component({
	name: "JsonEntry",
	fields: (t) => ({ key: t.string(), value: t.component(VALUE_NAMES) }),
	views: {
		main: span(
			{ class: "inline-flex items-baseline gap-1" },
			span({ class: TEXT.key }, '"', field("key"), '"'),
			span({ class: `${MONO} ${PUNCT}` }, ":"),
			render(field("value")),
		),
		edit: span(
			{ class: "inline-flex items-baseline gap-1" },
			span(
				{ class: TEXT.key },
				'"',
				input({
					class: INLINE,
					"aria-label": "key",
					value: field("key"),
					"@on.input": send("setKey", targetValue()),
				}),
				'"',
			),
			span({ class: `${MONO} ${PUNCT}` }, ":"),
			render(field("value")),
		),
	},
	on: {
		setKey: {
			args: [t.string()],
			post: (_prev, next, [key]) => next.key === key,
			run(draft, [key]) {
				draft.key = key;
			},
		},
	},
});

export const JsonObject = component({
	name: "JsonObject",
	fields: (t) => ({ entries: t.array(t.component("JsonEntry")) }),
	methods: {
		// Later entries win, as in JSON.parse.
		toJson() {
			return Object.fromEntries(this.entries.map((e) => [e.key, e.value.toJson()]));
		},
		get isEmpty() {
			return this.entries.length === 0;
		},
	},
	loops: { items: commas },
	views: {
		main: collectionView("{", "}", "entries", [], null),
		edit: collectionView("{", "}", "entries", [moveButton, removeButton], "+ entry"),
	},
	on: {
		add: {
			args: [],
			post: (prev, next) => next.entries.length === prev.entries.length + 1,
			run(draft) {
				const scope = scopeOf(this);
				const key = `key${this.entries.length + 1}`;
				draft.entries.push(scope.make("JsonEntry", { key, value: scope.make("JsonSelector", {}) }));
			},
		},
		removeAt: {
			args: [t.index("entries")],
			post: (prev, next) => next.entries.length === prev.entries.length - 1,
			run(draft, [key]) {
				draft.entries.splice(key, 1);
			},
		},
		moveUp: {
			args: [t.index("entries")],
			run(draft, [key]) {
				moveUp(draft.entries, key);
			},
		},
	},
});

// A JSON document, shown read only or edited in place, with its JSON text.
export const JsonEditor = component({
	name: "JsonEditor",
	fields: (t) => ({
		value: t.component(VALUE_NAMES),
		mode: t.enum("view", "edit"),
		showText: t.boolean(),
	}),
	methods: {
		toJson() {
			return this.value.toJson();
		},
		get text() {
			return JSON.stringify(this.toJson(), null, 2);
		},
		get isEdit() {
			return this.mode === "edit";
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
						class: $if(field("isEdit"), "btn btn-xs join-item", "btn btn-xs btn-primary join-item"),
						"@on.click": send("setMode", "view"),
					},
					"View",
				),
				button(
					{
						class: $if(field("isEdit"), "btn btn-xs btn-primary join-item", "btn btn-xs join-item"),
						"@on.click": send("setMode", "edit"),
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
					"@on.change": send("setShowText", targetValue()),
				}),
				"JSON text",
			),
		),
		div({ class: "overflow-auto" }, pushView(field("mode"), render(field("value")))),
		$if(
			field("showText"),
			pre({ class: "rounded bg-base-200 p-3 font-mono text-xs" }, field("text")),
			"",
		),
	),
	on: {
		setMode: {
			args: [t.enum("view", "edit")],
			run(draft, [mode]) {
				draft.mode = mode;
			},
		},
		setShowText: {
			args: [t.boolean()],
			run(draft, [showText]) {
				draft.showText = showText;
			},
		},
	},
});

export const jsonComponents = {
	JsonNull,
	JsonBool,
	JsonNumber,
	JsonString,
	JsonSelector,
	JsonArray,
	JsonEntry,
	JsonObject,
	JsonEditor,
};

// Components for a JSON value, made with C, a scope's components.
export const fromJson = (C, v) => {
	if (v === null || v === undefined) return C.JsonNull();
	if (typeof v === "boolean") return C.JsonBool({ value: v });
	if (typeof v === "number") return C.JsonNumber({ value: v, text: String(v) });
	if (typeof v === "string") return C.JsonString({ value: v });
	if (Array.isArray(v)) return C.JsonArray({ items: v.map((x) => fromJson(C, x)) });
	const entries = Object.entries(v).map(([key, x]) => C.JsonEntry({ key, value: fromJson(C, x) }));
	return C.JsonObject({ entries });
};

// A JSON tree. Every value shows read only in its main view; the ones that can change have
// an edit view, styled like main, that edits them in place. pushView("edit", ...) above a
// tree, as JsonEditor does, switches the whole tree; values without an edit view keep main.

import { CLASSES_META, DATA_META } from "../../src/meta/index.js";
import {
	$if,
	button,
	canApply,
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
import { setField } from "../common/card.js";
import { dataDrop, jsonDropFields, jsonDropTarget } from "../common/drop.js";
import { metaFor } from "../common/meta.js";
import { applyBelow, openAllButtons } from "../common/open.js";
import { segmented } from "../common/ui.js";
import { plural } from "../common/util.js";

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
// Quotes around an input stay on its line: an input is an atomic inline, so a shrunk row
// would otherwise break before and after it.
const QUOTED = "inline-flex items-baseline whitespace-nowrap";
const ACTION =
	"cursor-pointer rounded px-1 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 focus:opacity-100";
const ADD = "cursor-pointer self-start rounded px-1 font-mono text-xs opacity-50 hover:opacity-100";
const BLOCK = "ml-1 flex flex-col border-l border-base-content/15 pl-4";

const { div, input, label, pre, span } = tag;

// The messages that change a value say so to what's above, with jsonEdited, once they ran: a
// schema editor reads its schema again, and the editors around a value stop it.
const edits = (on, names) => {
	const out = { ...on };
	for (const name of names) {
		const h = on[name];
		out[name] = {
			...h,
			emits: { notify: ["jsonEdited"] },
			run(next, args, ctx) {
				const result = h.run.call(this, next, args, ctx);
				ctx.notify("jsonEdited");
				return result;
			},
		};
	}
	return out;
};

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
	fields: { value: t.boolean() },
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
				"on:click": send("toggle"),
			},
			$if(field("value"), "true", "false"),
		),
	},
	on: edits(
		{
			toggle: {
				args: [],
				post: (prev, next) => next.value === !prev.value,
				run(next) {
					next.value = !this.value;
				},
			},
		},
		["toggle"],
	),
});

// text is what the user typed; value follows it whenever it reads as a number.
const asNumber = (text) => (text.trim() === "" ? Number.NaN : Number(text));
export const JsonNumber = component({
	name: "JsonNumber",
	// What textClass can be.
	meta: { [CLASSES_META]: { classes: `${TEXT.number} ${INLINE} text-error` } },
	fields: { value: t.number(), text: t.string("0") },
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
	},
	queries: {
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
			"on:input": send("setText", targetValue()),
		}),
	},
	on: edits(
		{
			setText: {
				args: [t.string()],
				post: (_prev, next, [text]) => next.text === text,
				run(next, [text]) {
					next.text = text;
					const n = asNumber(text);
					if (Number.isFinite(n)) next.value = n;
				},
			},
		},
		["setText"],
	),
});

export const JsonString = component({
	name: "JsonString",
	fields: { value: t.string() },
	methods: {
		toJson() {
			return this.value;
		},
	},
	views: {
		main: span({ class: TEXT.string }, '"', field("value"), '"'),
		edit: span(
			{ class: `${TEXT.string} ${QUOTED}` },
			'"',
			input({
				class: INLINE,
				"aria-label": "string value",
				value: field("value"),
				"on:input": send("setValue", targetValue()),
			}),
			'"',
		),
	},
	on: edits(
		{
			setValue: {
				args: [t.string()],
				post: (_prev, next, [value]) => next.value === value,
				run(next, [value]) {
					next.value = value;
				},
			},
		},
		["setValue"],
	),
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
						"on:click": send("setTo", type),
					},
					label,
				),
			),
		),
	},
	on: edits(
		{
			// Replaces itself with an empty value of type.
			setTo: {
				args: [t.enum(...Object.keys(CHOICES))],
				run(_next, [type], ctx) {
					const [name] = CHOICES[type];
					return ctx.scope.make(name, {});
				},
			},
		},
		["setTo"],
	),
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
	{ class: `${ACTION} text-error`, title: "Remove", "on:click": send("removeAt", sourceKey()) },
	"×",
);
const moveButton = button(
	{ class: ACTION, title: "Move up", "on:click": send("moveUp", sourceKey()) },
	"↑",
);

const itemRow = (...extra) =>
	div(
		{ class: "group flex items-baseline gap-1" },
		renderIt(),
		span({ class: `${MONO} ${PUNCT}` }, lookupBind("comma")),
		...extra,
	);
// The open bracket toggles the collection; closed, it reads as open…close and how many.
const TOGGLE = `${MONO} ${PUNCT} cursor-pointer hover:opacity-100`;
const collectionView = (open, close, itemsField, rowExtras, addLabel) =>
	$if(
		field("isEmpty"),
		div(
			{ class: "inline-flex items-baseline gap-1" },
			span({ class: `${MONO} ${PUNCT}` }, open + close),
			...(addLabel ? [button({ class: ADD, "on:click": send("add") }, addLabel)] : []),
		),
		$if(
			field("open"),
			div(
				{ class: "inline-flex flex-col" },
				button(
					{
						class: `${TOGGLE} self-start json-toggle`,
						title: "Collapse",
						"on:click": send("toggle"),
					},
					open,
				),
				div(
					{ class: BLOCK },
					each(field(itemsField), itemRow(...rowExtras), "items"),
					...(addLabel ? [button({ class: ADD, "on:click": send("add") }, addLabel)] : []),
				),
				span({ class: `${MONO} ${PUNCT}` }, close),
			),
			span(
				{ class: "inline-flex items-baseline gap-1" },
				button(
					{ class: `${TOGGLE} json-toggle`, title: "Expand", "on:click": send("toggle") },
					`${open}…${close}`,
				),
				span({ class: "font-mono text-xs opacity-40" }, field("summary")),
			),
		),
	);
const moveUp = (items, key) => {
	if (key > 0) [items[key - 1], items[key]] = [items[key], items[key - 1]];
};

// Opening and closing: setOpenDeep reaches every collection below, through entries.
const passOpenDeep = (key) => ({
	setOpenDeep: {
		pure: true,
		args: [t.boolean()],
		run(next, [open]) {
			applyBelow(next, [key], "setOpenDeep", open);
		},
	},
});
const openable = (key) => ({
	toggle: {
		args: [],
		run(next) {
			next.open = !this.open;
		},
	},
	setOpen: {
		pure: true,
		args: [t.boolean()],
		post: (_prev, next, [open]) => next.open === open,
		run(next, [open]) {
			next.open = open;
		},
	},
	setOpenDeep: {
		pure: true,
		args: [t.boolean()],
		run(next, [open]) {
			next.open = open;
			applyBelow(next, [key], "setOpenDeep", open);
		},
	},
});

export const JsonArray = component({
	name: "JsonArray",
	fields: { items: t.array(t.component(VALUE_NAMES)), open: t.boolean(true) },
	methods: {
		toJson() {
			return this.items.map((item) => item.toJson());
		},
	},
	queries: {
		get isEmpty() {
			return this.items.length === 0;
		},
		get summary() {
			return plural(this.items.length, "item");
		},
	},
	loops: { items: commas },
	views: {
		main: collectionView("[", "]", "items", [], null),
		edit: collectionView("[", "]", "items", [moveButton, removeButton], "+ item"),
	},
	on: edits(
		{
			...openable("items"),
			add: {
				args: [],
				post: (prev, next) => next.items.length === prev.items.length + 1,
				run(next, _args, ctx) {
					next.items.push(ctx.scope.make("JsonSelector", {}));
				},
			},
			removeAt: {
				args: [t.index("items")],
				post: (prev, next) => next.items.length === prev.items.length - 1,
				run(next, [key]) {
					next.items.splice(key, 1);
				},
			},
			moveUp: {
				args: [t.index("items")],
				run(next, [key]) {
					moveUp(next.items, key);
				},
			},
		},
		["add", "removeAt", "moveUp"],
	),
});

export const JsonEntry = component({
	name: "JsonEntry",
	fields: { key: t.string(), value: t.component(VALUE_NAMES) },
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
				{ class: `${TEXT.key} ${QUOTED}` },
				'"',
				input({
					class: INLINE,
					"aria-label": "key",
					value: field("key"),
					"on:input": send("setKey", targetValue()),
				}),
				'"',
			),
			span({ class: `${MONO} ${PUNCT}` }, ":"),
			render(field("value")),
		),
	},
	on: edits(
		{
			...passOpenDeep("value"),
			setKey: {
				args: [t.string()],
				post: (_prev, next, [key]) => next.key === key,
				run(next, [key]) {
					next.key = key;
				},
			},
		},
		["setKey"],
	),
});

export const JsonObject = component({
	name: "JsonObject",
	fields: { entries: t.array(t.component("JsonEntry")), open: t.boolean(true) },
	methods: {
		// Later entries win, as in JSON.parse.
		toJson() {
			return Object.fromEntries(this.entries.map((e) => [e.key, e.value.toJson()]));
		},
	},
	queries: {
		get isEmpty() {
			return this.entries.length === 0;
		},
		get summary() {
			return plural(this.entries.length, "key");
		},
	},
	loops: { items: commas },
	views: {
		main: collectionView("{", "}", "entries", [], null),
		edit: collectionView("{", "}", "entries", [moveButton, removeButton], "+ entry"),
	},
	on: edits(
		{
			...openable("entries"),
			add: {
				args: [],
				post: (prev, next) => next.entries.length === prev.entries.length + 1,
				run(next, _args, ctx) {
					const scope = ctx.scope;
					const key = `key${this.entries.length + 1}`;
					next.entries.push(
						scope.make("JsonEntry", { key, value: scope.make("JsonSelector", {}) }),
					);
				},
			},
			removeAt: {
				args: [t.index("entries")],
				post: (prev, next) => next.entries.length === prev.entries.length - 1,
				run(next, [key]) {
					next.entries.splice(key, 1);
				},
			},
			moveUp: {
				args: [t.index("entries")],
				run(next, [key]) {
					moveUp(next.entries, key);
				},
			},
		},
		["add", "removeAt", "moveUp"],
	),
});

// A JSON value with expand all and collapse all above it. It renders its value in the view
// pushed from above, so an edit view above edits the value.
// With allowDrop on, a JSON file dropped on it replaces its value.
const jsonRootView = () =>
	jsonDropTarget(() =>
		div(
			{ class: "flex flex-col gap-1 json-root" },
			$if(
				field("isCollection"),
				div(
					{ class: "flex items-center gap-1 border-b border-base-300 pb-1" },
					...openAllButtons(),
				),
				null,
			),
			div({ class: "overflow-auto" }, render(field("value"))),
		),
	);
// A dropped file's JSON replaces the value, and says so like an edit.
const rootDrop = dataDrop({ after: (_next, ctx) => ctx.notify("jsonEdited") });
export const JsonRoot = component({
	name: "JsonRoot",
	meta: { [DATA_META]: { load: "load", data: "json" } },
	fields: { value: t.component(VALUE_NAMES), ...jsonDropFields() },
	methods: {
		toJson() {
			return this.value.toJson();
		},
	},
	queries: {
		// Only arrays and objects open and close.
		get isCollection() {
			return canApply(this.value, "setOpen");
		},
		// The value as JSON, what load takes back.
		get json() {
			return this.value.toJson();
		},
		get hasDropError() {
			return this.dropError !== "";
		},
	},
	view: jsonRootView(),
	views: { edit: jsonRootView() },
	on: {
		...passOpenDeep("value"),
		// Passed on, to what holds the root.
		jsonEdited: { args: [], run() {} },
		// Any JSON replaces the value.
		load: {
			pure: true,
			args: [t.any()],
			run(next, [json]) {
				next.value = fromJson(scopeOf(this).components, json);
			},
		},
		...rootDrop.on,
	},
	answers: rootDrop.answers,
});

// A JSON document, shown read only or edited in place, with its JSON text.
export const JsonEditor = component({
	name: "JsonEditor",
	meta: metaFor("JSON", "{}", "A JSON value, viewed or edited in place, with its text."),
	fields: {
		value: t.component(VALUE_NAMES),
		mode: t.enum("view", "edit"),
		showText: t.boolean(),
	},
	methods: {
		toJson() {
			return this.value.toJson();
		},
	},
	queries: {
		get text() {
			return JSON.stringify(this.toJson(), null, 2);
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get isView() {
			return this.mode === "view";
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			segmented("Mode", "setMode", [
				["view", "View", "isView"],
				["edit", "Edit", "isEdit"],
			]),
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
			...openAllButtons(),
		),
		div({ class: "overflow-auto" }, pushView(field("mode"), render(field("value")))),
		$if(
			field("showText"),
			pre({ class: "rounded bg-base-200 p-3 font-mono text-xs" }, field("text")),
			"",
		),
	),
	on: {
		...passOpenDeep("value"),
		// Its text follows by itself: nothing above needs to know.
		jsonEdited: {
			args: [],
			run(_next, _args, ctx) {
				ctx.stopNext();
			},
		},
		setMode: setField("mode", t.enum("view", "edit")),
		setShowText: setField("showText", t.boolean()),
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
	JsonRoot,
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

// A JsonRoot for a JSON value, made with C; allowDrop lets a dropped JSON file replace it.
export const jsonRoot = (C, v, { allowDrop = false } = {}) =>
	C.JsonRoot({ value: fromJson(C, v), allowDrop });
// A JsonRoot of v that takes dropped JSON files.
export const droppableJson = (C, v) => jsonRoot(C, v, { allowDrop: true });

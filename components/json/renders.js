// What a JSON tree renders besides its views (the Renders demo shows them): renders.js is the
// code that makes the tree in its state (C.JsonObject({ entries: [...], open: true })), renders.md as nested lists, renders.tui as an indented tree in
// a terminal, and the root's renders.llmContext the value as data. Each value's render is its
// own, put where its collection's render says, as its views are; recursion is render and
// renderIt. The edit views have tui ones too: pushView("edit", ...) above a tree edits it in a
// terminal as on the page. Each value says its md three ways, by view name: main (a block),
// inline (in an entry's line) and row (an array's list item).

import { js, jsTarget } from "../../src/jsast/target.js";
import { llmContext, llmContextTarget } from "../../src/llm/target.js";
import { md, mdTarget } from "../../src/mdast/target.js";
import { tuiTarget } from "../../src/tui/target.js";
import {
	$if,
	each,
	enableTargets,
	field,
	pushView,
	render,
	renderIt,
	send,
	sourceKey,
	tag,
	targetValue,
} from "../../src/tutuca.js";

enableTargets(tuiTarget, jsTarget, mdTarget, llmContextTarget);

const { box, input, text } = tag;
const { ArrayExpression, CallExpression, Identifier, Literal, MemberExpression } = js;
const { ObjectExpression, Property, UnaryExpression } = js;
const {
	argument,
	arguments: args,
	callee,
	elements,
	key,
	object,
	properties,
	property,
	value,
} = js;
const { Code, Emphasis, InlineCode, List, ListItem, Paragraph, Root } = md;
const { Data, Fact, Section } = llmContext;

// C.Name({ field: value, ... }): the code that makes a component in a state, with a scope's
// components, as a story's make does.
const make = (name, ...props) =>
	CallExpression(
		callee(MemberExpression(object(Identifier({ name: "C" })), property(Identifier({ name })))),
		args(ObjectExpression(properties(...props))),
	);
const prop = (name, node) => Property({ kind: "init" }, key(Identifier({ name })), value(node));
// A field that's a string or a boolean.
const literal = (name) => prop(name, Literal({ value: field(name) }));
// A field that's a component: its own code.
const child = (name) => prop(name, render(field(name)));
// A field that's an array of components.
const children = (name) => prop(name, ArrayExpression(elements(each(field(name), renderIt()))));

// Terminal colors, as the page's TEXT classes.
const COLOR = { null: "yellow", bool: "magenta", number: "cyan", string: "green", key: "blue" };
const focusable = (attrs, ...children) => box({ focusable: "true", ...attrs }, ...children);

// A scalar's md: the same inline code, as a block, in an entry's line and as a list item.
const scalarMd = (inline) => ({
	main: Paragraph(inline),
	inline,
	row: ListItem(Paragraph(inline)),
});

export const nullRenders = {
	tui: text({ color: COLOR.null }, "null"),
	js: make("JsonNull"),
	md: scalarMd(InlineCode("null")),
};

const boolText = $if(field("value"), "true", "false");
export const boolRenders = {
	tui: {
		main: text({ color: COLOR.bool }, boolText),
		edit: focusable({ color: COLOR.bool, underline: "true", "on:click": send("toggle") }, boolText),
	},
	js: make("JsonBool", literal("value")),
	md: scalarMd(InlineCode(boolText)),
};

export const numberRenders = {
	tui: {
		main: text({ color: COLOR.number }, field("value")),
		// Red while what's typed isn't a number.
		edit: input({
			color: field("textColor"),
			width: field("inputWidth"),
			value: field("text"),
			"on:input": send("setText", targetValue()),
		}),
	},
	// A negative number is a minus before a positive literal. Its text is what's typed.
	js: make(
		"JsonNumber",
		prop(
			"value",
			$if(
				field("isNegative"),
				UnaryExpression({ operator: "-" }, argument(Literal({ value: field("magnitude") }))),
				Literal({ value: field("value") }),
			),
		),
		literal("text"),
	),
	md: scalarMd(InlineCode(field("value"))),
};

export const stringRenders = {
	tui: {
		main: text({ color: COLOR.string }, '"', field("value"), '"'),
		edit: box(
			{ flexDirection: "row", color: COLOR.string },
			'"',
			input({
				width: field("inputWidth"),
				value: field("value"),
				"on:input": send("setValue", targetValue()),
			}),
			'"',
		),
	},
	js: make("JsonString", literal("value")),
	md: scalarMd(InlineCode(field("quoted"))),
};

// What a new item can become, as the page's choices.
const CHOICES = [
	["null", "null", COLOR.null],
	["bool", "false", COLOR.bool],
	["number", "0", COLOR.number],
	["string", '""', COLOR.string],
	["array", "[]", undefined],
	["object", "{}", undefined],
];
const notChosen = Emphasis("not chosen yet");
export const selectorRenders = {
	tui: {
		main: text({ dim: "true", italic: "true" }, "…"),
		edit: box(
			{ flexDirection: "row", gap: "1" },
			...CHOICES.map(([type, label, color]) =>
				focusable({ color, "on:click": send("setTo", type) }, `[${label}]`),
			),
		),
	},
	js: make("JsonSelector"),
	md: { main: Paragraph(notChosen), inline: notChosen, row: ListItem(Paragraph(notChosen)) },
};

// An array's or object's terminal tree, in three parts an entry puts around its key: the head
// (the open bracket, which toggles it; closed, open…close and how many), the body (its items
// indented, each in the view pushed above, with ↑ and × in edit) and the tail (the close
// bracket, when it's open). Its main and edit views are the three under each other.
const collectionTui = (open, close, itemsField) => {
	const head = $if(
		field("isEmpty"),
		text({ dim: "true" }, open + close),
		$if(
			field("open"),
			focusable({ "on:click": send("toggle") }, open),
			box(
				{ flexDirection: "row", gap: "1" },
				focusable({ "on:click": send("toggle") }, `${open}…${close}`),
				text({ dim: "true" }, field("summary")),
			),
		),
	);
	const add = focusable({ dim: "true", "on:click": send("add") }, "+ add");
	const body = (editing) => {
		const extras = editing
			? [
					focusable({ dim: "true", "on:click": send("moveUp", sourceKey()) }, "↑"),
					focusable({ color: "red", "on:click": send("removeAt", sourceKey()) }, "×"),
				]
			: [];
		const rows = $if(
			field("open"),
			each(field(itemsField), box({ flexDirection: "row", gap: "1" }, renderIt(), ...extras)),
			null,
		);
		return box({ paddingLeft: "2" }, rows, ...(editing ? [$if(field("open"), add, null)] : []));
	};
	const tail = $if(field("isOpenWithItems"), text({}, close), null);
	// Empty, edit adds beside its brackets; open, below its items.
	const whole = (editing) =>
		box(
			{},
			editing
				? $if(field("isEmpty"), box({ flexDirection: "row", gap: "1" }, head, add), head)
				: head,
			$if(field("isOpenWithItems"), box({}, body(editing), tail), null),
		);
	return {
		main: whole(false),
		edit: whole(true),
		head,
		body: body(false),
		editBody: body(true),
		tail,
	};
};

// A collection's md: a list of its rows, or its brackets when it's empty; inline, how many it
// holds; as a row, that and its list under it.
const collectionMd = (empty, list) => {
	const inline = $if(field("isEmpty"), InlineCode(empty), Emphasis(field("summary")));
	return {
		main: $if(field("isEmpty"), Paragraph(InlineCode(empty)), list),
		inline,
		row: ListItem(Paragraph(inline), $if(field("isEmpty"), null, list)),
	};
};

export const arrayRenders = {
	tui: collectionTui("[", "]", "items"),
	js: make("JsonArray", children("items"), literal("open")),
	// Numbered from 0, as its indexes are.
	md: collectionMd("[]", List({ ordered: true, start: 0 }, each(field("items"), renderIt("row")))),
};

export const objectRenders = {
	tui: collectionTui("{", "}", "entries"),
	js: make("JsonObject", children("entries"), literal("open")),
	md: collectionMd("{}", List(each(field("entries"), renderIt()))),
};

// An entry's key, and its value beside it; an open array or object's items go under its key,
// its close bracket under them, as JSON is indented.
const entryTui = (keyNode, bodyView) =>
	$if(
		field("valueOpens"),
		box(
			{},
			box({ flexDirection: "row" }, keyNode, render(field("value"), "head")),
			render(field("value"), bodyView),
			render(field("value"), "tail"),
		),
		box({ flexDirection: "row" }, keyNode, render(field("value"))),
	);
const keyTui = (keyNode) =>
	box(
		{ flexDirection: "row", color: COLOR.key },
		'"',
		keyNode,
		'"',
		text({ dim: "true", color: "white" }, ": "),
	);
export const entryRenders = {
	tui: {
		main: entryTui(keyTui(field("key")), "body"),
		edit: entryTui(
			keyTui(
				input({
					width: field("inputWidth"),
					value: field("key"),
					"on:input": send("setKey", targetValue()),
				}),
			),
			"editBody",
		),
	},
	js: make("JsonEntry", literal("key"), child("value")),
	// Its key and, on the same line, its value inline; an array or object's rows go under it.
	md: ListItem(
		Paragraph(InlineCode(field("key")), ": ", render(field("value"), "inline")),
		$if(field("nests"), render(field("value")), null),
	),
};

const valueContext = (title) => Section(title, Data(field("json")));

export const rootRenders = {
	tui: box(
		{},
		$if(
			field("isCollection"),
			box(
				{ flexDirection: "row", gap: "1" },
				focusable({ dim: "true", "on:click": send("setOpenDeep", true) }, "[expand all]"),
				focusable({ dim: "true", "on:click": send("setOpenDeep", false) }, "[collapse all]"),
			),
			null,
		),
		render(field("value")),
	),
	js: make(
		"JsonRoot",
		child("value"),
		literal("allowDrop"),
		literal("dropName"),
		literal("dropError"),
	),
	md: Root(render(field("value"))),
	llmContext: valueContext("JSON value"),
};

const modeBox = (mode, label, isOn) =>
	focusable({ bold: field(isOn), inverse: field(isOn), "on:click": send("setMode", mode) }, label);
export const editorRenders = {
	// The mode is pushed as the view: in edit, every value that has an edit view edits.
	tui: box(
		{ gap: "1" },
		box(
			{ flexDirection: "row", gap: "1" },
			modeBox("view", " View ", "isView"),
			modeBox("edit", " Edit ", "isEdit"),
			$if(
				field("showText"),
				focusable({ dim: "true", "on:click": send("setShowText", false) }, "[hide text]"),
				focusable({ dim: "true", "on:click": send("setShowText", true) }, "[show text]"),
			),
		),
		pushView(field("mode"), render(field("value"))),
		$if(field("showText"), text({ dim: "true" }, field("text")), null),
	),
	js: make("JsonEditor", child("value"), literal("mode"), literal("showText")),
	md: Root(
		render(field("value")),
		$if(field("showText"), Code({ lang: "json" }, field("text")), null),
	),
	llmContext: Section("JSON document", Fact("Mode", field("mode")), Data(field("json"))),
};

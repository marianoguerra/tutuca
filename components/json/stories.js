import { book, step } from "../../src/storybook/index.js";
import { fromJson, jsonComponents } from "./index.js";

const sample = {
	name: "tutuca",
	version: 1.5,
	private: true,
	keywords: ["ui", "immutable"],
	repository: null,
	scripts: { test: "node --test" },
};

const edit = (C, value) => C.JsonEditor({ mode: "edit", value });
// Path builders from the editor root.
const atValue = (b) => b.field("value");
const atItem = (i) => (b) => b.field("value").item("items", i);
const toJsonIs = (expected) => (s) => JSON.stringify(s.toJson()) === JSON.stringify(expected);

const valueMessages = [
	"JsonBool.toggle",
	"JsonNumber.setText",
	"JsonString.setValue",
	"JsonSelector.setTo",
	"JsonArray.add",
	"JsonArray.removeAt",
	"JsonArray.moveUp",
	"JsonEntry.setKey",
	"JsonObject.add",
	"JsonObject.removeAt",
	"JsonObject.moveUp",
];

export default book({
	title: "JSON",
	components: jsonComponents,
	stories: {
		Null: { make: (C) => C.JsonNull() },
		Bool: { make: (C) => C.JsonBool({ value: true }) },
		"Bool (edit)": {
			make: (C) => edit(C, C.JsonBool()),
			sequences: {
				toggle: [
					step.event("click", '[aria-label="boolean value"]'),
					step.check("true", toJsonIs(true)),
					step.send("toggle", [], { to: atValue }),
					step.check("false again", toJsonIs(false)),
				],
			},
			stress: { events: true, maxCommands: 8 },
		},
		Number: { make: (C) => C.JsonNumber({ value: 42, text: "42" }) },
		"Number (edit)": {
			make: (C) => edit(C, C.JsonNumber({ value: 42, text: "42" })),
			sequences: {
				"type a number, then text that isn't one": [
					step.event("input", '[aria-label="number value"]', { value: "3.14" }),
					step.check("3.14", toJsonIs(3.14)),
					step.event("input", '[aria-label="number value"]', { value: "3.14x" }),
					step.check("keeps the last number", toJsonIs(3.14)),
				],
			},
			stress: { events: true, maxCommands: 8 },
		},
		String: { make: (C) => C.JsonString({ value: "hello" }) },
		"String (edit)": {
			make: (C) => edit(C, C.JsonString({ value: "hello" })),
			sequences: {
				type: [
					step.event("input", '[aria-label="string value"]', { value: "tutuca" }),
					step.check("tutuca", toJsonIs("tutuca")),
				],
			},
			stress: { events: true, maxCommands: 8 },
		},
		"Selector (edit)": {
			make: (C) => edit(C, C.JsonSelector()),
			sequences: {
				"pick a string": [
					step.event("click", '[title="string"]'),
					step.check("an empty string", toJsonIs("")),
				],
			},
		},
		Array: { make: (C) => fromJson(C, [1, "two", false, null, [3]]) },
		"Empty array (edit)": {
			make: (C) => edit(C, C.JsonArray()),
			sequences: {
				"build [true, 5]": [
					step.send("add", [], { to: atValue }),
					step.send("setTo", ["bool"], { to: atItem(0) }),
					step.send("toggle", [], { to: atItem(0) }),
					step.send("add", [], { to: atValue }),
					step.send("setTo", ["number"], { to: atItem(1) }),
					step.send("setText", ["5"], { to: atItem(1) }),
					step.check("[true, 5]", toJsonIs([true, 5])),
					step.send("moveUp", [1], { to: atValue }),
					step.check("[5, true]", toJsonIs([5, true])),
					step.send("removeAt", [0], { to: atValue }),
					step.check("[true]", toJsonIs([true])),
				],
			},
			stress: { include: valueMessages, maxCommands: 15 },
		},
		Object: { make: (C) => fromJson(C, sample) },
		"Object (edit)": {
			make: (C) => edit(C, fromJson(C, { a: 1 })),
			sequences: {
				"add and rename an entry": [
					step.event("click", "button[class*='cursor-pointer self-start']"),
					step.send("setKey", ["b"], { to: (b) => b.field("value").item("entries", 1) }),
					step.send("setTo", ["string"], {
						to: (b) => b.field("value").item("entries", 1).field("value"),
					}),
					step.check("{ a: 1, b: '' }", toJsonIs({ a: 1, b: "" })),
				],
			},
			stress: { include: valueMessages, maxCommands: 15 },
		},
		Document: {
			make: (C) => C.JsonEditor({ value: fromJson(C, sample), showText: true }),
			sequences: {
				"switch to edit": [
					step.event("click", "button:nth-of-type(2)"),
					step.check("edit mode", (s) => s.mode === "edit"),
					step.event("input", '[aria-label="key"]', { value: "title" }),
					step.check("renamed", (s) => "title" in s.toJson()),
				],
			},
			stress: { events: true, maxCommands: 10 },
		},
		"Drop a JSON file": {
			make: (C) => C.JsonRoot({ value: fromJson(C, { a: 1 }), allowDrop: true }),
			sequences: {
				"a dropped file replaces the value": [
					step.answer("readText", "ok", '[1, { "b": true }]'),
					step.check("the dropped JSON", toJsonIs([1, { b: true }])),
					step.check("no error", (s) => !s.hasDropError),
				],
				"a dropped file that isn't JSON is refused": [
					step.answer("readText", "ok", "not json"),
					step.check("the error shown", (s) => s.hasDropError),
					step.check("the value kept", toJsonIs({ a: 1 })),
				],
				"a failed read is shown": [
					step.answer("readText", "error", new Error("gone")),
					step.check("the error shown", (s) => s.hasDropError),
				],
			},
		},
		"Drop off by default": {
			make: (C) => C.JsonRoot({ value: fromJson(C, { a: 1 }) }),
			sequences: {
				"a drop does nothing": [
					step.send("dropFile", []),
					step.check("not allowed", (s) => !s.allowDrop && !s.hasDropError),
					step.check("the value kept", toJsonIs({ a: 1 })),
				],
			},
		},
		"Generated document": {
			arbitrary: (A) => A.instance("JsonEditor"),
			stress: { include: valueMessages, maxCommands: 10 },
		},
	},
});

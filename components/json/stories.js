import { step, stories } from "../../src/storybook/index.js";
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

export default stories({
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
					step.send("toggle", [], { at: atValue }),
					step.check("false again", toJsonIs(false)),
				],
			},
			pbt: { events: true, maxCommands: 8 },
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
			pbt: { events: true, maxCommands: 8 },
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
			pbt: { events: true, maxCommands: 8 },
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
					step.send("add", [], { at: atValue }),
					step.send("setTo", ["bool"], { at: atItem(0) }),
					step.send("toggle", [], { at: atItem(0) }),
					step.send("add", [], { at: atValue }),
					step.send("setTo", ["number"], { at: atItem(1) }),
					step.send("setText", ["5"], { at: atItem(1) }),
					step.check("[true, 5]", toJsonIs([true, 5])),
					step.send("moveUp", [1], { at: atValue }),
					step.check("[5, true]", toJsonIs([5, true])),
					step.send("removeAt", [0], { at: atValue }),
					step.check("[true]", toJsonIs([true])),
				],
			},
			pbt: { include: valueMessages, maxCommands: 15 },
		},
		Object: { make: (C) => fromJson(C, sample) },
		"Object (edit)": {
			make: (C) => edit(C, fromJson(C, { a: 1 })),
			sequences: {
				"add and rename an entry": [
					step.event("click", "button[class*='cursor-pointer self-start']"),
					step.send("setKey", ["b"], { at: (b) => b.field("value").item("entries", 1) }),
					step.send("setTo", ["string"], {
						at: (b) => b.field("value").item("entries", 1).field("value"),
					}),
					step.check("{ a: 1, b: '' }", toJsonIs({ a: 1, b: "" })),
				],
			},
			pbt: { include: valueMessages, maxCommands: 15 },
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
			pbt: { events: true, maxCommands: 10 },
		},
		"Generated document": {
			arbitrary: (A) => A.instance("JsonEditor"),
			pbt: { include: valueMessages, maxCommands: 10 },
		},
	},
});

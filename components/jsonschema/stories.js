import { step, stories } from "../../src/storybook/index.js";
import { scopeOf } from "../../src/tutuca.js";
import { jsonComponents } from "../json/index.js";
import { allOpen, schemaComponents } from "./index.js";
import { fromSchema, schemaTree } from "./read.js";
import { studio, studioComponents } from "./studio.js";

// A schema that uses most of what the family models.
export const sample = {
	title: "Episode",
	description: "One entry of a podcast feed.",
	type: "object",
	required: ["id", "title"],
	properties: {
		id: { type: "string", format: "uuid" },
		title: { type: "string", minLength: 1, maxLength: 200 },
		durationSeconds: { type: "integer", minimum: 0 },
		rating: { type: "number", minimum: 0, maximum: 5 },
		explicit: { type: "boolean" },
		notes: { type: ["string", "null"] },
		kind: { enum: ["full", "trailer", "bonus"] },
		version: { const: 2 },
		tags: { type: "array", items: { type: "string" }, maxItems: 10 },
		author: { $ref: "#/$defs/person" },
	},
	additionalProperties: false,
};

const nested = {
	type: "object",
	properties: {
		a: {
			type: "object",
			properties: {
				b: { type: "object", properties: { c: { type: "string" } } },
				d: { type: "array", items: { type: "integer" } },
			},
		},
		e: { anyOf: [{ type: "string" }, { type: "object", properties: { f: { type: "null" } } }] },
	},
};

const wide = (n) => ({
	type: "object",
	properties: Object.fromEntries(
		Array.from({ length: n }, (_, i) => [`field${i}`, { type: "string" }]),
	),
});

const tree = (schema, options) => (C) => schemaTree(C, schema, options);
// Path builders from the root.
const atNode = (b) => b.field("node");
const atProp = (i) => (b) => b.field("node").item("properties", i).field("schema");
const atPager = (b) => b.field("node").field("pager");
// JSON text with sorted keys, to compare schemas whatever their key order.
const canonical = (v) =>
	JSON.stringify(v, (_k, x) =>
		x !== null && typeof x === "object" && !Array.isArray(x)
			? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
			: x,
	);
const roundTrips = (expected) => (s) => canonical(s.toSchema()) === canonical(expected);
// Reading back is lossy, but reading what was read back changes nothing.
const fixedPoint = (s) => {
	const once = s.toSchema();
	return canonical(fromSchema(scopeOf(s).components, once).toSchema()) === canonical(once);
};
const opens = (s) => allOpen(s.node);

const messages = [
	"SchemaRoot.setView",
	"SchemaRoot.setOpenDeep",
	"SchemaObject.toggle",
	"SchemaObject.setOpen",
	"SchemaObject.setOpenDeep",
	"SchemaObject.openSiblings",
	"SchemaProperty.setOpen",
	"SchemaArray.toggle",
	"SchemaArray.setOpen",
	"SchemaEnum.toggle",
	"SchemaAnyOf.toggle",
	"SchemaAnyOf.openSiblings",
	"SchemaPager.next",
	"SchemaPager.prev",
	"SchemaPager.last",
	"SchemaPager.setPerPage",
	"SchemaPager.showAll",
];
const pagerMessages = messages.filter((m) => m.startsWith("SchemaPager."));

// One story per kind, in both readings.
const leaf = (schema) => ({
	make: tree(schema),
	sequences: {
		"read it as its keywords": [
			step.event("click", ".view-format"),
			step.check("format view", (s) => s.view === "format"),
			step.check("reads back to a fixed point", fixedPoint),
		],
	},
});

export default stories({
	title: "JSON Schema",
	components: { ...jsonComponents, ...schemaComponents },
	stories: {
		Episode: {
			make: tree(sample),
			sequences: {
				"collapse and expand everything": [
					step.event("click", ".collapse-all"),
					step.check("all closed", (s) => opens(s).every((o) => !o)),
					step.event("click", ".expand-all"),
					step.check("all open", (s) => opens(s).every((o) => o)),
				],
				"close a node": [
					step.event("click", ".disclosure"),
					step.check("the object closed", (s) => !s.node.open),
					step.send("toggle", [], { at: atNode }),
					step.check("and open again", (s) => s.node.open),
				],
				"read it as keywords": [
					step.send("setView", ["format"]),
					step.check("format", (s) => s.view === "format"),
					step.event("click", ".view-semantic"),
					step.check("semantic again", (s) => s.view === "main"),
				],
				"read the schema back": [step.check("same schema", roundTrips(sample))],
			},
			pbt: { include: messages, maxCommands: 12 },
		},
		"Episode (format)": {
			make: tree(sample, { view: "format" }),
			pbt: { events: true, maxCommands: 10 },
		},
		Collapsed: {
			make: tree(sample, { open: false }),
			sequences: {
				"open one node": [
					step.event("click", ".disclosure"),
					step.check("the object opened", (s) => s.node.open),
					step.check("the array below stays closed", (s) => !s.node.properties[8].schema.open),
				],
			},
		},
		Nested: {
			make: tree(nested),
			sequences: {
				"ctrl: close a node and its siblings": [
					// What a ctrl click on a's disclosure raises.
					step.send("openSiblings", [false], { at: atNode }),
					step.check("a and e closed", (s) => s.node.properties.every((p) => !p.schema.open)),
					step.check(
						"the nodes below did not",
						(s) => s.node.properties[0].schema.properties[0].schema.open,
					),
				],
				"ctrl+alt: close a node and everything below": [
					step.send("setOpenDeep", [false], { at: atProp(0) }),
					step.check("a and below closed", (s) =>
						allOpen(s.node.properties[0].schema).every((o) => !o),
					),
					step.check("e did not", (s) => s.node.properties[1].schema.open),
				],
			},
			pbt: { include: messages, maxCommands: 12 },
		},
		String: leaf({
			type: "string",
			format: "email",
			pattern: "^.+@.+$",
			minLength: 3,
			maxLength: 254,
		}),
		Number: leaf({ type: "number", minimum: -1.5, maximum: 1.5, multipleOf: 0.5 }),
		Integer: leaf({ type: "integer", minimum: 0 }),
		Boolean: leaf({ type: "boolean", title: "Explicit", description: "Has explicit content." }),
		Null: leaf({ type: "null" }),
		Union: leaf({ type: ["string", "number", "null"] }),
		Enum: leaf({ enum: ["a", 1, null, true] }),
		Const: leaf({ const: { kind: "fixed" } }),
		Ref: leaf({ $ref: "#/$defs/person" }),
		AllOf: leaf({ allOf: [{ type: "object" }, { required: ["id"] }] }),
		AnyOf: leaf({ anyOf: [{ type: "string" }, { type: "number" }] }),
		OneOf: leaf({ oneOf: [{ const: "a" }, { const: "b" }] }),
		Not: leaf({ not: { type: "string" } }),
		"True, which allows anything": { make: tree(true) },
		"False, which allows nothing": leaf(false),
		"An empty object, which also allows anything": leaf({}),
		"An object with no properties": { make: tree({ type: "object" }) },
		"An array with no items schema": { make: tree({ type: "array" }) },
		"A type inferred from its keywords": { make: tree({ properties: { a: { type: "string" } } }) },
		"A wide object, paginated": {
			make: tree(wide(120), { perPage: 10 }),
			sequences: {
				"page through": [
					step.check("ten shown", (s) => s.node.pager.last === 10),
					step.event("click", ".pager .next"),
					step.check("page 2", (s) => s.node.pager.page === 1),
					step.event("click", ".pager .last"),
					step.check("the last page", (s) => s.node.pager.first === 111),
					step.send("setPerPage", [25], { at: atPager }),
					step.check("item 111 still shown", (s) => s.node.pager.shows(110)),
					step.send("showAll", [], { at: atPager }),
					step.check("one page", (s) => !s.node.pager.isMany),
				],
			},
			pbt: { include: pagerMessages, maxCommands: 12 },
		},
		"A long enum, paginated": {
			make: tree({ enum: Array.from({ length: 30 }, (_, i) => `v${i}`) }, { perPage: 8 }),
			pbt: { events: true, maxCommands: 10 },
		},
		"Generated tree": {
			arbitrary: (A) => A.instance("SchemaRoot"),
			pbt: { include: messages, maxCommands: 10 },
		},
	},
});

// The studio has its own book: its components join the generated trees' candidates otherwise.
export const studioBook = stories({
	title: "JSON Schema studio",
	components: studioComponents,
	stories: {
		"Order payload": {
			make: (C) => studio(C),
			sequences: {
				"load another sample": [
					step.check("in step with the payload", (s) => !s.isStale),
					step.send("loadSample", ["user"]),
					step.check("the user schema", (s) => s.title === "User" && !s.isStale),
				],
				"retitle the schema": [
					step.send("setTitle", ["Purchase"]),
					step.check("the schema follows", (s) => JSON.parse(s.schemaText).title === "Purchase"),
				],
			},
		},
	},
});

// A JSON Schema, read as its tree (SchemaRoot, compact) or as its JSON (the json components),
// and edited as JSON: its edit view, pushed from above, edits the JSON in place (the json
// components' edit views). The tree follows the JSON as long as it reads as a schema; the
// schema is the last JSON that did.
import {
	$if,
	AGENT_META,
	agentTool,
	apply,
	button,
	canApply,
	component,
	DATA_META,
	DISPLAY_META,
	field,
	render,
	scopeOf,
	send,
	t,
	tag,
} from "../../src/tutuca.js";
import { fromJson, jsonComponents, VALUE_NAMES } from "../json/index.js";
import { validate } from "../llm/validate.js";
import { schemaComponents } from "./index.js";
import { fromSchema, isSchema } from "./read.js";

// The longest summary an agent reads of a schema: longer, it's cut, and get_state has it whole.
const SUMMARY_LENGTH = 4000;

const { div, header, p, span } = tag;

const TOOLBAR = "flex items-center gap-1 border-b border-base-300 pb-2";
const BUTTON = "btn btn-xs btn-ghost font-mono";
const readingButton = (reading, active) =>
	button(
		{
			class: $if(
				field(active),
				`${BUTTON} join-item btn-active reading-${reading}`,
				`${BUTTON} join-item reading-${reading}`,
			),
			"aria-pressed": field(active),
			"on:click": send("setReading", reading),
		},
		reading,
	);
const openAllButtons = [
	button(
		{ class: `${BUTTON} ml-auto expand-all`, "on:click": send("setOpenDeep", true) },
		"expand all",
	),
	button(
		{ class: `${BUTTON} collapse-all`, "on:click": send("setOpenDeep", false) },
		"collapse all",
	),
];

// The tree of a schema, without its toolbar.
const bareTree = (C, schema) => C.SchemaRoot({ node: fromSchema(C, schema), bare: true });

export const JsonSchemaEditor = component({
	name: "JsonSchemaEditor",
	meta: {
		[DISPLAY_META]: {
			title: "JSON Schema",
			icon: "📐",
			description: "A JSON Schema, read as a tree or as JSON, and edited as JSON.",
		},
		[DATA_META]: {
			load: "load",
			data: "schema",
			schema: {
				type: ["object", "boolean"],
				description: "A JSON Schema document: an object of keywords, or true or false.",
			},
		},
		// An agent writes the schema whole (set_state) and checks values against it.
		[AGENT_META]: {
			prompt:
				"A JSON Schema (2020-12). To change it, write the whole new schema with set_state; the summary is the schema now. Check example values against it with check_value before saying it fits them.",
			tools: [
				agentTool(
					"check_value",
					"query",
					["value"],
					"Check a JSON value against the schema: the paths that don't fit and why, [] when it fits.",
				),
			],
			skills: {
				"conventions.md":
					"Prefer required over defaults for what must be there. Say additionalProperties: false only when asked for a closed object. Give every property a description when its name doesn't say it.",
			},
		},
	},
	fields: {
		json: t.component(VALUE_NAMES), // The schema as edited.
		source: t.string(), // The last JSON that read as a schema, as text.
		tree: t.component("SchemaRoot"), // source, read, without its toolbar.
		reading: t.enum("compact", "json"),
	},
	methods: {
		toSchema() {
			return JSON.parse(this.source);
		},
	},
	queries: {
		// Why the JSON doesn't read as a schema, empty when it does.
		get error() {
			return isSchema(this.json.toJson()) ? "" : "A schema is an object or a boolean.";
		},
		get hasError() {
			return this.error !== "";
		},
		get isCompact() {
			return this.reading === "compact";
		},
		get isJson() {
			return this.reading === "json";
		},
		// The schema, what load takes back.
		get schema() {
			return this.toSchema();
		},
		// The schema as compact JSON, for an agent's prompt.
		get summary() {
			const text = this.source;
			return text.length > SUMMARY_LENGTH
				? `${text.slice(0, SUMMARY_LENGTH)}… (cut: get_state has it all)`
				: text;
		},
		// Where value doesn't fit the schema: [{ path, message }], [] when it does.
		check_value: {
			args: [t.any()],
			run(value) {
				return validate(this.toSchema(), value);
			},
		},
	},
	view: div(
		{ class: "json-schema-editor flex flex-col gap-2" },
		header(
			{ class: TOOLBAR },
			span(
				{ class: "join", role: "group", "aria-label": "Reading" },
				readingButton("compact", "isCompact"),
				readingButton("json", "isJson"),
			),
			...openAllButtons,
		),
		$if(
			field("isCompact"),
			render(field("tree")),
			div({ class: "overflow-auto" }, render(field("json"))),
		),
	),
	// Only the JSON: the tree can't be edited, so it isn't shown while editing.
	views: {
		edit: div(
			{ class: "json-schema-editor flex flex-col gap-2" },
			header({ class: TOOLBAR }, ...openAllButtons),
			div({ class: "overflow-auto" }, render(field("json"))),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		),
	},
	on: {
		setReading: {
			args: [t.enum("compact", "json")],
			run(next, [reading]) {
				next.reading = reading;
			},
		},
		// Both readings open or close, so switching keeps what's shown.
		setOpenDeep: {
			pure: true,
			args: [t.boolean()],
			run(next, [open]) {
				for (const key of ["tree", "json"]) {
					if (canApply(next[key], "setOpenDeep")) next[key] = apply(next[key], "setOpenDeep", open);
				}
			},
		},
		// A schema replaces the one edited.
		load: {
			pure: true,
			args: [t.any().where(isSchema, "a JSON Schema: an object or a boolean")],
			run(next, [schema]) {
				const C = scopeOf(this).components;
				next.json = fromJson(C, schema);
				next.source = JSON.stringify(schema);
				next.tree = bareTree(C, schema);
			},
		},
		// The JSON changed below: the tree reads it again when it's a schema.
		jsonEdited: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				const json = this.json.toJson();
				if (!isSchema(json)) return;
				const source = JSON.stringify(json);
				if (source === this.source) return;
				next.source = source;
				next.tree = bareTree(ctx.scope.components, json);
			},
		},
	},
});

// An editor of schema, a JSON Schema, made with C.
export const schemaEditor = (C, schema) =>
	C.JsonSchemaEditor({
		json: fromJson(C, schema),
		source: JSON.stringify(schema),
		tree: bareTree(C, schema),
	});

export const schemaEditorComponents = { ...jsonComponents, ...schemaComponents, JsonSchemaEditor };

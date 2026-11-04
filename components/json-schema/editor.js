// A JSON Schema, read as its tree (SchemaRoot, compact) or as its JSON (the json components),
// and edited as JSON: its edit view, pushed from above, edits the JSON in place (the json
// components' edit views). The tree follows the JSON as long as it reads as a schema; the
// schema is the last JSON that did.
import {
	$if,
	apply,
	button,
	canApply,
	component,
	DISPLAY_META,
	field,
	render,
	send,
	t,
	tag,
} from "../../src/tutuca.js";
import { fromJson, jsonComponents, VALUE_NAMES } from "../json/index.js";
import { schemaComponents } from "./index.js";
import { fromSchema, isSchema } from "./read.js";

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

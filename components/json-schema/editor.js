// A JSON Schema, shown as its tree (SchemaRoot) and edited as JSON text: its edit view, pushed
// from above, has the text above the tree, which follows it as long as it reads as a schema.
// The schema is the last text that did, as typed: the tree shows only what it reads of it.
import {
	$if,
	component,
	DISPLAY_META,
	field,
	render,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { jsonComponents } from "../json/index.js";
import { schemaComponents } from "./index.js";
import { schemaTree } from "./read.js";

const { div, p, textarea } = tag;

// A schema is an object or a boolean.
const isSchema = (j) =>
	typeof j === "boolean" || (typeof j === "object" && j !== null && !Array.isArray(j));

export const JsonSchemaEditor = component({
	name: "JsonSchemaEditor",
	meta: {
		[DISPLAY_META]: {
			title: "JSON Schema",
			icon: "📐",
			description: "A JSON Schema, read as a tree and edited as JSON.",
		},
	},
	fields: {
		text: t.string(), // The schema as typed.
		source: t.string(), // The last text that read as a schema.
		tree: t.component("SchemaRoot"), // source, read.
		error: t.string(), // Why the text doesn't read as one, empty when it does.
	},
	methods: {
		toSchema() {
			return JSON.parse(this.source);
		},
	},
	queries: {
		get hasError() {
			return this.error !== "";
		},
	},
	view: div({ class: "json-schema-editor" }, render(field("tree"))),
	views: {
		edit: div(
			{ class: "json-schema-editor flex flex-col gap-2" },
			textarea({
				class: "textarea textarea-bordered textarea-sm min-h-32 w-full font-mono text-xs",
				"aria-label": "Schema JSON",
				spellcheck: "false",
				value: field("text"),
				"on:input": send("setText", targetValue()),
			}),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
			render(field("tree")),
		),
	},
	on: {
		// The text, and the tree when it reads as a schema (keeping how the tree is read).
		setText: {
			args: [t.string()],
			run(next, [text], ctx) {
				next.text = text;
				let json;
				try {
					json = JSON.parse(text);
				} catch (error) {
					next.error = `Not JSON: ${error.message}`;
					return;
				}
				if (!isSchema(json)) {
					next.error = "A schema is an object or a boolean.";
					return;
				}
				next.error = "";
				next.source = text;
				next.tree = schemaTree(ctx.scope.components, json, { view: this.tree.view });
			},
		},
	},
});

// An editor of schema, a JSON Schema, made with C.
export const schemaEditor = (C, schema) => {
	const text = JSON.stringify(schema, null, 2);
	return C.JsonSchemaEditor({ text, source: text, tree: schemaTree(C, schema) });
};

export const schemaEditorComponents = { ...jsonComponents, ...schemaComponents, JsonSchemaEditor };

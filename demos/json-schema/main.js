import { fromJson, jsonComponents } from "../../components/json/index.js";
import { schemaComponents, schemaTree } from "../../components/jsonschema/index.js";
import { tag } from "../../src/dev/util.js";
import { $if, component, field, render, scopeOf, send, t, targetValue } from "../../src/tutuca.js";
import { boot, browserHandlers, sendRoot } from "../boot.js";
import { inferSchema, schemaDocument } from "./infer.js";

const { button, details, div, h2, input, label, option, p, pre, select, span, summary, textarea } =
	tag;

// Example payloads to start from.
export const SAMPLES = {
	user: {
		label: "User profile",
		title: "User",
		value: {
			id: 4211,
			name: "Ada Lovelace",
			email: "ada@example.com",
			website: "https://ada.example.com",
			verified: true,
			rating: 4.8,
			joined: "2024-03-01",
			address: { street: "12 Analytical Row", city: "London", postcode: "N1 9GU" },
			tags: ["math", "engines"],
		},
	},
	order: {
		label: "Shop order",
		title: "Order",
		value: {
			orderId: "ord_9f2c",
			createdAt: "2026-10-16T10:30:00Z",
			status: "paid",
			customer: { id: 4211, email: "ada@example.com" },
			items: [
				{ sku: "MUG-01", name: "Mug", quantity: 2, price: 9.5 },
				{ sku: "TEA-12", name: "Earl grey", quantity: 1, price: 6, giftWrap: true },
			],
			coupon: null,
			total: 25,
		},
	},
	webhook: {
		label: "Webhook event",
		title: "PushEvent",
		value: {
			event: "push",
			deliveredAt: "2026-10-16T10:31:12+02:00",
			repository: { name: "tutuca", url: "https://git.example.com/tutuca", private: false },
			commits: [
				{ id: "a1b2c3", message: "Add demos", author: "ada@example.com", added: ["demos/boot.js"] },
				{ id: "d4e5f6", message: "Fix typo", author: "grace@example.com", removed: [] },
			],
		},
	},
};
const SAMPLE_IDS = Object.keys(SAMPLES);

const schemaFor = (json, title) => schemaDocument(inferSchema(json), title);
const textOf = (json) => JSON.stringify(json);

const card = (...childs) =>
	div(
		{
			class:
				"card flex min-w-0 flex-1 flex-col gap-3 border border-base-300 bg-base-100 p-4 shadow-sm",
		},
		...childs,
	);
const cardTitle = (text) =>
	h2({ class: "text-sm font-semibold uppercase tracking-wider opacity-60" }, text);

// An example payload in a JSON editor and the schema inferred from it, kept in step.
export const Studio = component({
	name: "Studio",
	fields: (t) => ({
		sample: t.enum(...SAMPLE_IDS),
		title: t.string(),
		editor: t.component("JsonEditor"),
		schema: t.component("SchemaRoot"),
		source: t.string(), // The payload the schema was inferred from, as JSON text.
		pasteText: t.string(),
		pasteError: t.string(),
	}),
	methods: {
		get json() {
			return this.editor.toJson();
		},
		get isStale() {
			return textOf(this.json) !== this.source;
		},
		get schemaText() {
			return JSON.stringify(schemaFor(this.json, this.title), null, 2);
		},
		get hasPasteError() {
			return this.pasteError !== "";
		},
		// Infers the schema again from the editor's payload, keeping how it is read.
		infer(draft) {
			const C = scopeOf(this).components;
			const json = draft.editor.toJson();
			draft.schema = schemaTree(C, schemaFor(json, draft.title), { view: this.schema.view });
			draft.source = textOf(json);
		},
	},
	view: div(
		{ class: "flex flex-col gap-4 xl:flex-row xl:items-start" },
		card(
			div(
				{ class: "flex flex-wrap items-center justify-between gap-2" },
				cardTitle("Example payload"),
				select(
					{
						class: "select select-sm select-bordered",
						"aria-label": "Sample payload",
						value: field("sample"),
						"@on.change": send("loadSample", targetValue()),
					},
					...SAMPLE_IDS.map((id) => option({ value: id }, SAMPLES[id].label)),
				),
			),
			p(
				{ class: "text-sm opacity-70" },
				"Edit values, add or remove fields and array items: the schema follows.",
			),
			render(field("editor")),
			details(
				{ class: "collapse collapse-arrow border border-base-300" },
				summary({ class: "collapse-title text-sm font-medium" }, "Paste your own JSON"),
				div(
					{ class: "collapse-content flex flex-col gap-2" },
					textarea({
						class: "textarea textarea-bordered h-40 w-full font-mono text-xs",
						"aria-label": "JSON to paste",
						placeholder: '{ "id": 1, "name": "…" }',
						value: field("pasteText"),
						"@on.input": send("setPasteText", targetValue()),
					}),
					$if(field("hasPasteError"), p({ class: "text-sm text-error" }, field("pasteError")), ""),
					button(
						{
							type: "button",
							class: "btn btn-sm btn-primary self-start",
							"@on.click": send("pasteJson"),
						},
						"Use this JSON",
					),
				),
			),
		),
		card(
			div(
				{ class: "flex flex-wrap items-center justify-between gap-2" },
				cardTitle("Schema"),
				button(
					{ type: "button", class: "btn btn-sm btn-primary", "@on.click": send("downloadSchema") },
					"Download .schema.json",
				),
			),
			label(
				{ class: "flex items-center gap-2 text-sm" },
				span({ class: "opacity-70" }, "Title"),
				input({
					class: "input input-sm input-bordered flex-1",
					"aria-label": "Schema title",
					value: field("title"),
					"@on.input": send("setTitle", targetValue()),
				}),
			),
			$if(
				field("isStale"),
				button(
					{
						type: "button",
						class: "btn btn-sm btn-warning self-start",
						"@on.click": send("regenerate"),
					},
					"Update schema",
				),
				"",
			),
			render(field("schema")),
			details(
				{ class: "collapse collapse-arrow border border-base-300" },
				summary({ class: "collapse-title text-sm font-medium" }, "Schema as JSON"),
				pre({ class: "collapse-content overflow-x-auto font-mono text-xs" }, field("schemaText")),
			),
		),
	),
	on: {
		regenerate: {
			args: [],
			post: (_prev, next) => !next.isStale,
			run(draft) {
				this.infer(draft);
			},
		},
		loadSample: {
			args: [t.enum(...SAMPLE_IDS)],
			run(draft, [id]) {
				const C = scopeOf(this).components;
				const { title, value } = SAMPLES[id];
				draft.sample = id;
				draft.title = title;
				draft.editor = C.JsonEditor({ mode: "edit", value: fromJson(C, value) });
				this.infer(draft);
			},
		},
		setTitle: {
			args: [t.string()],
			run(draft, [title]) {
				draft.title = title;
				this.infer(draft);
			},
		},
		setPasteText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.pasteText = text;
				draft.pasteError = "";
			},
		},
		pasteJson: {
			args: [],
			run(draft) {
				let value;
				try {
					value = JSON.parse(this.pasteText);
				} catch (error) {
					draft.pasteError = `Not JSON: ${error.message}`;
					return;
				}
				const C = scopeOf(this).components;
				draft.editor = C.JsonEditor({ mode: "edit", value: fromJson(C, value) });
				draft.pasteText = "";
				draft.title = "";
				this.infer(draft);
			},
		},
		downloadSchema: {
			args: [],
			emits: { ask: ["saveFile"] },
			run(_draft, _args, ctx) {
				const name = (this.title || "payload").toLowerCase().replace(/[^a-z0-9]+/g, "-");
				ctx.ask("saveFile", [
					`${name}.schema.json`,
					`${this.schemaText}\n`,
					"application/schema+json",
				]);
			},
		},
		saveFileReplyOk() {},
		saveFileReplyError(_draft, [error]) {
			console.error("saving the schema failed", error);
		},
		saveFileHandlerNotFound() {},
	},
});

export const studio = (C, id = "order") => {
	const { title, value } = SAMPLES[id];
	return C.Studio({
		sample: id,
		title,
		editor: C.JsonEditor({ mode: "edit", value: fromJson(C, value) }),
		schema: schemaTree(C, schemaFor(value, title)),
		source: textOf(value),
	});
};

export const start = (document = globalThis.document) => {
	const host = boot({
		document,
		components: { ...jsonComponents, ...schemaComponents, Studio },
		askHandlers: { saveFile: browserHandlers.saveFile },
		make: (C) => studio(C),
	});
	// Edits happen inside the editor, which doesn't tell the studio: infer after each one.
	const notify = host.onNotify;
	host.onNotify = (type, info) => {
		notify(type, info);
		if (type === "taskHandled" && host.rootComponent.isStale) {
			sendRoot(host, "regenerate");
		}
	};
	return host;
};

if (globalThis.document?.getElementById("app")) start();

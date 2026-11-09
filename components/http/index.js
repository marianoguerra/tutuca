// The parts of an HTTP exchange and the OpenAPI operation it follows, as cards to lay out and
// explain HTTP with: a header, a request, a response, an operation and a response it documents,
// and an exchange that checks a request and its response against an operation (its path,
// parameters and bodies' schemas, the documented statuses, the Content-Type and CORS). Each
// shows in its main view as it reads, and has an edit view, pushed from above (as the canvas's
// item toggle does), that edits it in place. The checking is in check.js, on plain JSON.

import { AGENT_META, agentTool, CLASSES_META } from "../../src/meta/index.js";
import {
	$if,
	apply,
	component,
	each,
	field,
	render,
	renderIt,
	scopeOf,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import {
	BADGE,
	cardClass,
	cardHeader,
	labeled,
	MONO,
	numberInput,
	removable,
	removableRow,
	SMALL_BUTTON,
	sectionFields,
	sectionMessages,
	sectionQueries,
	setField,
	setNumber,
	textInput,
	titled,
} from "../common/card.js";
import { dataMeta, loadFrom } from "../common/data.js";
import { kind, metaFor } from "../common/meta.js";
import { pickerRow } from "../common/ui.js";
import { NOTE } from "../common/util.js";
import { droppableJson, jsonRoot } from "../json/index.js";
import { jsonKinds, schemaEditor, schemaEditorComponents } from "../json-schema/editor.js";
import {
	cachingOf,
	checkExchange,
	headerDoc,
	METHODS,
	methodTraits,
	parseUrl,
	REASONS,
	rawRequest,
	rawResponse,
	STATUS_BADGES,
	statusClass,
} from "./check.js";
import { TASK, TASKS } from "./fixtures.js";

const { button, div, input, label, li, option, p, pre, select, span, textarea, ul } = tag;

const METHOD_NAMES = Object.keys(METHODS);
const RAW = "overflow-auto whitespace-pre rounded bg-base-200 p-2 font-mono text-xs";
const methodBadge = (name) => span({ class: `${BADGE} badge-primary font-mono` }, field(name));
const methodSelect = () =>
	select(
		{
			class: "select select-bordered select-sm w-28 font-mono",
			"aria-label": "Method",
			value: field("method"),
			"on:change": send("setMethod", targetValue()),
		},
		...METHOD_NAMES.map((m) => option({ value: m }, m)),
	);
const setMethod = () => ({
	args: [t.enum(...METHOD_NAMES)],
	run(next, [method]) {
		next.method = method;
	},
});
const isStatus = (n) => Number.isInteger(n) && n >= 100 && n <= 599;

// What each card's load takes, as its asJson query gives it: the JSON Schemas an agent's
// set_state shows and a dropped file is checked against.
const HEADERS_SCHEMA = {
	type: "array",
	description: "The headers, each a [name, value] pair.",
	items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
};
const BODY_SCHEMA = {
	body: { description: "The body: JSON, or a string when bodyType is text. None when left out." },
	bodyType: { enum: ["json", "text"] },
};
const REQUEST_SCHEMA = {
	type: "object",
	properties: {
		method: { enum: METHOD_NAMES },
		url: { type: "string" },
		headers: HEADERS_SCHEMA,
		...BODY_SCHEMA,
	},
	required: ["method", "url"],
	additionalProperties: false,
};
const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		status: { type: "integer", minimum: 100, maximum: 599 },
		headers: HEADERS_SCHEMA,
		...BODY_SCHEMA,
	},
	required: ["status"],
	additionalProperties: false,
};
const MEDIA_SCHEMA = {
	type: "object",
	description: 'By media type; only "application/json" with a schema is read.',
	additionalProperties: { type: "object", properties: { schema: {} } },
};
const OPERATION_SCHEMA = {
	type: "object",
	description: "An OpenAPI 3.1 Operation Object, with its method and path.",
	properties: {
		method: { enum: METHOD_NAMES },
		path: { type: "string" },
		operationId: { type: "string" },
		summary: { type: "string" },
		parameters: { type: "array", items: { type: "object" } },
		requestBody: {
			type: "object",
			properties: { required: { type: "boolean" }, content: MEDIA_SCHEMA },
		},
		responses: {
			type: "object",
			description: "By status: 200, 4XX or default.",
			additionalProperties: {
				type: "object",
				properties: { description: { type: "string" }, content: MEDIA_SCHEMA },
			},
		},
	},
	required: ["method", "path"],
	additionalProperties: false,
};
// An OpenAPI document's first operation also loads one.
const OPENAPI_SCHEMA = {
	type: "object",
	description: "An OpenAPI document: its first operation is read.",
	properties: { openapi: { type: "string" }, paths: { type: "object" } },
	required: ["openapi", "paths"],
};
const OPERATION_OR_DOC_SCHEMA = { anyOf: [OPERATION_SCHEMA, OPENAPI_SCHEMA] };
const EXCHANGE_SCHEMA = {
	type: "object",
	properties: {
		operation: OPERATION_SCHEMA,
		request: REQUEST_SCHEMA,
		response: RESPONSE_SCHEMA,
	},
	required: ["request", "response"],
	additionalProperties: false,
};

// A header: its name and value, and what it's for when it's a known one.
export const HttpHeader = component({
	name: "HttpHeader",
	meta: metaFor("HTTP header", "🏷️", "A header: its name, its value and what it's for.", 360),
	fields: { name: t.string(), value: t.string() },
	methods: {
		toJson() {
			return [this.name, this.value];
		},
	},
	queries: {
		get doc() {
			return headerDoc(this.name);
		},
	},
	view: div(
		{ class: "http-header font-mono text-xs", title: field("doc") },
		span({ class: "font-semibold" }, field("name")),
		": ",
		span({ class: "break-all" }, field("value")),
	),
	views: {
		edit: div(
			{ class: "http-header grid grid-cols-[2fr_3fr] gap-1" },
			textInput("Header name", "name", "setName", "font-mono"),
			textInput("Header value", "value", "setValue", "font-mono"),
		),
	},
	on: { setName: setField("name"), setValue: setField("value") },
});

// The header list, read and edited; each card that has one has headers, addHeader and
// removeHeader.
const headerList = () =>
	div({ class: "flex flex-col gap-0.5" }, each(field("headers"), renderIt()));
const headerListEdit = () =>
	div(
		{ class: "flex flex-col gap-1" },
		each(field("headers"), removableRow("Remove this header", "removeHeader")),
		button(
			{ class: `${SMALL_BUTTON} self-start`, title: "Add a header", "on:click": send("addHeader") },
			"+ header",
		),
	);
const headerMessages = () => ({
	addHeader(next, _args, ctx) {
		next.headers.push(ctx.scope.components.HttpHeader({ name: "", value: "" }));
	},
	removeHeader: {
		args: [t.index("headers")],
		run(next, [at]) {
			next.headers.splice(at, 1);
		},
	},
	// The body is none, text or JSON: switching converts it, JSON to its text and text that
	// parses to JSON, keeping what it was when it can't.
	setBodyKind: {
		args: [
			t
				.number()
				.int()
				.min(0)
				.max(BODY_KINDS.length - 1),
		],
		run(next, [at], ctx) {
			const kind = BODY_KINDS[at][0];
			const C = ctx.scope.components;
			if (kind === "json") {
				const parsed = this.bodyKind === "text" ? parseJson(this.bodyText) : undefined;
				if (parsed !== undefined) next.body = droppableJson(C, parsed);
				else if (this.body === null) next.body = droppableJson(C, {});
			} else if (kind === "text" && this.bodyKind === "json" && this.body !== null) {
				next.bodyText = JSON.stringify(this.body.toJson(), null, 2);
			}
			next.bodyKind = kind;
		},
	},
	setBodyText: setField("bodyText"),
});
// What an agent changes a request's or response's headers and body with, by name: a header
// set replaces the one of that name (any case) or adds it, and a body is none, text or JSON.
const isSchemaValue = (v) =>
	typeof v === "boolean" || (typeof v === "object" && v !== null && !Array.isArray(v));
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const agentMessageHandlers = () => ({
	set_header: {
		pure: true,
		args: [t.string().len(1), t.string()],
		run(next, [name, value]) {
			const header = scopeOf(this).components.HttpHeader({ name, value });
			const at = this.headers.findIndex((h) => sameName(h.name, name));
			if (at === -1) next.headers.push(header);
			else next.headers[at] = header;
		},
	},
	remove_header: {
		pure: true,
		args: [t.string()],
		pre: (self, [name]) => self.headers.some((h) => sameName(h.name, name)),
		why: (_self, [name]) => `there's no ${name} header`,
		run(next, [name]) {
			next.headers = this.headers.filter((h) => !sameName(h.name, name));
		},
	},
	set_body: {
		pure: true,
		args: [t.enum("none", "text", "json"), t.any()],
		run(next, [kind, value]) {
			next.bodyKind = kind;
			if (kind === "text") {
				next.bodyText = typeof value === "string" ? value : JSON.stringify(value, null, 2);
			} else if (kind === "json") {
				next.body = droppableJson(scopeOf(this).components, value ?? {});
			}
		},
	},
});
const messageTools = [
	agentTool(
		"set_header",
		"message",
		["name", "value"],
		"Set a header, replacing the one of that name.",
	),
	agentTool("remove_header", "message", ["name"], "Remove the header of that name."),
	agentTool(
		"set_body",
		"message",
		["kind", "value"],
		"Set the body: none (value null), text (value a string) or json (value any JSON).",
	),
];
const HTTP_SKILL = {
	"http.md":
		"Safe methods (GET, HEAD, OPTIONS) change nothing on the server; PUT and DELETE are idempotent, POST isn't. A JSON body needs Content-Type: application/json. 201 Created comes with a Location header; 204 has no body. Cache-Control and ETag say what caches may keep.",
};

// The kinds a body can be, and their buttons' text.
const BODY_KINDS = [
	["none", "None"],
	["text", "Text"],
	["json", "JSON"],
];
const parseJson = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};
const bodyFields = () => ({
	bodyKind: t.enum(...BODY_KINDS.map(([k]) => k)),
	body: t.option(t.component("JsonRoot")), // Kept while it's text, to switch back.
	bodyText: t.string(),
});
// A body kind's button, and what it adds when it's the body's kind.
const BODY_KIND_BUTTON = "btn btn-xs join-item";
const BODY_KIND_PICKED = "btn-primary";
// The classes a status's badge can have.
const STATUS_BADGE_CLASSES = `${BADGE} ${STATUS_BADGES}`;
const BODY_TEXT = "overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 font-mono text-xs";
// The body, read: its JSON or its text, in a section, when there's one.
const bodyView = () =>
	$if(
		field("hasBody"),
		titled(
			"body",
			"Body",
			$if(field("isJsonBody"), render(field("body")), pre({ class: BODY_TEXT }, field("bodyText"))),
		),
		"",
	);
// The body, edited: none, text or JSON, then the JSON's components or the text's textarea.
const bodyEdit = () =>
	titled(
		"body",
		"Body",
		pickerRow("Body", "bodyKinds", "setBodyKind", { cls: "join self-start" }),
		$if(
			field("isJsonBody"),
			render(field("body")),
			$if(
				field("hasBody"),
				textarea({
					class: "textarea textarea-bordered textarea-sm min-h-24 w-full font-mono text-xs",
					"aria-label": "Body text",
					value: field("bodyText"),
					"on:input": send("setBodyText", targetValue()),
				}),
				"",
			),
		),
	);
const messageQueries = {
	hasBody: {
		get() {
			return this.bodyKind !== "none";
		},
	},
	isJsonBody: {
		get() {
			return this.bodyKind === "json" && this.body !== null;
		},
	},
	bodyKinds: {
		get() {
			return BODY_KINDS.map(([kind, text]) => ({
				text,
				title: kind === "none" ? "No body" : `${text} body`,
				cls: `${BODY_KIND_BUTTON} ${kind === this.bodyKind ? BODY_KIND_PICKED : ""}`,
				pressed: kind === this.bodyKind ? "true" : "false",
			}));
		},
	},
};
// Its headers and body, the body JSON or text as bodyType says.
const messageJson = (self) => ({
	headers: self.headers.map((h) => h.toJson()),
	...(self.bodyKind === "json" && self.body !== null
		? { body: self.body.toJson(), bodyType: "json" }
		: self.bodyKind === "text"
			? { body: self.bodyText, bodyType: "text" }
			: {}),
});

const REQUEST_SECTIONS = ["url", "headers", "body", "wire"];
// What a client sends: a method, a URL, headers and maybe a body.
export const HttpRequest = component({
	name: "HttpRequest",
	meta: metaFor(
		"HTTP request",
		"📨",
		"What a client sends: a method, a URL, headers and maybe a body.",
		480,
		{
			...dataMeta(REQUEST_SCHEMA),
			[CLASSES_META]: { classes: `${BODY_KIND_BUTTON} ${BODY_KIND_PICKED}` },
			[AGENT_META]: {
				prompt:
					"An HTTP request. The outline is the request as it goes on the wire, and what its method promises.",
				summary: "outline",
				tools: [
					agentTool("set_method", "message", ["method"], "Set the method.", {
						target: "setMethod",
					}),
					agentTool("set_url", "message", ["url"], "Set the URL, with its query.", {
						target: "setUrl",
					}),
					...messageTools,
				],
				skills: HTTP_SKILL,
			},
		},
	),
	fields: {
		method: t.enum(...METHOD_NAMES),
		url: t.string(),
		headers: t.array(t.component("HttpHeader")),
		...bodyFields(),
		...sectionFields(),
	},
	methods: {
		toJson() {
			return { method: this.method, url: this.url, ...messageJson(this) };
		},
	},
	queries: {
		...messageQueries,
		get traits() {
			return methodTraits(this.method);
		},
		// The URL's parts, one row each: its origin, its path and each query parameter.
		get urlParts() {
			const u = parseUrl(this.url);
			if (!u.ok) return [{ name: "✗", value: "Not a URL" }];
			return [
				{ name: "origin", value: u.origin },
				{ name: "path", value: u.path },
				...u.query.map(([k, v]) => ({ name: `?${k}`, value: v })),
			];
		},
		get wire() {
			return rawRequest(this.toJson());
		},
		get outline() {
			return `${this.wire}\n\n${this.traits}`;
		},
		get asJson() {
			return this.toJson();
		},
		...sectionQueries(REQUEST_SECTIONS),
	},
	view: div(
		{ class: cardClass("http-request") },
		cardHeader(
			"Request",
			"badge-primary badge-outline",
			methodBadge("method"),
			span({ class: `${MONO} break-all` }, field("url")),
		),
		p({ class: NOTE }, field("traits")),
		titled(
			"url",
			"URL",
			div(
				{ class: "grid grid-cols-[auto_1fr] gap-x-3 font-mono text-xs" },
				each(
					field("urlParts"),
					div(
						{ class: "contents" },
						span({ class: "opacity-60" }, field("name")),
						span({ class: "break-all" }, field("value")),
					),
				),
			),
		),
		titled("headers", "Headers", headerList()),
		bodyView(),
		titled("wire", "On the Wire", pre({ class: RAW }, field("wire"))),
	),
	views: {
		edit: div(
			{ class: cardClass("http-request") },
			cardHeader("Request", "badge-primary badge-outline"),
			div({ class: "flex gap-2" }, methodSelect(), textInput("URL", "url", "setUrl", "font-mono")),
			titled("headers", "Headers", headerListEdit()),
			bodyEdit(),
		),
	},
	on: {
		...sectionMessages(REQUEST_SECTIONS, ["headers", "body"]),
		...headerMessages(),
		setMethod: setMethod(),
		setUrl: setField("url"),
		...agentMessageHandlers(),
		load: loadFrom(REQUEST_SCHEMA, (C, json) => requestFields(C, json)),
	},
});

const RESPONSE_SECTIONS = ["headers", "body", "caching", "wire"];
// What the server answers: a status, headers and maybe a body.
export const HttpResponse = component({
	name: "HttpResponse",
	meta: metaFor(
		"HTTP response",
		"📬",
		"What the server answers: a status, headers and a body.",
		480,
		{
			...dataMeta(RESPONSE_SCHEMA),
			[CLASSES_META]: {
				classes: `${STATUS_BADGE_CLASSES} ${BODY_KIND_BUTTON} ${BODY_KIND_PICKED}`,
			},
			[AGENT_META]: {
				prompt:
					"An HTTP response. The outline is the response as it goes on the wire, what its status means and what caches may do with it.",
				summary: "outline",
				tools: [
					agentTool("set_status", "message", ["status"], "Set the status code."),
					...messageTools,
				],
				skills: HTTP_SKILL,
			},
		},
	),
	fields: {
		status: t.number().int().min(100).max(599).default(200),
		headers: t.array(t.component("HttpHeader")),
		...bodyFields(),
		...sectionFields(),
	},
	methods: {
		toJson() {
			return { status: this.status, ...messageJson(this) };
		},
	},
	queries: {
		...messageQueries,
		get reason() {
			return REASONS[this.status] ?? "";
		},
		get statusBadgeClass() {
			return `${BADGE} ${statusClass(this.status).badge}`;
		},
		get statusLabel() {
			return statusClass(this.status).label;
		},
		get statusMeans() {
			return statusClass(this.status).means;
		},
		get caching() {
			return cachingOf(this.toJson()).map((text) => ({ text }));
		},
		get wire() {
			return rawResponse(this.toJson());
		},
		get outline() {
			const caching = this.caching.map((c) => `- ${c.text}`).join("\n");
			return `${this.wire}\n\n${this.statusLabel}: ${this.statusMeans}\nCaching:\n${caching}`;
		},
		get asJson() {
			return this.toJson();
		},
		...sectionQueries(RESPONSE_SECTIONS),
	},
	view: div(
		{ class: cardClass("http-response") },
		cardHeader(
			"Response",
			"badge-secondary badge-outline",
			span({ class: `${MONO} font-bold` }, field("status"), " ", field("reason")),
			span({ class: field("statusBadgeClass") }, field("statusLabel")),
		),
		p({ class: NOTE }, field("statusMeans")),
		titled("headers", "Headers", headerList()),
		bodyView(),
		titled(
			"caching",
			"Caching",
			ul({ class: `${NOTE} list-disc pl-5` }, each(field("caching"), li(field("text")))),
		),
		titled("wire", "On the Wire", pre({ class: RAW }, field("wire"))),
	),
	views: {
		edit: div(
			{ class: cardClass("http-response") },
			cardHeader(
				"Response",
				"badge-secondary badge-outline",
				span({ class: field("statusBadgeClass") }, field("statusLabel")),
			),
			labeled("Status", numberInput("Status", "status", "setStatus", "w-28")),
			titled("headers", "Headers", headerListEdit()),
			bodyEdit(),
		),
	},
	on: {
		...sectionMessages(RESPONSE_SECTIONS, ["headers", "body"]),
		...headerMessages(),
		setStatus: setNumber("status", isStatus),
		set_status: setField("status", t.number().int().min(100).max(599), { pure: true }),
		...agentMessageHandlers(),
		load: loadFrom(RESPONSE_SCHEMA, (C, json) => responseFields(C, json)),
	},
});

// A response an operation documents: its status (200, 4XX or default), what it means and the
// schema of its JSON body, if it has one.
export const ApiResponse = component({
	name: "ApiResponse",
	meta: metaFor(
		"Documented response",
		"📄",
		"A response an API operation documents: its status, what it means and its body's schema.",
		420,
		{ [CLASSES_META]: { classes: `${STATUS_BADGE_CLASSES} font-mono` } },
	),
	fields: {
		status: t.string(),
		description: t.string(),
		schema: t.option(t.component("JsonSchemaEditor")),
		...sectionFields(),
	},
	methods: {
		// OpenAPI's Response Object.
		toJson() {
			return {
				description: this.description,
				...(this.schema === null
					? {}
					: { content: { "application/json": { schema: this.schema.toSchema() } } }),
			};
		},
	},
	queries: {
		get hasSchema() {
			return this.schema !== null;
		},
		get statusBadgeClass() {
			const n = Number.parseInt(this.status[0], 10);
			return `${BADGE} ${Number.isNaN(n) ? "badge-ghost" : statusClass(n * 100).badge} font-mono`;
		},
		...sectionQueries(["schema"]),
	},
	view: div(
		{ class: cardClass("api-response") },
		apiResponseHeader(),
		$if(field("hasSchema"), titled("schema", "Body Schema", render(field("schema"))), ""),
	),
	views: {
		edit: div(
			{ class: cardClass("api-response") },
			div(
				{ class: "grid grid-cols-[6rem_1fr] gap-2" },
				labeled("Status", textInput("Status", "status", "setStatus", "font-mono")),
				labeled("Description", textInput("Description", "description", "setDescription")),
			),
			$if(field("hasSchema"), titled("schema", "Body Schema", render(field("schema"))), ""),
			button(
				{
					class: `${SMALL_BUTTON} self-start`,
					title: "Toggle the body schema",
					"on:click": send("toggleSchema"),
				},
				$if(field("hasSchema"), "No body", "A JSON body"),
			),
		),
	},
	on: {
		...sectionMessages(["schema"], ["schema"]),
		setStatus: setField("status"),
		setDescription: setField("description"),
		toggleSchema(next, _args, ctx) {
			next.schema =
				this.schema === null ? schemaEditor(ctx.scope.components, { type: "object" }) : null;
		},
	},
});
function apiResponseHeader() {
	return div(
		{ class: "flex flex-wrap items-center gap-2" },
		span({ class: field("statusBadgeClass") }, field("status")),
		span({ class: NOTE }, field("description")),
	);
}

const OPERATION_SECTIONS = ["parameters", "requestBody", "responses", "openapi"];
// An API operation, as OpenAPI describes it: a method on a path template, its parameters, the
// schema of the body it takes and the responses it gives.
export const ApiOperation = component({
	name: "ApiOperation",
	meta: metaFor(
		"API operation",
		"📘",
		"An OpenAPI operation: a method on a path, its parameters, its body and its responses.",
		520,
		{
			...dataMeta(OPERATION_OR_DOC_SCHEMA),
			[AGENT_META]: {
				prompt:
					"An OpenAPI 3.1 operation: a method on a path template, its parameters (OpenAPI Parameter Objects), an optional JSON request body and its documented responses by status (200, 4XX, default). The outline is the operation as JSON. To rewrite it whole, use set_state.",
				summary: "outline",
				tools: [
					agentTool("set_method", "message", ["method"], "Set the method.", {
						target: "setMethod",
					}),
					agentTool("set_path", "message", ["path"], "Set the path template, like /tasks/{id}.", {
						target: "setPath",
					}),
					agentTool("set_operation_id", "message", ["operationId"], "Set the operationId.", {
						target: "setOperationId",
					}),
					agentTool("set_summary", "message", ["summary"], "Set its one-line summary.", {
						target: "setSummary",
					}),
					agentTool(
						"set_parameters",
						"message",
						["parameters"],
						"Replace its parameters: a list of OpenAPI Parameter Objects ({ name, in, required, schema }).",
					),
					agentTool(
						"set_request_body",
						"message",
						["schema", "required"],
						"Set the JSON request body's schema and whether it's required; schema null takes no body.",
					),
					agentTool(
						"set_response",
						"message",
						["status", "description", "schema"],
						"Document a response by status (200, 4XX, default), replacing one of that status; schema is its JSON body's, or null for none.",
					),
					agentTool(
						"remove_response",
						"message",
						["status"],
						"Remove the response of that status.",
					),
				],
				skills: HTTP_SKILL,
			},
		},
	),
	fields: {
		method: t.enum(...METHOD_NAMES),
		path: t.string(),
		operationId: t.string(),
		summary: t.string(),
		parameters: t.component("JsonRoot"),
		requestBody: t.option(t.component("JsonSchemaEditor")),
		bodyRequired: t.boolean(),
		responses: t.array(t.component("ApiResponse")),
		...sectionFields(),
	},
	methods: {
		// OpenAPI's Operation Object, with its method and path.
		toJson() {
			return {
				method: this.method,
				path: this.path,
				operationId: this.operationId,
				summary: this.summary,
				parameters: this.parameters.toJson(),
				...(this.requestBody === null
					? {}
					: {
							requestBody: {
								required: this.bodyRequired,
								content: { "application/json": { schema: this.requestBody.toSchema() } },
							},
						}),
				responses: Object.fromEntries(this.responses.map((r) => [r.status, r.toJson()])),
			};
		},
		// The OpenAPI document with only this operation.
		toOpenApi() {
			const { method, path, ...operation } = this.toJson();
			return {
				openapi: "3.1.0",
				info: { title: "Tasks", version: "1.0.0" },
				paths: { [path]: { [method.toLowerCase()]: operation } },
			};
		},
	},
	queries: {
		get hasBody() {
			return this.requestBody !== null;
		},
		get bodyNote() {
			return this.bodyRequired ? "required" : "optional";
		},
		get openapi() {
			return JSON.stringify(this.toOpenApi(), null, 2);
		},
		get outline() {
			return JSON.stringify(this.toJson());
		},
		get asJson() {
			return this.toJson();
		},
		...sectionQueries(OPERATION_SECTIONS),
	},
	view: div(
		{ class: cardClass("api-operation") },
		cardHeader(
			"Operation",
			"badge-accent",
			methodBadge("method"),
			span({ class: `${MONO} font-bold` }, field("path")),
			span({ class: "font-mono text-xs opacity-50" }, field("operationId")),
		),
		p({ class: NOTE }, field("summary")),
		titled("parameters", "Parameters", render(field("parameters"))),
		$if(
			field("hasBody"),
			titled(
				"requestBody",
				"Request Body",
				span({ class: NOTE }, field("bodyNote")),
				render(field("requestBody")),
			),
			"",
		),
		titled("responses", "Responses", each(field("responses"), renderIt())),
		titled("openapi", "OpenAPI", pre({ class: RAW }, field("openapi"))),
	),
	views: {
		edit: div(
			{ class: cardClass("api-operation") },
			cardHeader("Operation", "badge-accent"),
			div(
				{ class: "flex gap-2" },
				methodSelect(),
				textInput("Path", "path", "setPath", "font-mono"),
			),
			div(
				{ class: "grid grid-cols-2 gap-2" },
				labeled(
					"Operation id",
					textInput("Operation id", "operationId", "setOperationId", "font-mono"),
				),
				labeled("Summary", textInput("Summary", "summary", "setSummary")),
			),
			titled("parameters", "Parameters", render(field("parameters"))),
			$if(
				field("hasBody"),
				titled(
					"requestBody",
					"Request Body",
					label(
						{ class: "flex items-center gap-1 text-xs" },
						input({
							type: "checkbox",
							class: "checkbox checkbox-xs",
							"aria-label": "Body required",
							checked: field("bodyRequired"),
							"on:change": send("setBodyRequired", targetValue()),
						}),
						"required",
					),
					render(field("requestBody")),
				),
				"",
			),
			button(
				{
					class: `${SMALL_BUTTON} self-start`,
					title: "Toggle the request body",
					"on:click": send("toggleBody"),
				},
				$if(field("hasBody"), "Takes no body", "Takes a JSON body"),
			),
			titled(
				"responses",
				"Responses",
				each(field("responses"), removable("Remove this response", "removeResponse")),
				button(
					{
						class: `${SMALL_BUTTON} self-start`,
						title: "Add a response",
						"on:click": send("addResponse"),
					},
					"+ response",
				),
			),
		),
	},
	on: {
		...sectionMessages(OPERATION_SECTIONS, ["parameters", "requestBody", "responses"]),
		setMethod: setMethod(),
		setPath: setField("path"),
		setOperationId: setField("operationId"),
		setSummary: setField("summary"),
		setBodyRequired: setField("bodyRequired", t.boolean()),
		toggleBody(next, _args, ctx) {
			next.requestBody =
				this.requestBody === null ? schemaEditor(ctx.scope.components, TASKS.newTask.schema) : null;
		},
		addResponse(next, _args, ctx) {
			next.responses.push(
				ctx.scope.components.ApiResponse({ status: "default", description: "", schema: null }),
			);
		},
		load: loadFrom(OPERATION_OR_DOC_SCHEMA, (C, json) => operationFields(C, json)),
		set_parameters: {
			pure: true,
			args: [t.array(t.any())],
			run(next, [parameters]) {
				next.parameters = jsonRoot(scopeOf(this).components, parameters);
			},
		},
		set_request_body: {
			pure: true,
			args: [t.any(), t.boolean()],
			pre: (_self, [schema]) => schema === null || isSchemaValue(schema),
			why: () => "a schema is an object or a boolean",
			run(next, [schema, required]) {
				next.requestBody = schema === null ? null : schemaEditor(scopeOf(this).components, schema);
				next.bodyRequired = required;
			},
		},
		set_response: {
			pure: true,
			args: [t.string().len(1), t.string(), t.any()],
			pre: (_self, [, , schema]) => schema === null || isSchemaValue(schema),
			why: () => "a schema is an object or a boolean, or null for no body",
			run(next, [status, description, schema]) {
				const C = scopeOf(this).components;
				const made = schema === null ? null : schemaEditor(C, schema);
				const response = C.ApiResponse({ status, description, schema: made });
				const at = this.responses.findIndex((r) => r.status === status);
				if (at === -1) next.responses.push(response);
				else next.responses[at] = response;
			},
		},
		remove_response: {
			pure: true,
			args: [t.string()],
			pre: (self, [status]) => self.responses.some((r) => r.status === status),
			why: (self, [status]) =>
				`there's no ${status} response; there are ${self.responses.map((r) => r.status).join(", ") || "none"}`,
			run(next, [status]) {
				next.responses = this.responses.filter((r) => r.status !== status);
			},
		},
		removeResponse: {
			args: [t.index("responses")],
			run(next, [at]) {
				next.responses.splice(at, 1);
			},
		},
	},
});

// A check's line, passed or failed, and the summary's badge, all passed or not.
const CHECK_OK = "http-ok text-success";
const CHECK_FAIL = "http-fail text-error";
const SUMMARY_OK = "badge-success";
const SUMMARY_FAIL = "badge-error";
const EXCHANGE_SECTIONS = ["checks", "operation", "request", "response"];
// A request and the response it got, checked against the operation they follow, if any.
export const HttpExchange = component({
	name: "HttpExchange",
	meta: metaFor(
		"HTTP exchange",
		"🔁",
		"A request and its response, checked against the API operation they follow.",
		560,
		{
			...dataMeta(EXCHANGE_SCHEMA),
			[CLASSES_META]: {
				classes: [BADGE, SUMMARY_OK, SUMMARY_FAIL, CHECK_OK, CHECK_FAIL].join(" "),
			},
			[AGENT_META]: {
				prompt:
					"An HTTP exchange: a request, the response it got and, maybe, the OpenAPI operation they should follow. The outline lists every check, ✓ or ✗, then the request and response on the wire and the operation as JSON. Explain each ✗ in plain words; fix one only when asked, and check the outline after.",
				summary: "outline",
				tools: [
					agentTool(
						"set_request",
						"message",
						["request"],
						"Replace the request: { method, url, headers: [[name, value]], body, bodyType: json or text }.",
					),
					agentTool(
						"set_response",
						"message",
						["response"],
						"Replace the response: { status, headers: [[name, value]], body, bodyType: json or text }.",
					),
					agentTool(
						"set_operation",
						"message",
						["operation"],
						"Replace the operation they follow: { method, path, operationId, summary, parameters, requestBody, responses } as OpenAPI's; null for none.",
					),
				],
				skills: HTTP_SKILL,
			},
		},
	),
	fields: {
		operation: t.option(t.component("ApiOperation")),
		request: t.component("HttpRequest"),
		response: t.component("HttpResponse"),
		...sectionFields(),
	},
	methods: {
		toJson() {
			return {
				...(this.operation === null ? {} : { operation: this.operation.toJson() }),
				request: this.request.toJson(),
				response: this.response.toJson(),
			};
		},
	},
	queries: {
		get checks() {
			const { operation = null, request, response } = this.toJson();
			return checkExchange(operation, request, response).map(({ ok, text }) => ({
				ok,
				text,
				mark: ok ? "✓" : "✗",
				cls: ok ? CHECK_OK : CHECK_FAIL,
			}));
		},
		get asJson() {
			return this.toJson();
		},
		get failures() {
			return this.checks.filter((c) => !c.ok).length;
		},
		get summary() {
			const n = this.failures;
			return n === 0 ? "Everything checks out" : `${n} problem${n === 1 ? "" : "s"}`;
		},
		get outline() {
			const checks = this.checks.map((c) => `${c.mark} ${c.text}`).join("\n");
			const operation = this.operation === null ? "none" : JSON.stringify(this.operation.toJson());
			return `${this.summary}:\n${checks}\n\nRequest:\n${this.request.wire}\n\nResponse:\n${this.response.wire}\n\nOperation: ${operation}`;
		},
		get summaryClass() {
			return `${BADGE} ${this.failures === 0 ? SUMMARY_OK : SUMMARY_FAIL}`;
		},
		get hasOperation() {
			return this.operation !== null;
		},
		...sectionQueries(EXCHANGE_SECTIONS),
	},
	view: exchangeView(false),
	views: { edit: exchangeView(true) },
	on: {
		...sectionMessages(EXCHANGE_SECTIONS, ["operation", "request", "response"]),
		toggleOperation(next, _args, ctx) {
			next.operation = this.operation === null ? apiOperation(ctx.scope.components) : null;
		},
		// The agent's: each part replaced from its JSON, through that part's load.
		set_request: {
			pure: true,
			args: [t.any()],
			run(next, [json]) {
				next.request = apply(next.request, "load", json);
			},
		},
		set_response: {
			pure: true,
			args: [t.any()],
			run(next, [json]) {
				next.response = apply(next.response, "load", json);
			},
		},
		set_operation: {
			pure: true,
			args: [t.any()],
			run(next, [json]) {
				if (json === null) next.operation = null;
				else if (this.operation === null) {
					const C = scopeOf(this).components;
					next.operation = C.ApiOperation(operationFields(C, json));
				} else next.operation = apply(next.operation, "load", json);
			},
		},
		load: loadFrom(EXCHANGE_SCHEMA, (C, { operation, request, response }) => ({
			operation: operation === undefined ? null : C.ApiOperation(operationFields(C, operation)),
			request: C.HttpRequest(requestFields(C, request)),
			response: C.HttpResponse(responseFields(C, response)),
		})),
	},
});
function exchangeView(editing) {
	return div(
		{ class: cardClass("http-exchange") },
		cardHeader(
			"Exchange",
			"badge-neutral",
			span({ class: field("summaryClass") }, field("summary")),
		),
		titled(
			"checks",
			"Checks",
			ul(
				{ class: "flex flex-col gap-1 text-xs" },
				each(
					field("checks"),
					li(
						{ class: field("cls") },
						span({ class: "pr-1 font-bold" }, field("mark")),
						field("text"),
					),
				),
			),
		),
		$if(field("hasOperation"), titled("operation", "Operation", render(field("operation"))), ""),
		editing
			? button(
					{
						class: `${SMALL_BUTTON} self-start`,
						title: "Toggle the operation",
						"on:click": send("toggleOperation"),
					},
					$if(field("hasOperation"), "Check against no operation", "Check against an operation"),
				)
			: "",
		titled("request", "Request", render(field("request"))),
		titled("response", "Response", render(field("response"))),
	);
}

export const httpComponents = {
	...schemaEditorComponents,
	HttpHeader,
	HttpRequest,
	HttpResponse,
	ApiResponse,
	ApiOperation,
	HttpExchange,
};

// The JSON a card holds: a dropped JSON file replaces it.
const headers = (C, list) => list.map(([name, value]) => C.HttpHeader({ name, value }));

// Each part of the example, made with C.
export const httpHeader = (C, [name, value] = TASKS.request.headers[0]) =>
	C.HttpHeader({ name, value });
// A body as the fields take it: text when bodyType says so (or, without one, a string),
// anything else JSON; none when it's left out.
const bodyOf = (C, body, bodyType = typeof body === "string" ? "text" : "json") =>
	body === undefined
		? { bodyKind: "none", body: null, bodyText: "" }
		: bodyType === "text"
			? { bodyKind: "text", body: null, bodyText: String(body) }
			: { bodyKind: "json", body: droppableJson(C, body), bodyText: "" };
// The fields of a request, a response or an operation, from what their asJson gives.
const requestFields = (C, { method, url, headers: hs = [], body, bodyType }) => ({
	method,
	url,
	headers: headers(C, hs),
	...bodyOf(C, body, bodyType),
});
const responseFields = (C, { status, headers: hs = [], body, bodyType }) => ({
	status,
	headers: headers(C, hs),
	...bodyOf(C, body, bodyType),
});
const jsonSchemaOf = (content) => content?.["application/json"]?.schema;
// An OpenAPI document's first operation, with its method and path; an operation as it is.
const firstOperation = (json) => {
	if (json.paths === undefined) return json;
	for (const [path, item] of Object.entries(json.paths ?? {})) {
		for (const [method, op] of Object.entries(item ?? {})) {
			if (METHOD_NAMES.includes(method.toUpperCase())) {
				return { ...op, method: method.toUpperCase(), path };
			}
		}
	}
	return { method: "GET", path: "/" };
};
const operationFields = (C, json) => {
	const op = firstOperation(json);
	const body = jsonSchemaOf(op.requestBody?.content);
	return {
		method: op.method,
		path: op.path,
		operationId: op.operationId ?? "",
		summary: op.summary ?? "",
		parameters: droppableJson(C, op.parameters ?? []),
		requestBody: body === undefined ? null : schemaEditor(C, body),
		bodyRequired: op.requestBody?.required ?? false,
		responses: Object.entries(op.responses ?? {}).map(([status, r]) =>
			apiResponse(C, {
				status,
				description: r?.description ?? "",
				schema: jsonSchemaOf(r?.content),
			}),
		),
	};
};
export const httpRequest = (C, json = TASKS.request) => C.HttpRequest(requestFields(C, json));
export const httpResponse = (C, json = TASKS.response) => C.HttpResponse(responseFields(C, json));
export const apiResponse = (C, { status, description, schema } = TASKS.operation.responses[0]) =>
	C.ApiResponse({
		status,
		description,
		schema: schema === undefined ? null : schemaEditor(C, schema),
	});
export const apiOperation = (C, op = TASKS.operation, body = undefined) =>
	C.ApiOperation({
		method: op.method,
		path: op.path,
		operationId: op.operationId,
		summary: op.summary,
		parameters: droppableJson(C, op.parameters),
		requestBody: body === undefined ? null : schemaEditor(C, body),
		bodyRequired: body !== undefined,
		responses: op.responses.map((r) => apiResponse(C, r)),
	});
// The operation starts closed: it's long, and it's what the checks are against.
export const httpExchange = (C) =>
	C.HttpExchange({
		operation: apiOperation(C),
		request: httpRequest(C),
		response: httpResponse(C),
		closed: ["operation"],
	});
// Creating a task: a POST with a body, checked against its schema, and a 201.
export const createExchange = (C) =>
	C.HttpExchange({
		operation: apiOperation(C, TASKS.create.operation, TASKS.newTask.schema),
		request: httpRequest(C, TASKS.create.request),
		response: httpResponse(C, TASKS.create.response),
		closed: ["operation"],
	});

// What a canvas hole can become, in the http bundle: the parts above, a schema and a JSON value.
export const HTTP_KINDS = {
	request: kind("HttpRequest", httpRequest),
	response: kind("HttpResponse", httpResponse),
	header: kind("HttpHeader", httpHeader),
	operation: kind("ApiOperation", apiOperation),
	apiResponse: kind("ApiResponse", apiResponse),
	exchange: kind("HttpExchange", httpExchange),
	...jsonKinds(TASK, TASKS.response.body),
};

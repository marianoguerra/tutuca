// The parts of an HTTP exchange and the OpenAPI operation it follows, as cards to lay out and
// explain HTTP with: a header, a request, a response, an operation and a response it documents,
// and an exchange that checks a request and its response against an operation (its path,
// parameters and bodies' schemas, the documented statuses, the Content-Type and CORS). Each
// shows in its main view as it reads, and has an edit view, pushed from above (as the canvas's
// item toggle does), that edits it in place. The checking is in check.js, on plain JSON.
import {
	$if,
	component,
	each,
	field,
	render,
	renderIt,
	send,
	sourceKey,
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
	metaFor,
	numberInput,
	removable,
	removableRow,
	SMALL_BUTTON,
	sectionFields,
	sectionMessages,
	sectionQueries,
	setNumber,
	setString,
	textInput,
	titled,
} from "../common/card.js";
import { jsonRoot } from "../json/index.js";
import { schemaEditor, schemaEditorComponents } from "../json-schema/editor.js";
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
	statusClass,
} from "./check.js";

const { button, div, input, label, li, option, p, pre, select, span, textarea, ul } = tag;

const METHOD_NAMES = Object.keys(METHODS);
const RAW = "overflow-auto whitespace-pre rounded bg-base-200 p-2 font-mono text-xs";
const NOTE = "text-xs opacity-80";
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
	on: { setName: setString("name"), setValue: setString("value") },
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
				if (parsed !== undefined) next.body = droppable(C, parsed);
				else if (this.body === null) next.body = droppable(C, {});
			} else if (kind === "text" && this.bodyKind === "json" && this.body !== null) {
				next.bodyText = JSON.stringify(this.body.toJson(), null, 2);
			}
			next.bodyKind = kind;
		},
	},
	setBodyText: {
		args: [t.string()],
		run(next, [text]) {
			next.bodyText = text;
		},
	},
});
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
		div(
			{ class: "join self-start", role: "group", "aria-label": "Body" },
			each(
				field("bodyKinds"),
				button(
					{
						class: field("cls"),
						title: field("title"),
						"aria-pressed": field("pressed"),
						"on:click": send("setBodyKind", sourceKey()),
					},
					field("text"),
				),
			),
		),
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
				cls: `btn btn-xs join-item ${kind === this.bodyKind ? "btn-primary" : ""}`,
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
		setUrl: setString("url"),
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
		setStatus: setString("status"),
		setDescription: setString("description"),
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
		setPath: setString("path"),
		setOperationId: setString("operationId"),
		setSummary: setString("summary"),
		setBodyRequired: {
			args: [t.boolean()],
			run(next, [required]) {
				next.bodyRequired = required;
			},
		},
		toggleBody(next, _args, ctx) {
			next.requestBody =
				this.requestBody === null ? schemaEditor(ctx.scope.components, TASKS.newTask.schema) : null;
		},
		addResponse(next, _args, ctx) {
			next.responses.push(
				ctx.scope.components.ApiResponse({ status: "default", description: "", schema: null }),
			);
		},
		removeResponse: {
			args: [t.index("responses")],
			run(next, [at]) {
				next.responses.splice(at, 1);
			},
		},
	},
});

const EXCHANGE_SECTIONS = ["checks", "operation", "request", "response"];
// A request and the response it got, checked against the operation they follow, if any.
export const HttpExchange = component({
	name: "HttpExchange",
	meta: metaFor(
		"HTTP exchange",
		"🔁",
		"A request and its response, checked against the API operation they follow.",
		560,
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
				cls: ok ? "http-ok text-success" : "http-fail text-error",
			}));
		},
		get failures() {
			return this.checks.filter((c) => !c.ok).length;
		},
		get summary() {
			const n = this.failures;
			return n === 0 ? "Everything checks out" : `${n} problem${n === 1 ? "" : "s"}`;
		},
		get summaryClass() {
			return `${BADGE} ${this.failures === 0 ? "badge-success" : "badge-error"}`;
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

// A worked example to start from, and to make each kind with: a tasks API, a web page on
// app.example.com reading one task from api.example.com.
const TASK = {
	type: "object",
	properties: {
		id: { type: "integer" },
		title: { type: "string", minLength: 1 },
		done: { type: "boolean" },
	},
	required: ["id", "title", "done"],
	additionalProperties: false,
};
const ERROR = {
	type: "object",
	properties: { message: { type: "string" } },
	required: ["message"],
};
export const TASKS = {
	operation: {
		method: "GET",
		path: "/tasks/{taskId}",
		operationId: "getTask",
		summary: "Get a task by its id.",
		parameters: [
			{ name: "taskId", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
			{ name: "fields", in: "query", schema: { type: "string" } },
		],
		responses: [
			{ status: "200", description: "The task.", schema: TASK },
			{ status: "404", description: "There's no task with that id.", schema: ERROR },
		],
	},
	request: {
		method: "GET",
		url: "https://api.example.com/v1/tasks/42?fields=title,done",
		headers: [
			["Accept", "application/json"],
			["Origin", "https://app.example.com"],
			["Authorization", "Bearer eyJhbGciOi…"],
		],
	},
	response: {
		status: 200,
		headers: [
			["Content-Type", "application/json"],
			["Cache-Control", "private, max-age=60"],
			["ETag", '"v7"'],
			["Access-Control-Allow-Origin", "https://app.example.com"],
			["Vary", "Origin"],
		],
		body: { id: 42, title: "Explain HTTP on a canvas", done: false },
	},
	// The other operation: creating a task, whose body follows a schema.
	newTask: {
		schema: {
			type: "object",
			properties: { title: { type: "string", minLength: 1 }, done: { type: "boolean" } },
			required: ["title"],
			additionalProperties: false,
		},
	},
	create: {
		operation: {
			method: "POST",
			path: "/tasks",
			operationId: "createTask",
			summary: "Create a task.",
			parameters: [],
			responses: [
				{ status: "201", description: "The task, created.", schema: TASK },
				{ status: "4XX", description: "The task isn't valid.", schema: ERROR },
			],
		},
		request: {
			method: "POST",
			url: "https://api.example.com/v1/tasks",
			headers: [["Content-Type", "application/json"]],
			body: { title: "Write the stories" },
		},
		response: {
			status: 201,
			headers: [
				["Content-Type", "application/json"],
				["Location", "/v1/tasks/43"],
			],
			body: { id: 43, title: "Write the stories", done: false },
		},
	},
};

// The JSON a card holds: a dropped JSON file replaces it.
const droppable = (C, v) => jsonRoot(C, v, { allowDrop: true });
const headers = (C, list) => list.map(([name, value]) => C.HttpHeader({ name, value }));

// Each part of the example, made with C.
export const httpHeader = (C, [name, value] = TASKS.request.headers[0]) =>
	C.HttpHeader({ name, value });
// A body as the fields take it: a string is text, anything else JSON.
const bodyOf = (C, body) =>
	body === undefined
		? { bodyKind: "none", body: null, bodyText: "" }
		: typeof body === "string"
			? { bodyKind: "text", body: null, bodyText: body }
			: { bodyKind: "json", body: droppable(C, body), bodyText: "" };
export const httpRequest = (C, { method, url, headers: hs, body } = TASKS.request) =>
	C.HttpRequest({ method, url, headers: headers(C, hs), ...bodyOf(C, body) });
export const httpResponse = (C, { status, headers: hs, body } = TASKS.response) =>
	C.HttpResponse({ status, headers: headers(C, hs), ...bodyOf(C, body) });
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
		parameters: droppable(C, op.parameters),
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
	request: { component: "HttpRequest", make: (C) => httpRequest(C) },
	response: { component: "HttpResponse", make: (C) => httpResponse(C) },
	header: { component: "HttpHeader", make: (C) => httpHeader(C) },
	operation: { component: "ApiOperation", make: (C) => apiOperation(C) },
	apiResponse: { component: "ApiResponse", make: (C) => apiResponse(C) },
	exchange: { component: "HttpExchange", make: (C) => httpExchange(C) },
	jsonSchema: {
		component: "JsonSchemaEditor",
		width: 420,
		make: (C) => schemaEditor(C, TASK),
	},
	json: {
		component: "JsonEditor",
		width: 420,
		make: (C) => C.JsonEditor({ mode: "view", value: droppable(C, TASKS.response.body).value }),
	},
};

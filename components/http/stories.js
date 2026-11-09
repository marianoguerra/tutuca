import { book, step } from "../../src/storybook/index.js";
import { $if, component, field, pushView, render, send, t, tag } from "../../src/tutuca.js";
import { TASKS } from "./fixtures.js";
import {
	apiOperation,
	apiResponse,
	createExchange,
	httpComponents,
	httpExchange,
	httpHeader,
	httpRequest,
	httpResponse,
} from "./index.js";

const { button, div } = tag;

// A part with a toggle that pushes its edit view, as a canvas item's does.
const Editable = component({
	name: "HttpEditable",
	fields: { content: t.component(), editing: t.boolean() },
	queries: {
		get pushed() {
			return this.editing ? "edit" : "main";
		},
		get toggleLabel() {
			return this.editing ? "Use it" : "Edit it";
		},
	},
	view: div(
		{ class: "flex max-w-xl flex-col items-start gap-2" },
		button(
			{
				class: "btn btn-xs",
				title: field("toggleLabel"),
				"aria-pressed": $if(field("editing"), "true", "false"),
				"on:click": send("toggle"),
			},
			field("toggleLabel"),
		),
		div({ class: "w-full" }, pushView(field("pushed"), render(field("content")))),
	),
	on: {
		toggle(next) {
			next.editing = !this.editing;
		},
	},
});

const editable = (make) => (C) => C.HttpEditable({ content: make(C) });
const edit = step.event("click", '[title="Edit it"]');
// Types value in the input labeled label, in what within selects when given.
const type = (label, value, within = "") =>
	step.event("input", `${within} [aria-label="${label}"]`.trim(), { value });
// The nth (from 1) header of a list being edited.
const nthHeader = (n, card = "") => `${card} .removable-row:nth-child(${n})`.trim();
const failing = (s) => s.content.checks.filter((c) => !c.ok).map((c) => c.text);
const fails = (name, pattern) =>
	step.check(name, (s) => failing(s).some((text) => pattern.test(text)));

export default book({
	title: "HTTP",
	components: { ...httpComponents, HttpEditable: Editable },
	stories: {
		Header: {
			make: editable((C) => httpHeader(C)),
			sequences: {
				"a known header says what it's for": [
					step.check("Accept is explained", (s) => s.content.doc.startsWith("The media types")),
					edit,
					type("Header name", "X-Custom"),
					step.check("an unknown one isn't", (s) => s.content.doc === ""),
				],
			},
		},
		Request: {
			make: editable((C) => httpRequest(C)),
			sequences: {
				"its URL's parts, its wire form and a method that changes things": [
					step.check("the query parameter", (s) =>
						s.content.urlParts.some((r) => r.name === "?fields" && r.value === "title,done"),
					),
					step.check("on the wire, the path and the Host", (s) =>
						s.content.wire.startsWith(
							"GET /v1/tasks/42?fields=title,done HTTP/1.1\nHost: api.example.com\n",
						),
					),
					step.check("GET is safe", (s) => s.content.traits.startsWith("Safe")),
					edit,
					step.event("change", '[aria-label="Method"]', { value: "POST" }),
					step.check("POST isn't", (s) => s.content.traits.startsWith("Neither")),
					step.event("click", '[title="JSON body"]'),
					step.check("a JSON body", (s) => s.content.toJson().bodyType === "json"),
					step.event("click", '[title="Add a header"]'),
					type("Header name", "Content-Type", nthHeader(4)),
					type("Header value", "application/json", nthHeader(4)),
					step.check("four headers", (s) => s.content.toJson().headers.length === 4),
					step.event("click", '[title="Remove this header"]'),
					step.check("Accept is gone", (s) => s.content.headers[0].name === "Origin"),
				],
			},
		},
		"Request/Text body": {
			make: editable((C) => httpRequest(C, TASKS.create.request)),
			sequences: {
				"JSON to text and back, and text that isn't JSON": [
					edit,
					step.event("click", '[title="Text body"]'),
					step.check(
						"its JSON, as text",
						(s) => s.content.toJson().body === '{\n  "title": "Write the stories"\n}',
					),
					type("Body text", '{ "title": "Edited as text", "done": true }'),
					step.event("click", '[title="JSON body"]'),
					step.check("parsed back to JSON", (s) => s.content.toJson().body.done === true),
					step.event("click", '[title="Text body"]'),
					type("Body text", "title=plain"),
					step.check("text on the wire, as it is", (s) =>
						s.content.wire.endsWith("\n\ntitle=plain"),
					),
					step.event("click", '[title="JSON body"]'),
					step.check(
						"not JSON: the JSON it had",
						(s) => s.content.toJson().body.title === "Edited as text",
					),
					step.event("click", '[title="No body"]'),
					step.check("no body", (s) => !("body" in s.content.toJson())),
				],
			},
		},
		Response: {
			make: editable((C) => httpResponse(C)),
			sequences: {
				"what caches may do, and statuses": [
					step.check("fresh for a minute", (s) =>
						s.content.caching.some((c) => c.text.includes("fresh for 60 seconds")),
					),
					step.check("success", (s) => s.content.statusLabel === "Success"),
					edit,
					type("Status", "503"),
					step.check("a server error", (s) => s.content.reason === "Service Unavailable"),
					type("Status", "42"),
					step.check("not a status, kept", (s) => s.content.status === 503),
					type("Header value", "no-store", nthHeader(2)),
					step.check("no-store", (s) => s.content.caching[0].text.includes("no-store")),
				],
			},
		},
		"Response/Not found": {
			make: editable((C) =>
				httpResponse(C, {
					status: 404,
					headers: [["Content-Type", "application/json"]],
					body: { message: "No task 42." },
				}),
			),
		},
		"Documented response": { make: editable((C) => apiResponse(C)) },
		Operation: {
			make: editable((C) => apiOperation(C)),
			sequences: {
				"its OpenAPI document, and a body it takes": [
					step.check("the path under paths, the method lowercased", (s) => {
						const { paths } = s.content.toOpenApi();
						return paths["/tasks/{taskId}"].get.operationId === "getTask";
					}),
					edit,
					step.event("click", '[title="Toggle the request body"]'),
					step.check("a request body", (s) => "requestBody" in s.content.toJson()),
					step.event("click", '[title="Add a response"]'),
					step.check("a default response", (s) => "default" in s.content.toJson().responses),
				],
			},
		},
		Exchange: {
			make: editable((C) => httpExchange(C)),
			sequences: {
				"everything checks out, then the request strays from the operation": [
					step.check("no problems", (s) => s.content.failures === 0),
					edit,
					type("URL", "https://api.example.com/v1/tasks/zero"),
					fails("taskId isn't an integer", /taskId, "zero": \$ should be integer/),
					type("URL", "https://api.example.com/v1/projects/42"),
					fails("another path", /isn't \/tasks\/\{taskId\}/),
					type("URL", "https://api.example.com/v1/tasks/42"),
					step.check("back to none", (s) => s.content.failures === 0),
				],
				"the response the operation doesn't document, and CORS": [
					edit,
					type("Status", "500", ".http-response"),
					fails("an undocumented status", /doesn't document a 500/),
					type("Status", "200", ".http-response"),
					type("Header value", "https://evil.example.com", nthHeader(4, ".http-response")),
					fails("another origin", /CORS: it allows https:\/\/evil.example.com/),
				],
			},
		},
		"Exchange/Create": {
			make: editable((C) => createExchange(C)),
			sequences: {
				"a body that doesn't follow the schema": [
					step.check("matches at first", (s) => s.content.failures === 0),
					step.check("a 201", (s) => s.content.response.status === 201),
				],
			},
		},
		"Exchange/Text body": {
			make: editable((C) => createExchange(C)),
			sequences: {
				"a text body is checked as JSON when its Content-Type says so": [
					edit,
					step.event("click", '.http-request [title="Text body"]'),
					step.check("it parses: still fine", (s) => s.content.failures === 0),
					type("Body text", '{ "title": "" }', ".http-request"),
					fails("its title is checked", /\$\.title should be at least 1 long/),
					type("Body text", "title=Plain", ".http-request"),
					fails("not JSON", /Content-Type is application\/json, and its text isn't JSON/),
				],
			},
		},
		"Exchange/Broken": {
			make: editable((C) =>
				C.HttpExchange({
					operation: apiOperation(C, TASKS.create.operation, TASKS.newTask.schema),
					request: httpRequest(C, {
						...TASKS.create.request,
						headers: [["Origin", "https://app.example.com"]],
						body: { title: "", priority: 1 },
					}),
					response: httpResponse(C, {
						status: 201,
						headers: [["Content-Type", "text/plain"]],
						body: { id: "43" },
					}),
				}),
			),
			sequences: {
				"every problem it has": [
					fails("an empty title", /\$\.title should be at least 1 long/),
					fails("an extra property", /\$\.priority isn't allowed/),
					fails("a response body off its schema", /\$\.id should be integer/),
					fails("no Content-Type on the request", /request has a JSON body and no Content-Type/),
					fails("text/plain on JSON", /text\/plain, its body is JSON/),
					fails("no CORS header", /no Access-Control-Allow-Origin/),
				],
			},
		},
	},
});

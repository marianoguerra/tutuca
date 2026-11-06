import assert from "node:assert/strict";
import test from "node:test";
import {
	cachingOf,
	checkExchange,
	documentedResponse,
	matchPath,
	parseUrl,
	rawRequest,
} from "../../components/http/check.js";

test("matchPath: path parameters, and the base before the template", () => {
	assert.deepEqual(matchPath("/tasks/{taskId}", "/v1/tasks/42"), {
		params: { taskId: "42" },
		base: "/v1",
	});
	assert.deepEqual(matchPath("/tasks", "/tasks"), { params: {}, base: "" });
	assert.equal(matchPath("/tasks/{taskId}", "/v1/projects/42"), null);
	assert.equal(matchPath("/tasks/{taskId}/notes", "/tasks"), null);
	assert.deepEqual(matchPath("/files/{name}", "/files/a%20b").params, { name: "a b" });
});

test("parseUrl: the parts, or not a URL", () => {
	const u = parseUrl("https://api.example.com:8443/v1/x?a=1&b=two");
	assert.deepEqual(
		[u.origin, u.path, u.query, u.target],
		[
			"https://api.example.com:8443",
			"/v1/x",
			[
				["a", "1"],
				["b", "two"],
			],
			"/v1/x?a=1&b=two",
		],
	);
	assert.equal(parseUrl("/relative").ok, false);
});

test("rawRequest: the request line, a Host from the URL and the headers", () => {
	const raw = rawRequest({
		method: "POST",
		url: "https://h.example/a?b=1",
		headers: [["Content-Type", "application/json"]],
		body: { x: 1 },
	});
	assert.equal(
		raw,
		'POST /a?b=1 HTTP/1.1\nHost: h.example\nContent-Type: application/json\n\n{\n  "x": 1\n}',
	);
});

test("cachingOf: no-store, max-age, private, no-cache and ETag", () => {
	const of = (status, cc, etag) =>
		cachingOf({
			status,
			headers: [
				...(cc === undefined ? [] : [["cache-control", cc]]),
				...(etag ? [["ETag", etag]] : []),
			],
		});
	assert.match(of(200, "no-store, max-age=5")[0], /no-store/);
	assert.equal(of(200, "private, max-age=60").length, 2);
	assert.match(
		of(200, "public, no-cache", '"a"').join(" "),
		/Shared.*asks the server.*If-None-Match: "a"/,
	);
	assert.match(of(201)[0], /isn't cacheable by default/);
	assert.match(of(200)[0], /heuristics/);
});

test("documentedResponse: the exact status, then its class, then default", () => {
	const responses = { 200: { description: "a" }, "4XX": { description: "b" }, default: {} };
	assert.equal(documentedResponse(responses, 200).key, "200");
	assert.equal(documentedResponse(responses, 404).key, "4XX");
	assert.equal(documentedResponse(responses, 500).key, "default");
	assert.equal(documentedResponse({ 200: {} }, 500), null);
});

test("checkExchange: parameters, a required body, header parameters and CORS", () => {
	const operation = {
		method: "PUT",
		path: "/items/{id}",
		parameters: [
			{ name: "id", in: "path", schema: { type: "integer" } },
			{ name: "limit", in: "query", required: true, schema: { type: "integer", maximum: 10 } },
			{ name: "X-Key", in: "header", required: true },
		],
		requestBody: {
			required: true,
			content: { "application/json": { schema: { type: "object" } } },
		},
		responses: { 204: { description: "Done." } },
	};
	const texts = (request, response) =>
		checkExchange(operation, request, response)
			.filter((c) => !c.ok)
			.map((c) => c.text);
	const request = {
		method: "PUT",
		url: "https://x.example/items/7?limit=50",
		headers: [["Origin", "https://y.example"]],
	};
	assert.deepEqual(texts(request, { status: 204, headers: [] }), [
		'The query parameter limit, "50": $ should be at most 10.',
		"The header parameter X-Key is missing.",
		"The request needs a body, and has none.",
		"CORS: no Access-Control-Allow-Origin, so the browser hides the response from https://y.example.",
	]);
	const fixed = {
		...request,
		url: "https://x.example/items/7?limit=5",
		headers: [
			["origin", "https://y.example"],
			["x-key", "k"],
			["Content-Type", "application/json; charset=utf-8"],
		],
		body: {},
	};
	assert.deepEqual(
		texts(fixed, { status: 204, headers: [["Access-Control-Allow-Origin", "*"]] }),
		[],
	);
	// Same origin: CORS has nothing to say.
	const same = { ...fixed, headers: [...fixed.headers.slice(1), ["Origin", "https://x.example"]] };
	assert.ok(
		!checkExchange(operation, same, { status: 204, headers: [] }).some((c) => /CORS/.test(c.text)),
	);
});

test("checkExchange without an operation: only the headers and CORS", () => {
	const checks = checkExchange(
		null,
		{ method: "GET", url: "https://x.example/", headers: [], body: { a: 1 } },
		{ status: 200, headers: [] },
	);
	assert.deepEqual(
		checks.map((c) => c.text),
		[
			"The request has a JSON body and no Content-Type.",
			"A GET with a body: servers and caches may ignore it.",
		],
	);
	assert.deepEqual(checkExchange(null, { method: "GET", url: "nope", headers: [] }, {}), [
		{ ok: false, text: "nope isn't a URL." },
	]);
});

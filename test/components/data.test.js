// The data meta law, on what each bundle makes: a component that says what its data is loads
// its data back as itself, and refuses data that doesn't fit its schema, saying why.
import assert from "node:assert/strict";
import test from "node:test";
import { HTTP_KINDS, httpComponents } from "../../components/http/index.js";
import { jsonComponents } from "../../components/json/index.js";
import { kanbanComponents } from "../../components/kanban/index.js";
import { LLM_KINDS, llmComponents } from "../../components/llm/index.js";
import { lint } from "../../src/lint/index.js";
import { dataOf, dataSchema, hasDataMeta, loadData, query, withSample } from "../../src/tutuca.js";
import { scopeWith } from "../helpers.js";

const BUNDLES = [
	["http", httpComponents, HTTP_KINDS],
	["llm", llmComponents, LLM_KINDS],
];
const roundTrips = (c) => {
	const { data } = dataOf(c);
	const json = query(c, data);
	const { next, error } = loadData(c, json);
	assert.equal(error, undefined, `${c.constructor?.name ?? "it"} loads its own data`);
	assert.deepEqual(query(next, data), json);
};

for (const [bundle, components, kinds] of BUNDLES) {
	test(`${bundle}: each kind with a data meta loads its data back`, () => {
		const C = scopeWith(components).components;
		const loaded = [];
		for (const [id, kind] of Object.entries(kinds)) {
			const c = kind.make(C, {});
			if (!hasDataMeta(c)) continue;
			roundTrips(c);
			loaded.push(id);
		}
		assert.ok(loaded.length > 0);
	});
	test(`${bundle}: lint finds no data meta problems`, () => {
		const issues = lint(Object.values(components)).filter((i) => i.code === "data-meta");
		assert.deepEqual(issues, []);
	});
}

test("json and kanban load their data back, the board's sample too", () => {
	const J = scopeWith(jsonComponents).components;
	roundTrips(J.JsonRoot({ value: J.JsonNull() }));
	const K = scopeWith(kanbanComponents).components;
	roundTrips(withSample(K.Board({}), "week"));
});

test("data that doesn't fit the schema is refused, saying where", () => {
	const C = scopeWith(httpComponents).components;
	const req = HTTP_KINDS.request.make(C, {});
	const { error } = loadData(req, { method: "FETCH", url: 1 }, "request.json");
	assert.match(error, /\$\.method/);
	assert.match(error, /\$\.url/);
	assert.equal(dataSchema(req).required.includes("url"), true);
});

test("an operation loads from an OpenAPI document's first operation", () => {
	const C = scopeWith(httpComponents).components;
	const op = HTTP_KINDS.operation.make(C, {});
	const doc = query(op, "asJson");
	const { method, path, ...rest } = doc;
	const openapi = { openapi: "3.1.0", paths: { [path]: { [method.toLowerCase()]: rest } } };
	assert.deepEqual(query(loadData(op, openapi).next, "asJson"), doc);
});

test("a transcript loads messages, replacing what it said", () => {
	const C = scopeWith(llmComponents).components;
	const tr = LLM_KINDS.transcript.make(C, {});
	const messages = [{ role: "user", content: "hi" }];
	const { next } = loadData(tr, messages);
	assert.deepEqual(next.messages, messages);
	assert.equal(next.entries.length, 1);
	assert.match(loadData(tr, { role: "user" }).error, /isn't/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { approxTokens } from "../../components/llm/index.js";
import { validate } from "../../components/llm/validate.js";

const texts = (schema, value) => validate(schema, value).map((p) => `${p.path} ${p.message}`);

test("validate: types, required and extra properties", () => {
	const schema = {
		type: "object",
		properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 } },
		required: ["name"],
		additionalProperties: false,
	};
	assert.deepEqual(texts(schema, { name: "Ada", age: 36 }), []);
	assert.deepEqual(texts(schema, { age: -1.5, extra: true }), [
		"$ is missing name",
		"$.age should be integer, is number",
		"$.extra isn't allowed",
	]);
	assert.deepEqual(texts(schema, []), ["$ should be object, is array"]);
	assert.deepEqual(texts({ type: "number" }, 3), [], "an integer is a number");
});

test("validate: enum, const, items, lengths and patterns", () => {
	assert.deepEqual(texts({ enum: ["a", "b"] }, "c"), ['$ should be one of "a", "b"']);
	assert.deepEqual(texts({ const: { x: 1 } }, { x: 1 }), []);
	assert.deepEqual(
		texts({ type: "array", items: { type: "string", maxLength: 2 }, minItems: 3 }, ["ab", "abc"]),
		["$ should have at least 3 items", "$[1] should be at most 2 long"],
	);
	assert.deepEqual(texts({ type: "string", pattern: "^\\d+$" }, "12a"), ["$ should match ^\\d+$"]);
});

test("validate: combinators, refs and boolean schemas", () => {
	assert.deepEqual(texts(true, 1), []);
	assert.deepEqual(texts(false, 1), ["$ nothing is allowed here"]);
	assert.deepEqual(texts({ anyOf: [{ type: "string" }, { type: "null" }] }, null), []);
	assert.deepEqual(texts({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1), [
		"$ should match exactly one of oneOf, matches 2",
	]);
	assert.deepEqual(texts({ not: { type: "string" } }, "x"), ["$ should not match not"]);
	const tree = {
		$defs: { node: { type: "object", properties: { next: { $ref: "#/$defs/node" } } } },
		$ref: "#/$defs/node",
	};
	assert.deepEqual(texts(tree, { next: { next: {} } }), []);
	assert.deepEqual(texts(tree, { next: 1 }), ["$.next should be object, is integer"]);
	assert.deepEqual(texts({ $ref: "#/$defs/missing" }, 1), [
		"$ $ref #/$defs/missing points at nothing",
	]);
});

test("approxTokens: about four characters each, none for no text", () => {
	assert.equal(approxTokens(""), 0);
	assert.equal(approxTokens("hi"), 1);
	assert.equal(approxTokens("x".repeat(40)), 10);
});

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { fromJson, jsonComponents } from "../../components/json/index.js";
import { arbitraries, Driver } from "../../src/test/pbt.js";
import { document, scopeWith, testGenericProperties, testLintsClean, textOf } from "../helpers.js";

const setup = () => {
	const scope = scopeWith(jsonComponents);
	return { scope, C: scope.components, A: arbitraries({ fc, scope }) };
};

testLintsClean("JSON", jsonComponents);

testGenericProperties(jsonComponents);

test("fromJson and toJson round trip", () => {
	const { C } = setup();
	fc.assert(
		fc.property(fc.jsonValue({ maxDepth: 3 }), (v) => {
			const normal = JSON.parse(JSON.stringify(v));
			assert.deepEqual(fromJson(C, normal).toJson(), normal);
		}),
		{ numRuns: 100 },
	);
});

test("the main view reads as JSON", () => {
	const { C } = setup();
	const doc = { a: [1, "x", true, null], b: {} };
	assert.equal(textOf(fromJson(C, doc)), JSON.stringify(doc));
});

test("the edit view shows the same text, with inputs in place of values", () => {
	const { C } = setup();
	const root = C.JsonEditor({ mode: "edit", value: fromJson(C, { a: "x", n: 2 }) });
	const driver = new Driver({ root, document });
	const inputs = [...driver.rootNode.querySelectorAll("input:not([type=checkbox])")];
	assert.deepEqual(
		inputs.map((i) => [i.getAttribute("aria-label"), i.value]),
		[
			["key", "a"],
			["string value", "x"],
			["key", "n"],
			["number value", "2"],
		],
	);
});

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { fromJson, jsonComponents, jsonRoot } from "../../components/json/index.js";
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

const click = (driver, selector, index = 0) => {
	driver.rootNode
		.querySelectorAll(selector)
		[index].dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true }));
	driver.drain();
};
// Every collection's open state, depth first.
const opens = (v) => {
	const kids = v.items ?? v.entries?.map((e) => e.value) ?? [];
	return [...("open" in v ? [v.open] : []), ...kids.flatMap(opens)];
};

test("a collection's open bracket collapses it to a summary, and opens it again", () => {
	const { C } = setup();
	const driver = new Driver({ root: fromJson(C, { a: [1, 2], b: {} }), document });
	click(driver, ".json-toggle");
	assert.equal(driver.state.open, false);
	assert.match(textOf(driver.state), /^{…}2 ?keys$/);
	click(driver, ".json-toggle");
	assert.equal(textOf(driver.state), JSON.stringify({ a: [1, 2], b: {} }));
});

test("a root's expand all and collapse all reach every collection", () => {
	const { C } = setup();
	const driver = new Driver({ root: jsonRoot(C, { a: [1, { b: [] }], c: { d: [2] } }), document });
	click(driver, ".collapse-all");
	assert.ok(opens(driver.state.value).every((o) => !o));
	click(driver, ".expand-all");
	assert.ok(opens(driver.state.value).every((o) => o));
});

test("a root around a scalar has nothing to expand", () => {
	const { C } = setup();
	const driver = new Driver({ root: jsonRoot(C, "text"), document });
	assert.equal(driver.rootNode.querySelector(".expand-all"), null);
});

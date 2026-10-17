import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { fromJson, jsonComponents } from "../components/json/index.js";
import { lint } from "../src/lint/index.js";
import { arbitraries, Driver, specProperties } from "../src/test/pbt.js";
import { Scope } from "../src/tutuca.js";

const { document } = new JSDOM("").window;
const setup = () => {
	const scope = new Scope(() => {});
	scope.register(jsonComponents);
	return { scope, C: scope.components, A: arbitraries({ fc, scope }) };
};

test("the JSON components lint clean", () => {
	const issues = lint(Object.values(jsonComponents), Object.keys(jsonComponents));
	assert.deepEqual(
		issues.map((i) => `${i.code} ${i.path}: ${i.message}`),
		[],
	);
});

for (const [name, spec] of Object.entries(jsonComponents)) {
	test(`${name} has the generic properties`, () => {
		const { A } = setup();
		for (const [propName, prop] of Object.entries(specProperties(spec, A, { document }))) {
			try {
				fc.assert(prop, { numRuns: 30 });
			} catch (error) {
				error.message = `${name}.${propName}: ${error.message}`;
				throw error;
			}
		}
	});
}

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

// The text of a render, without the tutuca comments and whitespace between elements.
const textOf = (root) => {
	const driver = new Driver({ root, document });
	return driver.rootNode.textContent.replace(/\s+/g, "");
};

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

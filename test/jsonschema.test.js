import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { jsonComponents } from "../components/json/index.js";
import { allOpen, schemaComponents } from "../components/jsonschema/index.js";
import { fromSchema, readKind, schemaTree } from "../components/jsonschema/read.js";
import { sample } from "../components/jsonschema/stories.js";
import { lint } from "../src/lint/index.js";
import { arbitraries, Driver, specProperties } from "../src/test/pbt.js";
import { Scope, selectorFrom } from "../src/tutuca.js";

const { document } = new JSDOM("").window;
const setup = () => {
	const scope = new Scope(() => {});
	scope.register({ ...jsonComponents, ...schemaComponents });
	return { scope, C: scope.components, A: arbitraries({ fc, scope }) };
};

test("the JSON Schema components lint clean", () => {
	const all = { ...jsonComponents, ...schemaComponents };
	const issues = lint(Object.values(schemaComponents), Object.keys(all));
	assert.deepEqual(
		issues.map((i) => `${i.code} ${i.path}: ${i.message}`),
		[],
	);
});

for (const [name, spec] of Object.entries(schemaComponents)) {
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

test("readKind follows the order a validator reads a schema in", () => {
	const cases = [
		[true, "any"],
		[false, "never"],
		[{}, "any"],
		[{ $ref: "#/x", type: "string" }, "ref"],
		[{ anyOf: [], type: "string" }, "anyOf"],
		[{ not: {}, enum: [1] }, "not"],
		[{ enum: [1], type: "string" }, "enum"],
		[{ const: 1, type: "string" }, "const"],
		[{ type: "integer" }, "integer"],
		[{ type: ["string", "null"] }, "union"],
		[{ required: ["a"] }, "object"],
		[{ items: {} }, "array"],
		[{ title: "only notes" }, "any"],
	];
	for (const [schema, kind] of cases) assert.equal(readKind(schema), kind, JSON.stringify(schema));
});

test("a schema reads back as itself when it only uses what the family models", () => {
	const { C } = setup();
	const back = fromSchema(C, sample).toSchema();
	assert.deepEqual(back, sample);
});

// Schemas from a small grammar of the keywords the family models.
const schemaArb = fc.letrec((tie) => ({
	schema: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		fc.constantFrom(true, false, {}, { type: "boolean" }, { type: "null" }),
		fc.record(
			{ type: fc.constant("string"), format: fc.string(), minLength: fc.nat() },
			{ requiredKeys: ["type"] },
		),
		fc.record(
			{ type: fc.constantFrom("number", "integer"), minimum: fc.integer(), multipleOf: fc.nat() },
			{ requiredKeys: ["type"] },
		),
		fc.record({ enum: fc.array(fc.jsonValue({ maxDepth: 1 }), { maxLength: 3 }) }),
		fc.record({ $ref: fc.string() }),
		fc.record({ not: tie("schema") }),
		fc.record({ anyOf: fc.array(tie("schema"), { maxLength: 3 }) }),
		fc.record(
			{ type: fc.constant("array"), items: tie("schema"), maxItems: fc.nat() },
			{ requiredKeys: ["type"] },
		),
		fc.record(
			{
				type: fc.constant("object"),
				title: fc.string(),
				properties: fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), tie("schema"), {
					maxKeys: 3,
				}),
				additionalProperties: tie("schema"),
			},
			{ requiredKeys: ["type", "properties"] },
		),
	),
})).schema;

test("reading a tree back is a fixed point", () => {
	const { C } = setup();
	fc.assert(
		fc.property(schemaArb, (schema) => {
			const normal = JSON.parse(JSON.stringify(schema));
			const once = fromSchema(C, normal).toSchema();
			assert.deepEqual(fromSchema(C, once).toSchema(), once);
		}),
		{ numRuns: 200 },
	);
});

test("generated trees read back to a fixed point", () => {
	const { A, C } = setup();
	fc.assert(
		fc.property(A.instance("SchemaRoot"), (root) => {
			const once = JSON.parse(JSON.stringify(root.toSchema())); // A schema is JSON text: no -0.
			assert.deepEqual(fromSchema(C, once).toSchema(), once);
		}),
		{ numRuns: 100 },
	);
});

const textOf = (root) => {
	const driver = new Driver({ root, document });
	return driver.rootNode.textContent.replace(/\s+/g, "");
};
const assertReads = (text, parts) => {
	for (const part of parts) {
		assert.ok(text.includes(part.replace(/\s+/g, "")), `${JSON.stringify(part)} in ${text}`);
	}
};

test("the semantic view reads as a data dictionary", () => {
	const { C } = setup();
	const text = textOf(schemaTree(C, sample));
	assertReads(text, [
		"object (10)",
		"One entry of a podcast feed.",
		"id * : string uuid",
		"title * : string ≥ 1 ≤ 200",
		"rating : number ≥ 0 ≤ 5",
		"notes : string null",
		"tags : ▾array of ≤ 10",
		"$ref #/$defs/person",
		"…and nothing",
	]);
});

test("the format view reads as keywords", () => {
	const { C } = setup();
	const text = textOf(schemaTree(C, sample, { view: "format" }));
	assertReads(text, [
		"title : Episode",
		"id : required",
		"durationSeconds : optional",
		"minLength : 1",
		"maxItems : 10",
		"additionalProperties",
	]);
});

test("a closed node hides what is below it", () => {
	const { C } = setup();
	const text = textOf(schemaTree(C, sample, { open: false }));
	assert.ok(text.includes("object(10)"));
	assert.ok(!text.includes("durationSeconds"));
});

const nested = {
	type: "object",
	properties: {
		a: { type: "object", properties: { b: { type: "array", items: { type: "string" } } } },
		c: { anyOf: [{ type: "string" }] },
		d: { type: "string" },
	},
};
const click = (driver, selector, init) => {
	const el = driver.rootNode.querySelectorAll(selector)[init.index ?? 0];
	el.dispatchEvent(
		new document.defaultView.MouseEvent("click", {
			bubbles: true,
			ctrlKey: init.ctrl,
			altKey: init.alt,
		}),
	);
	driver.drain();
};

test("a click toggles one node", () => {
	const { C } = setup();
	const driver = new Driver({ root: schemaTree(C, nested), document });
	click(driver, ".disclosure", { index: 1 }); // a
	const [a, c] = driver.state.node.properties.map((p) => p.schema);
	assert.equal(a.open, false);
	assert.equal(c.open, true);
	assert.equal(a.properties[0].schema.open, true);
});

test("a ctrl click toggles a node and its siblings", () => {
	const { C } = setup();
	const driver = new Driver({ root: schemaTree(C, nested), document });
	click(driver, ".disclosure", { index: 1, ctrl: true }); // a
	const { node } = driver.state;
	assert.equal(node.open, true);
	assert.deepEqual(
		node.properties.map((p) => p.schema.open),
		[false, false, undefined],
	);
	assert.equal(node.properties[0].schema.properties[0].schema.open, true);
	assert.deepEqual(driver.problems, []);
});

test("a ctrl+alt click toggles a node and everything below it", () => {
	const { C } = setup();
	const driver = new Driver({ root: schemaTree(C, nested), document });
	click(driver, ".disclosure", { index: 1, ctrl: true, alt: true }); // a
	const [a, c] = driver.state.node.properties.map((p) => p.schema);
	assert.deepEqual(allOpen(a), [false, false]);
	assert.equal(c.open, true);
});

test("expand all and collapse all reach every node", () => {
	const { C } = setup();
	const driver = new Driver({ root: schemaTree(C, nested), document });
	click(driver, ".collapse-all", {});
	assert.ok(allOpen(driver.state.node).every((o) => !o));
	click(driver, ".expand-all", {});
	assert.ok(allOpen(driver.state.node).every((o) => o));
});

test("a property passes setOpen to its schema", () => {
	const { C } = setup();
	const driver = new Driver({ root: schemaTree(C, nested), document });
	driver.send(
		selectorFrom((b) => b.field("node").item("properties", 0)),
		"setOpen",
		[false],
	);
	assert.equal(driver.state.node.properties[0].schema.open, false);
});

test("a long list shows one page at a time", () => {
	const { C } = setup();
	const schema = { enum: Array.from({ length: 12 }, (_, i) => `v${i}`) };
	const driver = new Driver({ root: schemaTree(C, schema, { perPage: 5 }), document });
	const shown = () =>
		[...driver.rootNode.querySelectorAll(".schema-enum .text-success")].map((n) => n.textContent);
	assert.deepEqual(shown(), ['"v0"', '"v1"', '"v2"', '"v3"', '"v4"']);
	click(driver, ".pager .last", {});
	assert.deepEqual(shown(), ['"v10"', '"v11"']);
	assert.match(driver.rootNode.querySelector(".pager .range").textContent, /11\s*–\s*12\s*of\s*12/);
});

test("a short list has no pager", () => {
	const { C } = setup();
	const root = schemaTree(C, { enum: [1, 2] }, { perPage: 5 });
	assert.equal(root.node.pager, null);
});

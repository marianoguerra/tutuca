// The scenarios of spec/view/normalize.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { component } from "../src/component/class.js";
import { keyOf, normalize } from "../src/view/normalize.js";
import { comment, el, group, text } from "../src/view/sem.js";

test("values become text, null becomes nothing", () => {
	assert.deepEqual(normalize(null), []);
	assert.deepEqual(normalize(undefined), []);
	assert.deepEqual(normalize("hi"), [text("hi")]);
	assert.deepEqual(normalize(1), [text("1")]);
	assert.deepEqual(normalize(true), [text("true")]);
});

test("records are not iterable; a component has no String()", () => {
	assert.deepEqual(normalize({ a: 1 }), [text("[object Object]")]);
	assert.throws(() => normalize(component({ name: "C" }).make()), TypeError);
});

test("nodes are already nodes", () => {
	assert.deepEqual(normalize(comment("c")), [comment("c")]);
	assert.deepEqual(normalize(group(null, [])), [group(null, [])]);
});

test("iterables flatten to any depth and drop nulls along the way", () => {
	assert.deepEqual(normalize([1, [true, [null, "x"]]]), [text("1"), text("true"), text("x")]);
	assert.deepEqual(normalize([]), []);
	const nodes = [group("a", [text("A")]), el(0, "b", null, null, {}, [])];
	assert.deepEqual(normalize(nodes), nodes);
	assert.deepEqual(normalize(new Set(["a", "b"])), [text("a"), text("b")]);
});

test("keys become strings; null is no key", () => {
	assert.equal(keyOf(null), null);
	assert.equal(keyOf(1), "1");
	assert.equal(keyOf("k"), "k");
});

const { result: anyResult } = fc.letrec((tie) => ({
	result: fc.oneof(
		{ maxDepth: 3 },
		fc.constantFrom(null, true, 0, "", "x", 1.5, text("t"), comment("c"), group("k", [])),
		fc.integer().map((a) => ({ a })),
		fc.array(tie("result"), { maxLength: 3 }),
	),
}));

test("normalizing a normalized sequence changes nothing", () => {
	fc.assert(
		fc.property(anyResult, (result) => {
			const nodes = normalize(result);
			assert.deepEqual(normalize(nodes), nodes);
		}),
		{ numRuns: 300 },
	);
});

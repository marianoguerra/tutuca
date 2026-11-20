// The scenarios of spec/component/types.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { defaultOf, makeField, NoDefaultError, t, valid } from "../src/component/types.js";

test("a scalar type accepts the values of its kind", () => {
	assert.equal(valid(t.any(), [1]), true);
	assert.equal(valid(t.string(), "a"), true);
	assert.equal(valid(t.string(), 1), false);
	assert.equal(valid(t.number(), 1.5), true);
	assert.equal(valid(t.number(), NaN), false);
	assert.equal(valid(t.boolean(), false), true);
	assert.equal(valid(t.boolean(), 0), false);
});

test("constraints narrow a kind; a throwing predicate does not hold", () => {
	const digit = t.number().int().min(0).max(9);
	assert.deepEqual(digit.checks.length, 3);
	assert.equal(valid(digit, 3), true);
	assert.equal(valid(digit, 10), false);
	assert.equal(valid(t.number().int(), 1.5), false);
	assert.equal(valid(t.string().len(1), ""), false);
	assert.equal(valid(t.string().len(1, 2), "abc"), false);
	assert.equal(valid(t.string().min(1), "a"), false);
	assert.equal(
		valid(
			t.any().where((x) => x < 3),
			1,
		),
		true,
	);
	assert.equal(
		valid(
			t.any().where((x) => x.missing.deeper),
			"a",
		),
		false,
	);
	assert.equal(valid(t.string("d"), "x"), true);
});

test("defaults", () => {
	assert.equal(defaultOf(t.string()), "");
	assert.equal(defaultOf(t.number().min(1)), 1);
	assert.equal(defaultOf(t.number().max(-2)), -2);
});

test("makeField keeps a valid argument, otherwise gives the default", () => {
	assert.equal(makeField(t.number(), 5), 5);
	assert.equal(makeField(t.number(), "five"), 0);
	assert.equal(makeField(t.number()), 0);
	assert.equal(makeField(t.string("d")), "d");
});

test("a default that breaks the constraints is no default", () => {
	assert.throws(() => makeField(t.string().len(1)), NoDefaultError);
	assert.throws(() => makeField(t.number().min(1).default(0)), NoDefaultError);
});

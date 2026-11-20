// The scenarios of spec/component/types.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
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

test("containers accept values made of what they hold", () => {
	assert.equal(valid(t.option(t.number()), null), true);
	assert.equal(valid(t.array(t.enum("a", "b")), ["a", "b"]), true);
	assert.equal(valid(t.array(t.enum("a", "b")), ["c"]), false);
	assert.equal(valid(t.map(t.number()), { x: 1, y: 2 }), true);
	assert.equal(valid(t.oneOf(t.number(), t.string()), "x"), true);
	assert.equal(valid(t.array().len(1, 2), [1, 2, 3]), false);
});

test("records have exactly the keys of their shape", () => {
	assert.equal(valid(t.record({ a: t.number(), b: t.string() }), { b: "x", a: 1 }), true);
	assert.equal(valid(t.record({ a: t.number() }), { a: 1, b: 2 }), false);
	assert.equal(valid(t.record({ a: t.number() }), {}), false);
});

test("an index is a key of the owner's field; without an owner, only its kind is checked", () => {
	assert.equal(valid(t.index("items"), 1, { items: ["a", "b"] }), true);
	assert.equal(valid(t.index("items"), 2, { items: ["a", "b"] }), false);
	assert.equal(valid(t.index("items"), "x", { items: { x: 1 } }), true);
	assert.equal(valid(t.index("items"), 7), true);
});

test("defaults of containers", () => {
	assert.deepEqual(defaultOf(t.record({ a: t.number(), b: t.option(t.string()) })), {
		a: 0,
		b: null,
	});
	assert.equal(makeField(t.index("items"), undefined, { items: ["a"] }), 0);
	assert.throws(() => makeField(t.index("items"), undefined, { items: [] }), NoDefaultError);
	assert.throws(() => makeField(t.array().len(1)), NoDefaultError);
});

test("a record's default makes each key, and a union's its first alternative", () => {
	const three = (x) => x === 3;
	assert.throws(() => makeField(t.record({ n: t.number().min(1).where(three) })), NoDefaultError);
	assert.deepEqual(makeField(t.record({ n: t.number().where(three).default(3) })), { n: 3 });
	assert.throws(() => makeField(t.oneOf(t.string().len(1), t.number())), NoDefaultError);
	assert.equal(makeField(t.oneOf(t.string("a").len(1))), "a");
});

// Random types and values, as redex-check makes them in the model.
const { ty: anyType } = fc.letrec((tie) => ({
	ty: fc.oneof(
		{ maxDepth: 3 },
		fc.constantFrom(t.any(), t.string(), t.number(), t.boolean(), t.index("items")),
		fc
			.array(fc.constantFrom("a", "b", 1), { minLength: 1, maxLength: 3 })
			.map((vs) => t.enum(...vs)),
		tie("ty").map(t.option),
		tie("ty").map(t.array),
		tie("ty").map(t.map),
		fc.dictionary(fc.constantFrom("a", "b"), tie("ty"), { maxKeys: 2 }).map(t.record),
		fc.array(tie("ty"), { minLength: 1, maxLength: 2 }).map((ts) => t.oneOf(...ts)),
		fc.tuple(tie("ty"), fc.integer({ min: -2, max: 2 })).map(([ty, n]) => ty.min(n)),
		fc.tuple(tie("ty"), fc.integer({ min: -2, max: 2 })).map(([ty, n]) => ty.max(n)),
		fc.tuple(tie("ty"), fc.nat({ max: 2 })).map(([ty, n]) => ty.len(n)),
		tie("ty").map((ty) => ty.int()),
		tie("ty").map((ty) => ty.where((x) => x < 3)),
		fc.tuple(tie("ty"), fc.jsonValue()).map(([ty, v]) => ty.default(v)),
	),
}));
const anyValue = fc.oneof(fc.jsonValue(), fc.constantFrom(NaN, Infinity, "a", "b", 1));

const made = (ty, value) => {
	try {
		return { value: makeField(ty, value) };
	} catch (error) {
		assert.ok(error instanceof NoDefaultError);
		return null;
	}
};

test("makeField keeps every valid argument, and otherwise yields the default", () => {
	fc.assert(
		fc.property(anyType, anyValue, (ty, value) => {
			const field = made(ty, value);
			if (valid(ty, value)) assert.equal(field.value, value);
			else if (field !== null) assert.deepEqual(field.value, defaultOf(ty));
		}),
		{ numRuns: 500 },
	);
});

// Types whose .default(v) values have their type.
const wellFormed = (ty) => {
	switch (ty.kind) {
		case "Default":
			return wellFormed(ty.ty) && valid(ty.ty, ty.value);
		case "Record":
			return Object.values(ty.shape).every(wellFormed);
		case "Option":
		case "Array":
		case "Map":
		case "Refine":
			return wellFormed(ty.ty);
		case "OneOf":
			return ty.types.every(wellFormed);
		default:
			return true;
	}
};

test("makeField yields a valid value, for well-formed types", () => {
	fc.assert(
		fc.property(anyType, anyValue, (ty, value) => {
			const field = made(ty, value);
			if (field !== null && wellFormed(ty)) assert.equal(valid(ty, field.value), true);
		}),
		{ numRuns: 1000 },
	);
});

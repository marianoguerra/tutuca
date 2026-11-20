import assert from "node:assert/strict";
import test from "node:test";
import { produce } from "../../deps/immer.js";
import {
	compileType,
	component,
	field,
	findInvalid,
	h,
	isComponent,
	NumberType,
	specOf,
	t,
	typeProblems,
	t as types,
} from "../../src/tutuca.js";

const Task = component({
	name: "Task",
	fields: { title: t.string({ default: "Just do it" }), tags: t.array(), done: t.boolean() },
	methods: {
		label() {
			return this.done ? `${this.title} ✓` : this.title;
		},
	},
	view: h("span", {}, field("title")),
});

test("make fills defaults and rejects invalid values", () => {
	const t = Task.make({ title: 42, done: true });
	assert.equal(t.title, "Just do it");
	assert.equal(t.done, true);
	assert.deepEqual(t.tags, []);
});

test("array and object defaults are not shared between instances", () => {
	const a = Task.make();
	const b = Task.make();
	assert.notEqual(a.tags, b.tags);
});

test("instances expose methods and their spec", () => {
	const t = Task.make({ title: "Buy carrots" });
	assert.equal(t.label(), "Buy carrots");
	assert.equal(specOf(t), Task);
	assert.ok(isComponent(t));
	assert.ok(!isComponent({ title: "x" }));
	assert.ok(!isComponent(null));
});

test("produce keeps prototype and spec", () => {
	const t = Task.make({ title: "a" });
	const t2 = produce(t, (d) => {
		d.done = true;
		d.tags.push("x");
	});
	assert.notEqual(t, t2);
	assert.equal(t.done, false);
	assert.equal(t2.done, true);
	assert.deepEqual(t2.tags, ["x"]);
	assert.equal(specOf(t2), Task);
	assert.equal(t2.label(), "a ✓");
	assert.ok(Object.isFrozen(t2));
});

test("view becomes main next to named views", () => {
	const C = component({ name: "C", view: "main", views: { other: "other" } });
	assert.deepEqual(Object.keys(C.views).sort(), ["main", "other"]);
	assert.equal(C.views.main.eval({}), "main");
});

// An instance's fields, without its identity and scope (symbol keys).
const fieldsOf = (c) => Object.fromEntries(Object.entries(c));

test("option fields accept null, and missing values take the default", () => {
	const N = component({
		name: "N",
		fields: {
			s: t.option(t.string(), { default: "d" }),
			n: t.option(t.number(), { default: 1 }),
			b: t.option(t.boolean(), { default: true }),
			a: t.option(t.array(), { default: [1] }),
			m: t.option(t.map(), { default: { k: 1 } }),
			none: t.option(t.string()),
			strict: t.string({ default: "d" }),
		},
		view: "n",
	});
	const filled = N.make({ s: null, n: null, b: null, a: null, m: null, strict: null });
	const nulls = { s: null, n: null, b: null, a: null, m: null, none: null };
	assert.deepEqual(fieldsOf(filled), { ...nulls, strict: "d" });
	const defaults = { s: "d", n: 1, b: true, a: [1], m: { k: 1 }, none: null, strict: "d" };
	assert.deepEqual(fieldsOf(N.make()), defaults);
	assert.deepEqual(fieldsOf(N.make({ s: 1, n: "x", none: "v" })), { ...defaults, none: "v" });
});

test("types have zero defaults; a type is data, compiled into a Type", () => {
	const Z = component({
		name: "Z",
		fields: { s: t.string(), n: t.number(), b: t.boolean(), a: t.array(), m: t.map() },
		view: "z",
	});
	assert.deepEqual(fieldsOf(Z.make()), { s: "", n: 0, b: false, a: [], m: {} });
	assert.deepEqual(types.int({ min: 0, default: 3 }), {
		type: "number",
		int: true,
		min: 0,
		default: 3,
	});
	assert.ok(Object.isFrozen(types.array(types.string())));
	assert.deepEqual(types.array(types.string()).of, { type: "string" });
	const three = compileType({ type: "number", default: 3 });
	assert.ok(three instanceof NumberType);
	assert.equal(three.defaultValue, 3);
	assert.equal(compileType("number").defaultValue, 0, "a kind's name is its type with no options");
});

test("type data is checked as it's written and as it's compiled", () => {
	assert.throws(() => types.number({ minLength: 1 }), /a number doesn't take minLength/);
	assert.throws(
		() => types.string({ pattern: "(" }),
		/pattern must be a regular expression's source/,
	);
	assert.throws(() => types.enum([]), /values must be a non-empty array/);
	assert.throws(() => compileType({ type: "list" }), /type "list" isn't a kind/);
	assert.deepEqual(
		typeProblems({ type: "record", fields: { a: "nope", b: { type: "array", of: 1 } } }),
		[
			"a: \"nope\" isn't a type's kind (any, string, boolean, number, enum, option, array, map, record, oneOf, index, component)",
			"b.of: a type is a kind's name or { type: kind, ... }, not 1",
		],
	);
	assert.throws(() => compileType({ type: "string", check: "iso" }), /No check iso/);
	assert.throws(
		() => component({ name: "Bad", fields: { n: { type: "number", sync: "everywhere" } } }),
		/Component Bad: Not a type: fields.n: number's sync must be one of shared, local, none/,
	);
});

test("constraints narrow what a type accepts and bounds pull the default in", () => {
	const n = compileType(types.int({ min: 1, max: 10 }));
	assert.equal(n.defaultValue, 1);
	assert.deepEqual(
		[3, 0, 11, 1.5, "3"].map((v) => n.isValid(v, null)),
		[true, false, false, false, false],
	);
	const s = compileType(
		types.string({ minLength: 1, maxLength: 3, pattern: "^[a-z]+$", default: "ab" }),
	);
	assert.deepEqual(
		["a", "", "abcd", "A"].map((v) => s.isValid(v, null)),
		[true, false, false, false],
	);
	const odd = compileType(types.number({ default: 1, check: "odd" }), { odd: (v) => v % 2 === 1 });
	assert.deepEqual([odd.isValid(3, null), odd.isValid(2, null)], [true, false]);
	const nonEmpty = compileType(types.array("any", { minLength: 1 }));
	assert.equal(nonEmpty.isValid([], null), false);
	assert.throws(() => nonEmpty.make(undefined, null), /has no default/);
	assert.deepEqual(nonEmpty.make([1], null), [1]);
	assert.equal(
		compileType(types.map("any", { maxLength: 1 })).isValid({ a: 1, b: 2 }, null),
		false,
	);
});

test("a named check tests values, and may say how pbt generates them", () => {
	const arb = () => "generated";
	const type = compileType(types.string({ check: ["short", "lower"] }), {
		short: { test: (v) => v.length < 3, arb, description: "under 3 letters" },
		lower: (v) => v === v.toLowerCase(),
	});
	assert.deepEqual(
		["ab", "abc", "AB"].map((v) => type.isValid(v, null)),
		[true, false, false],
	);
	assert.equal(type.generator, arb);
	assert.deepEqual(
		type.constraints.check.map((c) => [c.name, c.description]),
		[
			["short", "under 3 letters"],
			["lower", "lower"],
		],
	);
	assert.equal(
		compileType(types.number({ check: "whole" }), { whole: { arb } }).isValid(1.5, null),
		true,
	);
});

test("enum, record and oneOf check members, shape and alternatives", () => {
	const e = compileType(types.enum(["edit", "view"]));
	assert.equal(e.makeDefault(null), "edit");
	assert.deepEqual([e.isValid("view", null), e.isValid("other", null)], [true, false]);
	const r = compileType(types.record({ x: types.number(), label: types.option(types.string()) }));
	assert.deepEqual(r.makeDefault(null), { x: 0, label: null });
	assert.equal(r.isValid({ x: 1, label: "a" }, null), true);
	assert.equal(r.isValid({ x: 1 }, null), false, "a missing key is invalid");
	assert.equal(r.isValid({ x: 1, label: null, extra: 1 }, null), false, "extra keys are invalid");
	const u = compileType(types.oneOf([types.string({ default: "a" }), types.number()]));
	assert.equal(u.makeDefault(null), "a");
	assert.deepEqual(
		[u.isValid(1, null), u.isValid("s", null), u.isValid(true, null)],
		[true, true, false],
	);
});

test("record and oneOf defaults meet the constraints of what they are made of", () => {
	const checks = { three: (v) => v === 3 };
	const r = compileType(types.record({ n: types.number({ min: 1, check: "three" }) }), checks);
	assert.throws(() => r.make(undefined, null), /n: has no default/);
	const made = compileType(
		types.record({ n: types.number({ min: 1, check: "three", default: 3 }) }),
		checks,
	);
	assert.deepEqual(made.make(undefined, null), { n: 3 });
	const u = compileType(types.oneOf([types.string({ minLength: 1 }), types.number()]));
	assert.throws(() => u.make(undefined, null), /has no default/);
	assert.equal(
		compileType(types.oneOf([types.string({ minLength: 1, default: "a" })])).make(undefined, null),
		"a",
	);
});

test("index fields are keys of a sibling collection", () => {
	const Sel = component({
		name: "Sel",
		fields: {
			items: t.array("any", { default: ["a", "b"] }),
			selected: t.index("items"),
			byId: t.map(),
			current: t.option(t.index("byId")),
		},
		view: "sel",
	});
	const sel = Sel.make();
	assert.equal(sel.selected, 0);
	assert.equal(sel.current, null);
	assert.equal(Sel.make({ selected: 5 }).selected, 0, "an out of range key takes the default");
	assert.equal(Sel.make({ byId: { k: 1 }, current: "k" }).current, "k");
	assert.throws(() => Sel.make({ items: [] }), /Sel.selected: items has no key/);
	const invalid = Object.assign(Sel.make(), { selected: 2 });
	assert.deepEqual(
		findInvalid(invalid, null).map((i) => i.field),
		["selected"],
	);
});

test("index types inside arrays, maps and records are checked against the owner's field", () => {
	const Picks = component({
		name: "Picks",
		fields: {
			items: t.array("any", { default: ["a", "b"] }),
			picked: t.array(t.index("items")),
			byName: t.map(t.index("items")),
			pair: t.record({ first: t.index("items") }),
		},
		view: "picks",
	});
	const picks = Picks.make({ picked: [0, 1], byName: { x: 1 } });
	assert.deepEqual(picks.picked, [0, 1]);
	assert.deepEqual(picks.byName, { x: 1 });
	assert.deepEqual(picks.pair, { first: 0 }, "a record's default is made with the owner");
	assert.deepEqual(Picks.make({ picked: [0, 5] }).picked, [], "5 isn't a key of items");
	assert.deepEqual(Picks.make({ byName: { x: 9 } }).byName, {});
	assert.deepEqual(Picks.make({ pair: { first: 7 } }).pair, { first: 0 });
});

test("broken invariants are reported on the component", () => {
	const Range = component({
		name: "Range",
		fields: { lo: t.number(), hi: t.number() },
		invariants: {
			ordered() {
				return this.lo <= this.hi;
			},
			throws() {
				if (this.hi > 100) throw new Error("too big");
				return true;
			},
		},
		view: "range",
	});
	assert.deepEqual(findInvalid(Range.make({ lo: 1, hi: 2 }), null), []);
	const issues = findInvalid({ r: Object.assign(Range.make(), { lo: 300, hi: 200 }) }, null);
	assert.deepEqual(
		issues.map(({ path, field, reason }) => [path, field, reason]),
		[
			[["r"], null, "invariant:ordered"],
			[["r"], null, "invariant:throws"],
		],
	);
});

import assert from "node:assert/strict";
import test from "node:test";
import { produce } from "../../deps/immer.js";
import {
	component,
	field,
	findInvalidFields,
	h,
	isComponent,
	NumberType,
	specOf,
	t,
	t as types,
} from "../../src/tutuca.js";

const Task = component({
	name: "Task",
	fields: { title: t.string("Just do it"), tags: t.array(), done: t.boolean() },
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
			s: t.option(t.string()).default("d"),
			n: t.option(t.number()).default(1),
			b: t.option(t.boolean()).default(true),
			a: t.option(t.array()).default([1]),
			m: t.option(t.map()).default({ k: 1 }),
			none: t.option(t.string()),
			strict: t.string("d"),
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

test("types have zero defaults and default() returns a changed copy", () => {
	const Z = component({
		name: "Z",
		fields: { s: t.string(), n: t.number(), b: t.boolean(), a: t.array(), m: t.map() },
		view: "z",
	});
	assert.deepEqual(fieldsOf(Z.make()), { s: "", n: 0, b: false, a: [], m: {} });
	const base = types.number();
	assert.equal(base.default(3).defaultValue, 3);
	assert.equal(base.defaultValue, 0);
	assert.ok(base.default(3) instanceof NumberType);
});

test("getters in methods read the instance", () => {
	const P = component({
		name: "P",
		fields: { first: t.string(), last: t.string() },
		methods: {
			get full() {
				return `${this.first} ${this.last}`;
			},
		},
		view: "p",
	});
	const p = P.make({ first: "Ada", last: "Lovelace" });
	assert.equal(p.full, "Ada Lovelace");
	const renamed = produce(p, (d) => {
		d.first = "Augusta";
	});
	assert.equal(renamed.full, "Augusta Lovelace");
});

test("constraints narrow what a type accepts and bounds pull the default in", () => {
	const n = types.number().int().min(1).max(10);
	assert.equal(n.defaultValue, 1);
	assert.deepEqual(
		[3, 0, 11, 1.5, "3"].map((v) => n.isValid(v, null)),
		[true, false, false, false, false],
	);
	const s = types
		.string("ab")
		.len(1, 3)
		.match(/^[a-z]+$/);
	assert.deepEqual(
		["a", "", "abcd", "A"].map((v) => s.isValid(v, null)),
		[true, false, false, false],
	);
	const odd = types.number(1).where((v) => v % 2 === 1, "odd");
	assert.deepEqual([odd.isValid(3, null), odd.isValid(2, null)], [true, false]);
	assert.equal(types.array().len(1).isValid([], null), false);
	assert.throws(() => types.array().len(1).make(undefined, null), /has no default/);
	assert.deepEqual(types.array().len(1).make([1], null), [1]);
	assert.equal(types.map().len(0, 1).isValid({ a: 1, b: 2 }, null), false);
	assert.deepEqual(types.number(), types.number(), "modifiers leave the original untouched");
});

test("enum, record and oneOf check members, shape and alternatives", () => {
	const e = types.enum("edit", "view");
	assert.equal(e.makeDefault(null), "edit");
	assert.deepEqual([e.isValid("view", null), e.isValid("other", null)], [true, false]);
	const r = types.record({ x: types.number(), label: types.option(types.string()) });
	assert.deepEqual(r.makeDefault(null), { x: 0, label: null });
	assert.equal(r.isValid({ x: 1, label: "a" }, null), true);
	assert.equal(r.isValid({ x: 1 }, null), false, "a missing key is invalid");
	assert.equal(r.isValid({ x: 1, label: null, extra: 1 }, null), false, "extra keys are invalid");
	const u = types.oneOf(types.string("a"), types.number());
	assert.equal(u.makeDefault(null), "a");
	assert.deepEqual(
		[u.isValid(1, null), u.isValid("s", null), u.isValid(true, null)],
		[true, true, false],
	);
});

test("record and oneOf defaults meet the constraints of what they are made of", () => {
	const three = types
		.number()
		.min(1)
		.where((v) => v === 3, "three");
	const r = types.record({ n: three });
	assert.throws(() => r.make(undefined, null), /n: has no default/);
	assert.deepEqual(types.record({ n: three.default(3) }).make(undefined, null), { n: 3 });
	const u = types.oneOf(types.string().len(1), types.number());
	assert.throws(() => u.make(undefined, null), /has no default/);
	assert.equal(types.oneOf(types.string("a").len(1)).make(undefined, null), "a");
});

test("index fields are keys of a sibling collection", () => {
	const Sel = component({
		name: "Sel",
		fields: {
			items: t.array().default(["a", "b"]),
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
		findInvalidFields(invalid, null).map((i) => i.field),
		["selected"],
	);
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
	assert.deepEqual(findInvalidFields(Range.make({ lo: 1, hi: 2 }), null), []);
	const issues = findInvalidFields({ r: Object.assign(Range.make(), { lo: 300, hi: 200 }) }, null);
	assert.deepEqual(
		issues.map(({ path, field, reason }) => [path, field, reason]),
		[
			[["r"], null, "invariant:ordered"],
			[["r"], null, "invariant:throws"],
		],
	);
});

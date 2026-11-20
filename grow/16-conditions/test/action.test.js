// The scenarios of spec/component/action.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { act, invalidIn, messageIssues } from "../src/component/action.js";
import { classOf, component } from "../src/component/class.js";
import { t } from "../src/component/types.js";

const seen = [];
const Counter = component({
	name: "Counter",
	fields: { n: t.number().int(), log: t.array() },
	invariants: {
		small() {
			return this.n < 10;
		},
	},
	on: {
		inc: {
			args: [t.number().min(0)],
			pre: (_self, [by]) => by < 5,
			post: (self, next, [by]) => next.n === self.n + by,
			run(next, [by]) {
				next.n = this.n + by;
				seen.push(next.n);
			},
		},
		twice(next) {
			next.n = this.n + 1;
			next.n = this.n + 1;
		},
		reset(next) {
			if (!(0 < this.n)) throw new Error("not enabled");
			next.n = 0;
		},
		swap() {
			return Counter.make({ n: 2 });
		},
		bad() {
			seen.push("before");
			throw new Error("boom");
		},
		pick(next, [k, v]) {
			next.log[k] = v;
		},
	},
});
const c0 = Counter.make({ n: 1, log: ["x"] });
const fields = (instance) => ({ ...instance });

test("a handler steps from self to next, and its effects see next", () => {
	seen.length = 0;
	const stepped = act(Counter, c0, "inc", [2]);
	assert.equal(stepped.outcome, "ok");
	assert.deepEqual(fields(stepped.next), { n: 3, log: ["x"] });
	assert.deepEqual(seen, [3]);
});

test("the instance before the message is unchanged, and next is of its class", () => {
	const { next } = act(Counter, c0, "inc", [2]);
	assert.deepEqual(fields(c0), { n: 1, log: ["x"] });
	assert.equal(classOf(next), Counter);
	assert.equal(next.log, c0.log);
});

test("updates read self, never next", () => {
	assert.deepEqual(fields(act(Counter, c0, "twice", []).next), { n: 2, log: ["x"] });
});

test("a handler that is not enabled has no step", () => {
	assert.deepEqual(fields(act(Counter, c0, "reset", []).next), { n: 0, log: ["x"] });
	assert.equal(act(Counter, Counter.make(), "reset", []).outcome, "aborted");
});

test("returning an instance replaces it", () => {
	assert.deepEqual(fields(act(Counter, c0, "swap", []).next), { n: 2, log: [] });
});

test("a throw aborts; effects before it survive", () => {
	seen.length = 0;
	const stepped = act(Counter, c0, "bad", []);
	assert.equal(stepped.outcome, "aborted");
	assert.equal(stepped.error.message, "boom");
	assert.deepEqual(seen, ["before"]);
});

test("paths with computed keys", () => {
	assert.deepEqual(fields(act(Counter, c0, "pick", [0, "k"]).next), { n: 1, log: ["k"] });
});

test("a handler that does not exist has no step", () => {
	assert.throws(() => act(Counter, c0, "nope", []), /Counter has no handler for nope/);
});

test("the ways a message breaks its contract", () => {
	const c3 = Counter.make({ n: 3, log: ["x"] });
	const issues = (name, prev, next, args) => messageIssues(Counter, name, prev, next, args);
	assert.deepEqual(issues("inc", c0, c3, [2]), []);
	assert.deepEqual(issues("inc", c0, c3, [2, 1]), ["args"]);
	assert.deepEqual(issues("inc", c0, c0, [-1]), ["arg:0", "post"]);
	assert.deepEqual(issues("inc", c0, c3, [7]), ["pre", "post"]);
	// A handler without a contract has no issues.
	assert.deepEqual(issues("reset", c0, c0, [9]), []);
});

// An instance as a handler or a test could leave it: any fields at all.
const raw = (classDef, fields) => Object.assign(Object.create(classDef.proto), fields);
const brief = ({ path, component, field, reason }) => [path.join("."), component, field, reason];

test("invalid state: undeclared and invalid fields, then broken invariants", () => {
	const root = {
		a: raw(Counter, { n: 1.5, log: [], extra: 1 }),
		b: raw(Counter, { n: 12, log: [] }),
	};
	assert.deepEqual(invalidIn(root, null).map(brief), [
		["a.extra", "Counter", "extra", "undeclared"],
		["a.n", "Counter", "n", "invalid"],
		["b", "Counter", null, "invariant:small"],
	]);
	assert.deepEqual(invalidIn(root, null, { invariants: true }).map(brief), [
		["b", "Counter", null, "invariant:small"],
	]);
	// Unchanged subtrees are skipped.
	assert.deepEqual(invalidIn(root, root), []);
	assert.deepEqual(invalidIn({ ...root }, root), []);
});

test("a declared field that is missing is invalid", () => {
	assert.deepEqual(invalidIn(raw(Counter, { n: 1 }), null, { fields: true }).map(brief), [
		["log", "Counter", "log", "invalid"],
	]);
});

// Refinement: from any valid instance and valid arguments that meet pre, the handler's step
// meets post and leaves the fields valid. A handler that breaks its contract is caught.
const bounded = (run) =>
	component({
		name: "Bounded",
		fields: { n: t.number().int().min(0).max(10) },
		on: {
			add: {
				args: [t.number().int().min(0)],
				pre: (self, [by]) => self.n + by <= 10,
				post: (self, next, [by]) => next.n === self.n + by,
				run,
			},
		},
	});
const refines = (Bounded) =>
	fc.property(fc.nat({ max: 10 }), fc.nat({ max: 10 }), (n, by) => {
		fc.pre(n + by <= 10);
		const self = Bounded.make({ n });
		const { outcome, next } = act(Bounded, self, "add", [by]);
		assert.equal(outcome, "ok");
		assert.deepEqual(messageIssues(Bounded, "add", self, next, [by]), []);
		assert.deepEqual(invalidIn(next, self, { fields: true }), []);
	});

test("a handler refines its contract, and one that does not is caught", () => {
	fc.assert(
		refines(
			bounded(function (next, [by]) {
				next.n = this.n + by;
			}),
		),
	);
	assert.throws(() =>
		fc.assert(
			refines(
				bounded(function (next, [by]) {
					next.n = this.n + by + by;
				}),
			),
		),
	);
});

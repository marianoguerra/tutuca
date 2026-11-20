// The scenarios of spec/component/action.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "../src/component/action.js";
import { classOf, component } from "../src/component/class.js";
import { t } from "../src/component/types.js";

const seen = [];
const Counter = component({
	name: "Counter",
	fields: { n: t.number().int(), log: t.array() },
	on: {
		inc(next, [by]) {
			next.n = this.n + by;
			seen.push(next.n);
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

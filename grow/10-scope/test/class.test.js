// The scenarios of spec/component/class.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { classOf, component, isComponent } from "../src/component/class.js";
import { NoDefaultError, t } from "../src/component/types.js";

const Counter = component({
	name: "Counter",
	fields: { n: t.number().int(), label: t.string("count") },
});

test("fields get their arguments, or their defaults", () => {
	assert.deepEqual({ ...Counter.make() }, { n: 0, label: "count" });
	assert.deepEqual({ ...Counter.make({ n: 3 }) }, { n: 3, label: "count" });
});

test("an argument that is not valid gives the default; one for no field is dropped", () => {
	assert.deepEqual({ ...Counter.make({ n: 1.5, other: 1 }) }, { n: 0, label: "count" });
});

test("an instance is a value of its class", () => {
	const counter = Counter.make();
	assert.equal(classOf(counter), Counter);
	assert.equal(isComponent(counter), true);
	assert.equal(isComponent({ n: 0, label: "count" }), false);
	assert.throws(() => {
		counter.n = 1;
	}, TypeError);
});

const Tabs = component({
	name: "Tabs",
	fields: { items: t.array(t.string()).default(["a", "b"]), selected: t.index("items") },
});

test("a field can read the fields before it", () => {
	assert.deepEqual({ ...Tabs.make() }, { items: ["a", "b"], selected: 0 });
	assert.deepEqual({ ...Tabs.make({ selected: 1 }) }, { items: ["a", "b"], selected: 1 });
	assert.deepEqual({ ...Tabs.make({ selected: 5 }) }, { items: ["a", "b"], selected: 0 });
});

test("a field with no default is required", () => {
	assert.throws(
		() => Tabs.make({ items: [] }),
		(error) => {
			assert.ok(error instanceof NoDefaultError);
			assert.match(error.message, /^Tabs\.selected: /);
			return true;
		},
	);
});

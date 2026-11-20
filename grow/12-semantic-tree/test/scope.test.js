import assert from "node:assert/strict";
import test from "node:test";
import { classOf, component } from "../src/component/class.js";
import { Scope } from "../src/component/scope.js";
import { NoDefaultError, t, valid } from "../src/component/types.js";

const Counter = component({ name: "Counter", fields: { n: t.number() } });
const Pair = component({
	name: "Pair",
	fields: { left: t.component("Counter"), right: t.option(t.component("Counter")) },
});
const Tree = component({
	name: "Tree",
	fields: { label: t.string(), children: t.array(t.component("Tree")) },
});
const fields = (instance) => Object.fromEntries(Object.entries(instance));

test("a component type accepts instances of the classes it names", () => {
	const counter = Counter.make();
	assert.equal(valid(t.component("Counter"), counter), true);
	assert.equal(valid(t.component("Other"), counter), false);
	assert.equal(valid(t.component("Other", "Counter"), counter), true);
	assert.equal(valid(t.component(), counter), true);
	assert.equal(valid(t.component(), {}), false);
});

test("without a scope, a component field is required", () => {
	assert.throws(() => Pair.make(), NoDefaultError);
	const pair = Pair.make({ left: Counter.make({ n: 1 }) });
	assert.deepEqual(fields(pair.left), { n: 1 });
	assert.equal(pair.right, null);
});

test("a scope makes instances by name", () => {
	const scope = new Scope();
	const C = scope.register({ Counter, Pair });
	assert.equal(classOf(C.Counter({ n: 2 })), Counter);
	assert.equal(scope.components.Counter().n, 0);
	assert.throws(() => scope.make("Missing"), /Component Missing is not registered/);
});

test("in a scope, a component field defaults to a new instance", () => {
	const scope = new Scope();
	scope.register({ Counter, Pair });
	const pair = scope.components.Pair();
	assert.equal(classOf(pair.left), Counter);
	assert.deepEqual(fields(pair.left), { n: 0 });
	assert.equal(pair.right, null);
});

test("a class can hold instances of itself", () => {
	const scope = new Scope();
	const { Tree: tree } = scope.register({ Tree });
	const root = tree({ label: "root", children: [tree({ label: "leaf" })] });
	assert.equal(root.children[0].label, "leaf");
	assert.equal(valid(Tree.fields.children, root.children), true);
});

test("a name is looked up in the scope, then in the scopes above", () => {
	const outer = new Scope();
	outer.register({ Counter });
	const inner = outer.enter();
	inner.register({ Pair });
	assert.equal(classOf(inner.components.Pair().left), Counter);
	assert.throws(() => outer.make("Pair"), /not registered/);
});

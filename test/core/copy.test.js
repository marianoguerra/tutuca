// copy gives a copy of a value whose every component is a new instance: the same fields, a
// fresh identity at any depth (spec/tree's M8 copy). Sharing the value instead would leave two
// instances with one identity in the tree.
import assert from "node:assert/strict";
import test from "node:test";
import { DevChecks } from "../../src/dev/checks.js";
import {
	Address,
	apply,
	component,
	copy,
	DispatchPath,
	Frame,
	Host,
	idOf,
	scopeOf,
	t,
} from "../../src/tutuca.js";

const Leaf = component({
	name: "Leaf",
	fields: { n: t.number(), tags: t.array(t.string()) },
	on: {
		bump: {
			pure: true,
			run(next) {
				next.n += 1;
			},
		},
	},
});
const Mid = component({
	name: "Mid",
	fields: {
		leaf: t.component("Leaf"),
		more: t.array(t.component("Leaf")),
		byName: t.map(t.component("Leaf")),
		note: t.array(t.string()),
	},
});
const Root = component({
	name: "Root",
	fields: { mids: t.array(t.component("Mid")) },
	on: {
		copyFirst(next) {
			next.mids.unshift(copy(this.mids[0]));
		},
		bumpFirst(next) {
			next.mids[0].leaf = apply(next.mids[0].leaf, "bump");
		},
	},
});
const setup = () => {
	const host = new Host({ checks: DevChecks });
	const reports = [];
	host.notify = (type, info) => reports.push({ type, ...info });
	const { Root: R, Mid: M, Leaf: L } = host.scope.register({ Root, Mid, Leaf });
	const mid = M({
		leaf: L({ n: 1, tags: ["a"] }),
		more: [L({ n: 2 })],
		byName: { x: L({ n: 3 }) },
		note: ["plain"],
	});
	host.start(R({ mids: [mid] }));
	const send = (name) => {
		reports.length = 0;
		host.send(name, [], { now: true });
		return reports.filter((r) => r.type === "messageInvalid").flatMap((r) => r.issues);
	};
	return { host, send };
};
// Every component in v, outermost first.
const instances = (v) => [v, v.leaf, ...v.more, ...Object.values(v.byName)];

test("every component in a copy is a new instance, with the same fields", () => {
	const { host } = setup();
	const mid = host.root.mids[0];
	const copied = copy(mid);
	const ids = instances(mid).map(idOf);
	for (const id of instances(copied).map(idOf)) assert.ok(!ids.includes(id));
	assert.equal(new Set(instances(copied).map(idOf)).size, 4);
	assert.deepEqual([copied.leaf.n, copied.leaf.tags], [mid.leaf.n, mid.leaf.tags]);
	assert.equal(copied.leaf.n, 1);
	assert.equal(copied.byName.x.n, 3);
	assert.equal(scopeOf(copied.leaf), scopeOf(mid.leaf));
	// Data holding no component is shared, and what was frozen is frozen.
	assert.equal(copied.note, mid.note);
	assert.equal(copied.leaf.tags, mid.leaf.tags);
	assert.equal(Object.isFrozen(copied), Object.isFrozen(mid));
});

test("a value holding no component is itself", () => {
	const plain = { a: [1, 2], b: "x" };
	assert.equal(copy(plain), plain);
	assert.equal(copy(3), 3);
	assert.equal(copy(null), null);
});

test("a copy put in a handler is changed on its own, with no foreign write", () => {
	const { host, send } = setup();
	assert.deepEqual(send("copyFirst"), []);
	assert.deepEqual(send("bumpFirst"), []);
	const [copied, original] = host.root.mids;
	assert.equal(copied.leaf.n, 2);
	assert.equal(original.leaf.n, 1);
	assert.notEqual(idOf(copied), idOf(original));
});

test("an address to the original is stale once its copy takes its place", () => {
	const { host, send } = setup();
	const path = new DispatchPath([new Frame(["mids"], 0, null, true)]);
	const address = Address.at(path, host.root);
	assert.ok(address.resolve(host.root).instance);
	send("copyFirst");
	assert.ok(address.resolve(host.root).stale !== undefined);
});

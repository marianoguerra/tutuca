// Dev mode reports a message whose handler wrote another component's fields, instead of
// applying one of its pure messages.
import assert from "node:assert/strict";
import test from "node:test";
import { apply, component, t } from "../../src/tutuca.js";
import { devHost, Leaf } from "../helpers.js";

const Mid = component({
	name: "Mid",
	fields: { leaf: t.component("Leaf") },
	on: {
		// A pure message of Mid writing its child's field: Mid's write, not Leaf's.
		bumpLeafDirectly: {
			pure: true,
			run(next) {
				next.leaf.n += 1;
			},
		},
		bumpLeaf: {
			pure: true,
			run(next) {
				next.leaf = apply(next.leaf, "bump");
			},
		},
	},
});
const Root = component({
	name: "Root",
	fields: { mids: t.array(t.component("Mid")), count: t.number() },
	on: {
		writeLeaf(next) {
			next.mids[0].leaf.n = 9;
			next.mids[0].leaf.tags.push("x");
		},
		applyLeaf(next) {
			next.mids[0].leaf = apply(next.mids[0].leaf, "bump");
		},
		applyMid(next) {
			next.mids[0] = apply(next.mids[0], "bumpLeaf");
		},
		applyMidDirect(next) {
			next.mids[0] = apply(next.mids[0], "bumpLeafDirectly");
		},
		ownFields(next) {
			next.count += 1;
			next.mids.push(this.mids[0]); // the same child twice: the parent's own array
			next.mids.reverse();
		},
		replaceChild(next, _args, ctx) {
			next.mids[0] = ctx.scope.make("Mid", { leaf: ctx.scope.make("Leaf", { n: 5 }) });
		},
	},
});
const setup = () => {
	const {
		host,
		reports,
		C: { Root: R, Mid: M, Leaf: L },
	} = devHost({ Root, Mid, Leaf });
	host.start(R({ mids: [M({ leaf: L({ n: 1 }) })] }));
	const run = (name) => {
		reports.length = 0;
		host.send(name, [], { now: true });
		return reports.filter((r) => r.type === "messageInvalid").flatMap((r) => r.issues);
	};
	return { host, run };
};

test("a handler writing a grandchild's fields is reported, once per field", () => {
	const { host, run } = setup();
	assert.deepEqual(run("writeLeaf"), ["foreign-write:Leaf.n", "foreign-write:Leaf.tags"]);
	assert.equal(host.root.mids[0].leaf.n, 9); // reported, not undone
});

test("applying the child's pure message is the child's own write", () => {
	const { host, run } = setup();
	assert.deepEqual(run("applyLeaf"), []);
	assert.deepEqual(run("applyMid"), []);
	assert.equal(host.root.mids[0].leaf.n, 3);
});

test("a pure message writing its own child's fields is reported too", () => {
	const { run } = setup();
	assert.deepEqual(run("applyMidDirect"), ["foreign-write:Leaf.n"]);
});

test("a component's own fields, and adding, moving or replacing children, are its own", () => {
	const { run } = setup();
	assert.deepEqual(run("ownFields"), []);
	assert.deepEqual(run("replaceChild"), []);
});

test("host.apply is checked as a handler is", () => {
	const { host } = setup();
	const reports = [];
	host.notify = (type, info) => reports.push({ type, ...info });
	host.apply("bumpLeafDirectly", [], { to: (p) => p.field("mids").item(0) });
	assert.deepEqual(
		reports.filter((r) => r.type === "messageInvalid").flatMap((r) => r.issues),
		["foreign-write:Leaf.n"],
	);
});

test("putting back a version of a child that was already there is the parent's write", () => {
	const Keeper = component({
		name: "Keeper",
		fields: { leaf: t.component("Leaf"), past: t.array(t.component("Leaf")) },
		on: {
			snapshot(next) {
				next.past.push(this.leaf);
				next.leaf = apply(next.leaf, "bump");
			},
			undo(next) {
				next.leaf = this.past.at(-1);
				next.past.pop();
			},
		},
	});
	const {
		host,
		reports,
		C: { Keeper: K, Leaf: L },
	} = devHost({ Keeper, Leaf });
	host.start(K({ leaf: L({ n: 1 }) }));
	host.send("snapshot", [], { now: true });
	host.send("undo", [], { now: true });
	assert.equal(host.root.leaf.n, 1);
	assert.deepEqual(
		reports.filter((r) => r.type === "messageInvalid"),
		[],
	);
});

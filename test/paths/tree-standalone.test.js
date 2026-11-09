// src/tree runs without components: plain objects as nodes (a spread keeps the identity), a
// table of handlers per kind, and a transaction that writes in place.
import assert from "node:assert/strict";
import test from "node:test";
import { Address, DispatchPath, Frame, HOST, mint, Target, Task } from "../../src/tree/index.js";
import { treeHarness } from "../helpers.js";

const kinds = {
	parent: { on: { changed: (n) => ({ ...n, seen: n.seen + 1 }) } },
	// A handler that returns undefined keeps the node as it was.
	child: {
		on: {
			poke: (_n, _args, ctx) => {
				ctx.notify("changed");
			},
		},
	},
};
const setup = (root) => {
	const observed = [];
	const harness = treeHarness({
		root,
		handler: (node, { name }) => {
			const run = kinds[node.kind].on[name];
			return run && { run };
		},
		transition: (record) => record.outcome !== "handled" && observed.push(record.outcome),
	});
	return { ...harness, observed };
};
const childPath = new DispatchPath([new Frame(["child"], null, null, true)]);

test("a notification bubbles from the child to the parent", () => {
	const root = mint({ kind: "parent", seen: 0, child: mint({ kind: "child" }) });
	const { store, scheduler, run } = setup(root);
	const poke = new Task("poke", [], HOST, new Target(childPath), null);
	poke.prepare(store.get());
	scheduler.push(poke);
	run();
	assert.equal(store.get().seen, 1);
});

test("a message for a child another one replaced is stale", () => {
	const root = mint({ kind: "parent", seen: 0, child: mint({ kind: "child" }) });
	const { store, scheduler, observed, run } = setup(root);
	const to = Address.at(childPath, root);
	store.get().child = mint({ kind: "child" }); // a new identity at the same path
	scheduler.push(new Task("poke", [], HOST, to, null));
	run();
	assert.deepEqual(observed, ["stale"]);
	assert.equal(store.get().seen, 0);
});

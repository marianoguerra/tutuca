// Components defined at runtime shared through sync (pure/definitions.js over automerge.js):
// what a peer defines is registered on the others once it checks, a removal is a removal
// everywhere, and a peer only registers what others send when it says so.
import assert from "node:assert/strict";
import test from "node:test";
import { clone } from "@automerge/automerge";
import { componentAsks } from "../../src/pure/define.js";
import { definitionsRegistry } from "../../src/pure/definitions.js";
import { automergeEngine, DEFINITIONS, docHandle, fromDoc } from "../../src/sync/automerge.js";
import { startSynced } from "../../src/sync/index.js";
import { component, specOf, t } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const lines = (...text) => text.join("\n");
const CARD = (title = "card") =>
	lines(
		'import { div, field } from "tutuca/view";',
		"export type Card = { title: string; count: number };",
		"export const Card = {",
		`	defaults: { title: "${title}", count: 0 },`,
		'	view: div(field("title")),',
		"};",
	);
const Box = component({
	name: "Box",
	fields: { title: t.string(), content: t.option(t.component()) },
	view: "<span></span>",
});

// A peer: a host on handle whose asks define components, sharing them when share says so.
const peer = async (handle, { share = true } = {}) => {
	const s = setupHost({ Box }, { sync: true });
	const events = [];
	const definitions = share
		? definitionsRegistry({
				host: s.host,
				dangerouslyRegisterExternalComponents: true,
				onReport: (e) => events.push(e),
			})
		: null;
	const asks = componentAsks({ host: s.host, definitions });
	await startSynced(s.host, {
		make: (C) => C.Box(),
		engines: [automergeEngine({ handle, definitions })],
	});
	const read = { scope: s.host.scope };
	return {
		host: s.host,
		events,
		define: (source) => asks.defineComponent([source, ""], read),
		unregister: (name) => asks.unregisterComponent([name, ""], read),
	};
};
const sync = (...handles) => {
	for (const a of handles) for (const b of handles) if (a !== b) b.merge(a.doc());
};

test("a registry only registers what peers send when told it may", () => {
	assert.throws(() => definitionsRegistry({ host: null }), /dangerouslyRegisterExternalComponents/);
});

test("what a peer defines is registered on the others, and what's made of it becomes the real one", async () => {
	const ha = docHandle();
	const a = await peer(ha);
	const hb = docHandle();
	hb.merge(ha.doc());
	const b = await peer(hb);
	assert.equal(a.define(CARD()).ok, true);
	a.host.applyChange((d) => {
		d.content = a.host.scope.make("Card", { count: 2 });
	});
	assert.deepEqual(fromDoc(ha.doc())[DEFINITIONS], { Card: CARD() });
	sync(ha, hb);
	assert.equal(specOf(b.host.root.content), b.host.scope.lookupSpec("Card"));
	assert.equal(b.host.root.content.count, 2);
	assert.deepEqual(b.events, [{ type: "registered", ref: "Card" }]);
	// The definitions aren't part of the state.
	assert.equal(Object.hasOwn(b.host.root, DEFINITIONS), false);
	// A new peer gets them before its state is made.
	const hc = docHandle(clone(ha.doc()));
	const c = await peer(hc);
	assert.equal(specOf(c.host.root.content).name, "Card");
});

test("a peer that doesn't share keeps what others define as it came", async () => {
	const ha = docHandle();
	const a = await peer(ha);
	const hb = docHandle();
	hb.merge(ha.doc());
	const b = await peer(hb, { share: false });
	a.define(CARD());
	a.host.applyChange((d) => {
		d.content = a.host.scope.make("Card");
	});
	sync(ha, hb);
	assert.equal(b.host.scope.lookupSpec("Card"), null);
	assert.equal(specOf(b.host.root.content).name, "UnknownComponent");
});

test("a removal reaches every peer, without coming back from one that held it", async () => {
	const ha = docHandle();
	const a = await peer(ha);
	a.define(CARD());
	const hb = docHandle(clone(ha.doc()));
	const b = await peer(hb);
	const hOld = docHandle(clone(ha.doc())); // a peer that has it and is away
	assert.equal(b.host.scope.lookupSpec("Card") !== null, true);
	assert.equal(a.unregister("Card").ok, true);
	sync(ha, hb);
	assert.equal(b.host.scope.lookupSpec("Card"), null);
	assert.deepEqual(b.events.at(-1), { type: "removed", ref: "Card" });
	// It comes back with its old history: nothing it holds undoes the removal.
	sync(ha, hb, hOld);
	assert.deepEqual(fromDoc(ha.doc())[DEFINITIONS], {});
	assert.equal(b.host.scope.lookupSpec("Card"), null);
});

test("a definition changed while another peer removed it is kept, changed", async () => {
	const ha = docHandle();
	const a = await peer(ha);
	a.define(CARD());
	const hb = docHandle(clone(ha.doc()));
	const b = await peer(hb);
	a.unregister("Card");
	b.define(CARD("edited"));
	sync(ha, hb);
	assert.deepEqual(fromDoc(ha.doc())[DEFINITIONS], { Card: CARD("edited") });
	assert.equal(a.host.scope.lookupSpec("Card").fields.title.make(undefined, null), "edited");
	assert.equal(b.host.scope.lookupSpec("Card").fields.title.make(undefined, null), "edited");
});

test("a definition that doesn't check isn't registered", async () => {
	const ha = docHandle();
	const a = await peer(ha);
	const hb = docHandle(clone(ha.doc()));
	const b = await peer(hb);
	// Written straight to the document, as a peer that didn't check it could.
	ha.change((d) => {
		d[DEFINITIONS] = { Card: "export const Card = {" };
	});
	void a;
	sync(ha, hb);
	assert.equal(b.host.scope.lookupSpec("Card"), null);
	assert.equal(b.events.at(-1).type, "rejected");
	assert.equal(b.events.at(-1).ref, "Card");
});

test("what's made of a definition another peer removed meanwhile is kept, as it was", async () => {
	const ha = docHandle();
	const a = await peer(ha);
	a.define(CARD());
	const hb = docHandle(clone(ha.doc()));
	const b = await peer(hb);
	a.unregister("Card");
	b.host.applyChange((d) => {
		d.content = b.host.scope.make("Card", { count: 5 });
	});
	sync(ha, hb);
	for (const { host } of [a, b]) {
		assert.equal(host.scope.lookupSpec("Card"), null);
		assert.equal(specOf(host.root.content).name, "UnknownComponent");
		assert.equal(host.root.content.data.count, 5);
	}
	assert.deepEqual(fromDoc(ha.doc()).content, { $: "Card", title: "card", count: 5 });
});

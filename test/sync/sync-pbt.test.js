// Properties of the sync layer over generated states and generated edits: diffs round-trip for
// every component library, and engines keep their copy equal to the state and converge.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { drawingComponents } from "../../components/drawing/index.js";
import { studioComponents } from "../../components/json-schema/studio.js";
import { workbenchComponents } from "../../components/math/workbench.js";
import { trackerAppArb } from "../../components/thing-tracker/fixtures.js";
import { trackerComponents } from "../../components/thing-tracker/index.js";
import { todoAppArb } from "../../components/todo/fixtures.js";
import { todoComponents } from "../../components/todo/index.js";
import { produce } from "../../deps/immer.js";
import { automergeEngine, docHandle, fromDoc } from "../../src/sync/automerge.js";
import {
	applyOps,
	applyStateOps,
	diff,
	hydrate,
	project,
	startSynced,
} from "../../src/sync/index.js";
import { memoryRemote, remoteEngine } from "../../src/sync/remote.js";
import { arbitraries } from "../../src/test/pbt.js";
import { component } from "../../src/tutuca.js";
import { scopeWith, setupHost, tick } from "../helpers.js";

const LEVELS = ["shared", "local"];
// Every other field of b over a copy of a: states that share subtrees, like successive ones do.
const mixed = (a, b) => {
	const out = Object.assign(Object.create(Object.getPrototypeOf(a)), a);
	Object.keys(b).forEach((key, i) => {
		if (i % 2 === 0) out[key] = b[key];
	});
	return out;
};

const libraries = {
	todo: [todoComponents, { TodoApp: todoAppArb }],
	tracker: [trackerComponents, { TrackerApp: trackerAppArb }],
	studio: [studioComponents, {}],
	drawing: [drawingComponents, {}],
	math: [workbenchComponents, {}],
};
for (const [library, [components, overrides]] of Object.entries(libraries)) {
	test(`the ${library} components project, hydrate and diff losslessly`, () => {
		const scope = scopeWith(components);
		const A = arbitraries({ fc, scope, overrides });
		for (const name of Object.keys(components)) {
			const pair = fc
				.tuple(A.instance(name), A.instance(name), fc.boolean())
				.map(([a, b, mix]) => [a, mix ? mixed(a, b) : b]);
			try {
				fc.assert(
					fc.property(pair, ([a, b]) => {
						for (const level of LEVELS) {
							const pa = project(a, { level });
							const pb = project(b, { level });
							assert.deepEqual(project(hydrate(pa, scope), { level }), pa);
							const ops = diff(a, b, { scope, level });
							assert.deepEqual(applyOps(structuredClone(pa), ops), pb);
							const applied = produce(a, (draft) => applyStateOps(draft, ops, scope));
							assert.deepEqual(project(applied, { level }), pb);
						}
					}),
					{ numRuns: 20 },
				);
			} catch (error) {
				error.message = `${library} ${name}: ${error.message}`;
				throw error;
			}
		}
	});
}

// --- generated edits on synced hosts ----------------------------------------------------------

const Item = component({
	name: "Item",
	fields: (t) => ({ label: t.string(), done: t.boolean(), tags: t.array(t.string()) }),
	view: "<span>{.label}</span>",
});
const Root = component({
	name: "Root",
	fields: (t) => ({
		title: t.string(),
		kind: t.enum("note", "list"),
		items: t.array(t.component("Item")),
		meta: t.map(t.number()),
		note: t.option(t.string()),
		open: t.boolean().sync("none"),
	}),
	view: "<h1>{.title}</h1>",
});

// An edit a handler could make, as a function on the root draft and its scope.
const text = fc.string({ maxLength: 8 });
const at = (n, len) => (len === 0 ? 0 : n % len);
const editArb = fc.oneof(
	fc.tuple(text, fc.nat(8)).map(([s, i]) => (d) => {
		d.title = d.title.slice(0, at(i, d.title.length + 1)) + s; // a typed tail
	}),
	fc.constantFrom("note", "list").map((kind) => (d) => {
		d.kind = kind;
	}),
	fc.tuple(fc.nat(8), text).map(([i, label]) => (d, scope) => {
		d.items.splice(at(i, d.items.length + 1), 0, scope.make("Item", { label }));
	}),
	fc.nat(8).map((i) => (d) => {
		if (d.items.length > 0) d.items.splice(at(i, d.items.length), 1);
	}),
	fc.tuple(fc.nat(8), fc.nat(8)).map(([i, j]) => (d) => {
		if (d.items.length < 2) return;
		const [item] = d.items.splice(at(i, d.items.length), 1);
		d.items.splice(at(j, d.items.length + 1), 0, item);
	}),
	fc.tuple(fc.nat(8), text).map(([i, s]) => (d) => {
		if (d.items.length > 0) d.items[at(i, d.items.length)].label += s;
	}),
	fc.nat(8).map((i) => (d) => {
		if (d.items.length > 0)
			d.items[at(i, d.items.length)].done = !d.items[at(i, d.items.length)].done;
	}),
	fc.tuple(fc.nat(8), text).map(([i, tag]) => (d) => {
		if (d.items.length > 0) d.items[at(i, d.items.length)].tags.push(tag);
	}),
	fc.tuple(fc.constantFrom("a", "b", "$"), fc.integer()).map(([k, v]) => (d) => {
		d.meta[k] = v;
	}),
	fc.constantFrom("a", "b", "$").map((k) => (d) => {
		delete d.meta[k];
	}),
	fc.option(text).map((note) => (d) => {
		d.note = note;
	}),
	fc.boolean().map((open) => (d) => {
		d.open = open;
	}),
);
const edits = fc.array(editArb, { maxLength: 12 });
const edit = (host, fn) => host.applyExternal((draft) => void fn(draft, host.scope));
const peer = async (engine) => {
	const s = setupHost({ Root, Item }, { sync: true });
	await startSynced(s.host, { make: (C) => C.Root(), engines: [engine] });
	return s.host;
};

test("automerge: the document follows every generated edit", async () => {
	await fc.assert(
		fc.asyncProperty(edits, async (fns) => {
			const handle = docHandle();
			const host = await peer(automergeEngine({ handle }));
			for (const fn of fns) {
				edit(host, fn);
				assert.deepEqual(fromDoc(handle.doc()), project(host.rootComponent));
			}
		}),
		{ numRuns: 100 },
	);
});

test("automerge: peers converge after concurrent generated edits", async () => {
	const { clone } = await import("@automerge/automerge");
	await fc.assert(
		fc.asyncProperty(edits, edits, edits, async (common, fa, fb) => {
			const ha = docHandle();
			const a = await peer(automergeEngine({ handle: ha }));
			for (const fn of common) edit(a, fn);
			const hb = docHandle(clone(ha.doc()));
			const b = await peer(automergeEngine({ handle: hb }));
			for (const fn of fa) edit(a, fn);
			for (const fn of fb) edit(b, fn);
			ha.merge(hb.doc());
			hb.merge(ha.doc());
			assert.deepEqual(project(a.rootComponent), project(b.rootComponent));
			assert.deepEqual(fromDoc(ha.doc()), project(a.rootComponent));
			assert.deepEqual(fromDoc(hb.doc()), project(b.rootComponent));
		}),
		{ numRuns: 100 },
	);
});

test("remote: clients converge on the relay's state after interleaved generated edits", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.tuple(fc.boolean(), editArb, fc.boolean()), { maxLength: 16 }),
			async (steps) => {
				const remote = memoryRemote();
				const a = await peer(remoteEngine({ transport: remote.connect() }));
				await tick();
				const b = await peer(remoteEngine({ transport: remote.connect() }));
				for (const [onA, fn, wait] of steps) {
					edit(onA ? a : b, fn);
					if (wait) await tick();
				}
				for (let i = 0; i < 4; i++) await tick();
				const { value } = remote.relay.load();
				assert.deepEqual(project(a.rootComponent), value);
				assert.deepEqual(project(b.rootComponent), value);
			},
		),
		{ numRuns: 100 },
	);
});

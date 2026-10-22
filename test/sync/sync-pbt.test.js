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
	rebuild,
	startSynced,
} from "../../src/sync/index.js";
import { relay, remoteEngine } from "../../src/sync/remote.js";
import { arbitraries } from "../../src/test/pbt.js";
import { component, t } from "../../src/tutuca.js";
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

// Projections are stored as JSON, so -0 and 0 are one value: immer won't set one over the other.
const assertSameJSON = (actual, expected) =>
	assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

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
							assertSameJSON(applyOps(structuredClone(pa), ops), pb);
							const applied = produce(a, (next) => applyStateOps(next, ops, scope));
							assertSameJSON(project(applied, { level }), pb);
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

// Two versions of an app: the second adds a text field, body, and narrows meta to integers.
const Item = component({
	name: "Item",
	fields: { label: t.string(), done: t.boolean(), tags: t.array(t.string()) },
	view: "<span>{.label}</span>",
});
const rootFields = () => ({
	title: t.string(),
	kind: t.enum("note", "list"),
	items: t.array(t.component("Item")),
	meta: t.map(t.number()),
	note: t.option(t.string()),
	open: t.boolean().sync("none"),
});
const Root = component({ name: "Root", fields: rootFields(), view: "<h1>{.title}</h1>" });
const Root2 = component({
	name: "Root",
	fields: { ...rootFields(), meta: t.map(t.number().int()), body: t.string() },
	view: "<h1>{.title}</h1>",
});
const V1 = { Root, Item };
const V2 = { Root: Root2, Item };

// An edit a handler could make, as a function on the root draft and its scope. Text is any
// unicode, and is cut between code points as a person's typing would.
const text = fc.string({ maxLength: 8, unit: "grapheme" });
const at = (n, len) => (len === 0 ? 0 : n % len);
const typed = (s, i, tail) => {
	const points = [...s];
	return points.slice(0, at(i, points.length + 1)).join("") + tail;
};
const editArb = fc.oneof(
	fc.tuple(text, fc.nat(8)).map(([s, i]) => (d) => {
		d.title = typed(d.title, i, s);
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
	fc.tuple(fc.constantFrom("a", "b", "$", "__proto__"), fc.integer()).map(([k, v]) => (d) => {
		d.meta[k] = v;
	}),
	fc.constantFrom("a", "b", "$", "__proto__").map((k) => (d) => {
		delete d.meta[k];
	}),
	fc.option(text).map((note) => (d) => {
		d.note = note;
	}),
	fc.boolean().map((open) => (d) => {
		d.open = open;
	}),
);
// The edits each version's handlers could make on top of the common ones.
const editsOf = new Map([
	[
		V1,
		fc.oneof(
			editArb,
			fc.integer().map((n) => (d) => {
				d.meta.a = n + 0.5;
			}),
		),
	],
	[
		V2,
		fc.oneof(
			editArb,
			fc.tuple(text, fc.nat(8)).map(([s, i]) => (d) => {
				d.body = typed(d.body, i, s);
			}),
		),
	],
]);
const edits = fc.array(editArb, { maxLength: 12 });
const edit = (host, fn) => host.applyExternal((next) => void fn(next, host.scope));
const peer = async (engine, specs = V1) => {
	const failures = [];
	const s = setupHost(specs, {
		sync: true,
		onReport: (type, info) => type === "syncFailed" && failures.push(info.error),
	});
	await startSynced(s.host, { make: (C) => C.Root(), engines: [engine] });
	s.host.syncFailures = failures;
	return s.host;
};
// What plain, a copy of the state from any version, is in host's version.
const meaningIn = (host, plain) =>
	project(rebuild(structuredClone(plain), host.scope, { level: "shared" }).root);

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

// Steps on peers of the versions in versions: [peer, edit for V1, edit for V2, merge?].
const stepsOn = (count) =>
	fc.array(fc.tuple(fc.nat(count - 1), editsOf.get(V1), editsOf.get(V2), fc.nat(3)), {
		maxLength: 16,
	});

test("automerge: peers on two versions edit and merge, each holding what the document means to it", async () => {
	const versions = [V1, V2, V2];
	await fc.assert(
		fc.asyncProperty(stepsOn(versions.length), async (steps) => {
			const handles = versions.map(() => docHandle());
			const peers = [];
			for (const [i, specs] of versions.entries()) {
				if (i > 0) handles[i].merge(handles[0].doc());
				peers.push(await peer(automergeEngine({ handle: handles[i] }), specs));
			}
			const check = () => {
				for (const [i, host] of peers.entries()) {
					assert.deepEqual(project(host.rootComponent), meaningIn(host, fromDoc(handles[i].doc())));
				}
			};
			for (const [i, fn1, fn2, merge] of steps) {
				edit(peers[i], versions[i] === V1 ? fn1 : fn2);
				if (merge < versions.length && merge !== i) handles[merge].merge(handles[i].doc());
				check();
			}
			for (const h of handles) for (const o of handles) if (o !== h) h.merge(o.doc());
			check();
			const docs = handles.map((h) => fromDoc(h.doc()));
			for (const doc of docs) assert.deepEqual(doc, docs[0]);
			for (const host of peers) assert.deepEqual(host.syncFailures, []);
		}),
		{ numRuns: 100 },
	);
});

// Transports to one relay whose deliveries s orders: each client's pushes, and the relay's
// messages to each client, in order (as over a socket); everything else, loads included,
// interleaved as s picks.
const scheduledRemote = (s) => {
	const r = relay();
	const inboxes = new Set();
	const channel = (deliver) => {
		const queue = [];
		return (item) => {
			queue.push(item);
			s.schedule(Promise.resolve()).then(() => deliver(queue.shift()));
		};
	};
	return {
		relay: r,
		connect() {
			const subscribers = new Set();
			const inbox = channel((m) => {
				for (const fn of subscribers) fn(structuredClone(m));
			});
			inboxes.add(inbox);
			return {
				push: channel((batch) => {
					const message = r.receive(structuredClone(batch));
					for (const send of inboxes) send(message);
				}),
				subscribe(fn) {
					subscribers.add(fn);
					return () => subscribers.delete(fn);
				},
				load: () => s.schedule(Promise.resolve()).then(() => r.load()),
			};
		},
	};
};
const settled = async (s) => {
	for (let i = 0; i < 50; i++) {
		await tick();
		if (s.count() === 0) return;
		await s.waitIdle();
	}
	throw new Error("the clients never settled");
};

test("remote: clients on two versions converge on the relay, whatever order the network delivers in", async () => {
	const versions = [V1, V2, V2];
	await fc.assert(
		fc.asyncProperty(fc.scheduler(), stepsOn(versions.length), async (s, steps) => {
			const remote = scheduledRemote(s);
			const starting = Promise.all(
				versions.map((specs) => peer(remoteEngine({ transport: remote.connect() }), specs)),
			);
			const peers = await s.waitFor(starting);
			for (const [i, fn1, fn2, deliveries] of steps) {
				edit(peers[i], versions[i] === V1 ? fn1 : fn2);
				await tick();
				for (let k = 0; k < deliveries && s.count() > 0; k++) await s.waitNext(1);
			}
			await settled(s);
			const { value } = remote.relay.load();
			for (const host of peers) {
				assert.deepEqual(project(host.rootComponent), meaningIn(host, value));
				assert.deepEqual(host.syncFailures, []);
			}
		}),
		{ numRuns: 100 },
	);
});

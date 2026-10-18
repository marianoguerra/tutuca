import assert from "node:assert/strict";
import test from "node:test";
import { automergeEngine, docHandle, fromDoc } from "../../src/sync/automerge.js";
import {
	applyOps,
	applyStateOps,
	diff,
	hydrate,
	OpConflictError,
	opsOf,
	project,
	startSynced,
	textSplice,
} from "../../src/sync/index.js";
import { memoryRemote, remoteEngine } from "../../src/sync/remote.js";
import { component, DispatchPath, scopeOf, specOf, Target, Task } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const Item = component({
	name: "Item",
	fields: (t) => ({ label: t.string(), done: t.boolean() }),
	view: "<span>{.label}</span>",
});
const Root = component({
	name: "Root",
	fields: (t) => ({
		title: t.string(),
		kind: t.enum("note", "list"),
		items: t.array(t.component("Item")),
		meta: t.map(t.number()),
		selected: t.option(t.index("items")).sync("local"),
		open: t.boolean().sync("none"),
	}),
	on: {
		retitle(draft, [title]) {
			draft.title = title;
		},
		add(draft, [label]) {
			draft.items.unshift(scopeOf(this).make("Item", { label }));
		},
	},
	view: "<h1>{.title}</h1>",
});

const setup = () => setupHost({ Root, Item }, { sync: true });
const started = (args = {}) => {
	const s = setup();
	s.host.start(s.C.Root(args));
	return s;
};
const send = (host, name, args) => {
	const path = new DispatchPath();
	const task = new Task(name, args, path, new Target(path), null);
	host.prepareTask(task, host.rootComponent);
	host.pushTask(task);
	while (host.tasks.length > 0) host.handleTasks();
};
// A copy of a component with changes, as a handler's draft would leave it.
const edit = (c, changes) => Object.assign(Object.create(Object.getPrototypeOf(c)), c, changes);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- scopes and refs -----------------------------------------------------------------------

test("scope.enter needs a name and returns the same scope for it", () => {
	const { host } = setup();
	assert.throws(() => host.scope.enter(), /needs a name/);
	assert.throws(() => host.scope.enter("a/b"), /needs a name/);
	const editor = host.scope.enter("editor");
	assert.equal(host.scope.enter("editor"), editor);
	assert.deepEqual(editor.enter("inner").path, ["editor", "inner"]);
});

test("refs name the scope a component was made in and the name it has there", () => {
	const { host } = setup();
	const Other = component({ name: "Other", view: "x" });
	const editor = host.scope.enter("editor");
	editor.register({ Item: Other });
	assert.equal(host.scope.refFor(Item), "Item");
	assert.equal(editor.refFor(Other), "editor/Item"); // the alias, not spec.name
	assert.equal(editor.refFor(Root), "editor/Root"); // inherited, made in editor
	assert.deepEqual(host.scope.resolveRef("editor/Item"), { scope: editor, name: "Item" });
	assert.throws(() => host.scope.refFor(Other), /not registered/);
	assert.throws(() => host.scope.resolveRef("nope/Item"), /No scope/);
});

// --- projection --------------------------------------------------------------------------

test("project keeps the fields its level sees and hydrate makes them back", () => {
	const { host, C } = setup();
	const root = C.Root({ title: "t", items: [C.Item({ label: "a" })], selected: 0, open: true });
	const shared = project(root);
	assert.deepEqual(shared, {
		$: "Root",
		title: "t",
		kind: "note",
		items: [{ $: "Item", label: "a", done: false }],
		meta: {},
	});
	assert.equal(project(root, { level: "local" }).selected, 0);
	assert.equal("open" in project(root, { level: "local" }), false);
	const back = hydrate(project(root, { level: "local" }), host.scope);
	assert.equal(specOf(back), Root);
	assert.equal(specOf(back.items[0]), Item);
	assert.equal(scopeOf(back.items[0]), host.scope);
	assert.equal(back.selected, 0);
	assert.equal(back.open, false);
});

test("project rejects what it can't store", () => {
	assert.throws(() => project({ meta: { a: Number.NaN } }), /meta\/a/);
	assert.throws(() => project({ a: undefined }), /undefined at \/a/);
	assert.throws(() => project({ $: "x" }), /reserved key/);
	assert.throws(() => project(Item.make({})), /without a scope/);
});

test("components made in a child scope round-trip through it", () => {
	const { host } = setup();
	const editor = host.scope.enter("editor");
	const root = editor.make("Root", { items: [editor.make("Item", { label: "x" })] });
	const plain = project(root);
	assert.equal(plain.items[0].$, "editor/Item");
	assert.equal(scopeOf(hydrate(plain, host.scope).items[0]), editor);
});

// --- diff ----------------------------------------------------------------------------------

const diffOf = (host, prev, next, level) => diff(prev, next, { scope: host.scope, level });
const roundTrips = (host, prev, next) => {
	const ops = diffOf(host, prev, next);
	assert.deepEqual(applyOps(project(prev), ops), project(next));
	return ops;
};

test("textSplice keeps the common prefix and suffix", () => {
	assert.deepEqual(textSplice("hello", "help"), { index: 3, remove: 2, insert: "p" });
	assert.deepEqual(textSplice("aaa", "aaaa"), { index: 3, remove: 0, insert: "a" });
	assert.deepEqual(textSplice("😀", "😃"), { index: 0, remove: 2, insert: "😃" });
});

test("diff splices strings fields and sets atomic ones", () => {
	const { host, C } = setup();
	const a = C.Root({ title: "hello" });
	const ops = roundTrips(host, a, edit(a, { title: "hello world", kind: "list" }));
	assert.deepEqual(
		ops.map((o) => o.op),
		["text", "set"],
	);
});

test("diff matches array items by identity", () => {
	const { host, C } = setup();
	const [x, y, z] = ["x", "y", "z"].map((label) => C.Item({ label }));
	const a = C.Root({ items: [x, y, z] });
	const unshift = roundTrips(host, a, edit(a, { items: [C.Item({ label: "w" }), x, y, z] }));
	assert.deepEqual(
		unshift.map((o) => [o.op, o.index]),
		[["insert", 0]],
	);
	const remove = roundTrips(host, a, edit(a, { items: [x, z] }));
	assert.deepEqual(remove, [{ op: "remove", path: ["items"], index: 1, count: 1 }]);
	// An item replaced in place diffs into it.
	const edited = roundTrips(host, a, edit(a, { items: [x, edit(y, { label: "Y" }), z] }));
	assert.deepEqual(edited, [
		{ op: "text", path: ["items", 1, "label"], index: 0, remove: 1, insert: "Y" },
	]);
});

test("diff skips fields its level doesn't see and shared subtrees", () => {
	const { host, C } = setup();
	const a = C.Root({ items: [C.Item()] });
	assert.deepEqual(diffOf(host, a, edit(a, { selected: 0, open: true })), []);
	assert.equal(diffOf(host, a, edit(a, { selected: 0 }), "local").length, 1);
	assert.deepEqual(diffOf(host, a, a), []);
	const meta = roundTrips(host, C.Root({ meta: { a: 1, b: 2 } }), C.Root({ meta: { b: 3, c: 4 } }));
	assert.deepEqual(
		meta.map((o) => o.op),
		["delete", "set", "set"],
	);
});

test("applyOps reports ops made against another state", () => {
	assert.throws(
		() => applyOps({ a: [] }, [{ op: "remove", path: ["a"], index: 0, count: 1 }]),
		OpConflictError,
	);
	assert.throws(() => applyOps({}, [{ op: "set", path: ["x", "y"], value: 1 }]), OpConflictError);
});

test("applyStateOps hydrates the components ops insert", () => {
	const { host, C } = setup();
	const prev = C.Root();
	const ops = diffOf(host, prev, edit(prev, { items: [C.Item({ label: "n" })] }));
	host.start(prev);
	host.applyExternal((draft) => applyStateOps(draft, ops, host.scope));
	assert.equal(specOf(host.rootComponent.items[0]), Item);
	assert.equal(host.rootComponent.items[0].label, "n");
});

// --- the host seam -------------------------------------------------------------------------

test("engines see each committed change; a throwing one fails the task", () => {
	const { host, C, failures } = started();
	const seen = [];
	host.attachSync({
		level: "shared",
		commit: (change) => seen.push(opsOf(change, "shared", host.scope)),
	});
	send(host, "retitle", ["a"]);
	assert.deepEqual(seen, [[{ op: "text", path: ["title"], index: 0, remove: 0, insert: "a" }]]);
	host.detachSync();
	host.attachSync({
		level: "shared",
		commit() {
			throw new Error("offline");
		},
	});
	const before = host.rootComponent;
	send(host, "retitle", ["b"]);
	assert.equal(host.rootComponent, before);
	assert.match(failures.at(-1).message, /offline/);
	void C;
});

test("applyExternal keeps untouched subtrees and skips the engine it came from", () => {
	const { host, C } = setup();
	host.start(C.Root({ items: [C.Item({ label: "a" })], meta: { x: 1 } }));
	const commits = [];
	const source = {
		level: "shared",
		commit: () => commits.push("source"),
		attach: (l) => (source.link = l),
	};
	const other = { level: "shared", commit: () => commits.push("other") };
	host.attachSync(source, other);
	const before = host.rootComponent;
	source.link.apply((draft) => {
		draft.title = "remote";
	});
	assert.equal(host.rootComponent.title, "remote");
	assert.equal(host.rootComponent.items, before.items);
	assert.deepEqual(commits, ["other"]);
});

// --- remote engine -------------------------------------------------------------------------

const remoteClient = async (remote) => {
	const s = setup();
	const engine = remoteEngine({ transport: remote.connect() });
	await startSynced(s.host, { rootRef: "Root", engines: [engine] });
	return { ...s, engine };
};

test("remote clients converge through the relay", async () => {
	const remote = memoryRemote();
	const a = await remoteClient(remote);
	await settle();
	const b = await remoteClient(remote);
	send(a.host, "retitle", ["shared title"]);
	send(a.host, "add", ["first"]);
	await settle();
	assert.equal(b.host.rootComponent.title, "shared title");
	assert.equal(specOf(b.host.rootComponent.items[0]), Item);
	send(b.host, "add", ["second"]);
	await settle();
	assert.deepEqual(project(a.host.rootComponent), project(b.host.rootComponent));
	assert.deepEqual(remote.relay.load().value, project(a.host.rootComponent));
});

test("a change made against an old version is rejected and reloads", async () => {
	const remote = memoryRemote();
	const a = await remoteClient(remote);
	await settle();
	const b = await remoteClient(remote);
	send(a.host, "retitle", ["from a"]);
	send(b.host, "retitle", ["from b"]); // before b hears of a's change
	await settle();
	await settle();
	assert.equal(a.host.rootComponent.title, "from a");
	assert.equal(b.host.rootComponent.title, "from a");
});

test("a local engine restores local fields under the shared ones", async () => {
	const remote = memoryRemote();
	const a = await remoteClient(remote);
	send(a.host, "add", ["x"]);
	await settle();
	let saved = null;
	const local = {
		level: "local",
		load: () => saved,
		commit(change) {
			saved = project(change.next, { level: "local" });
		},
	};
	const s = setup();
	await startSynced(s.host, {
		rootRef: "Root",
		engines: [remoteEngine({ transport: remote.connect() }), local],
	});
	s.host.applyExternal((d) => {
		d.selected = 0;
		d.open = true;
	});
	const t = setup();
	await startSynced(t.host, {
		rootRef: "Root",
		engines: [remoteEngine({ transport: remote.connect() }), local],
	});
	assert.equal(t.host.rootComponent.selected, 0);
	assert.equal(t.host.rootComponent.open, false);
	assert.equal(t.host.rootComponent.items[0].label, "x");
});

// --- automerge -----------------------------------------------------------------------------

const amClient = async (handle) => {
	const s = setup();
	const engine = automergeEngine({ handle });
	await startSynced(s.host, { rootRef: "Root", engines: [engine] });
	return { ...s, engine };
};

test("automerge keeps the projection in the document, text as text", async () => {
	const handle = docHandle();
	const a = await amClient(handle);
	send(a.host, "retitle", ["doc"]);
	send(a.host, "add", ["item"]);
	assert.deepEqual(fromDoc(handle.doc()), project(a.host.rootComponent));
	assert.equal(typeof handle.doc().title, "string");
	assert.notEqual(typeof handle.doc().kind, "string"); // an ImmutableString
});

test("automerge peers merge concurrent edits", async () => {
	const { clone } = await import("@automerge/automerge");
	const ha = docHandle();
	const a = await amClient(ha);
	send(a.host, "retitle", ["hello"]);
	const hb = docHandle(clone(ha.doc()));
	const b = await amClient(hb);
	const itemsBefore = b.host.rootComponent.items;
	send(a.host, "retitle", ["hello world"]);
	send(b.host, "retitle", ["oh hello"]);
	send(b.host, "add", ["from b"]);
	ha.merge(hb.doc());
	hb.merge(ha.doc());
	assert.equal(a.host.rootComponent.title, "oh hello world");
	assert.deepEqual(project(a.host.rootComponent), project(b.host.rootComponent));
	assert.notEqual(b.host.rootComponent.items, itemsBefore);
	assert.equal(specOf(a.host.rootComponent.items[0]), Item);
});

test("applying diff(a, b) to a gives b, for generated states", async () => {
	const { default: fc } = await import("fast-check");
	const { produce } = await import("../../deps/immer.js");
	const { arbitraries } = await import("../../src/test/pbt.js");
	const { host } = setup();
	const A = arbitraries({ fc, scope: host.scope, maxLength: 5 });
	// b mixes a's items, its own and repeats, so identity matching has something to match.
	const pair = fc
		.tuple(A.instance("Root"), A.instance("Root"), fc.array(fc.nat(9)))
		.map(([a, b, picks]) => {
			const pool = [...a.items, ...b.items];
			const items = pool.length === 0 ? [] : picks.map((i) => pool[i % pool.length]);
			return [a, edit(b, { items })];
		});
	fc.assert(
		fc.property(pair, ([a, b]) => {
			for (const level of ["shared", "local"]) {
				const ops = diff(a, b, { scope: host.scope, level });
				assert.deepEqual(applyOps(project(a, { level }), ops), project(b, { level }));
				const applied = produce(a, (draft) => applyStateOps(draft, ops, host.scope));
				assert.deepEqual(project(applied, { level }), project(b, { level }));
			}
		}),
		{ numRuns: 200 },
	);
});

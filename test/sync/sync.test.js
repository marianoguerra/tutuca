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
	overlay,
	project,
	startSynced,
	textSplice,
} from "../../src/sync/index.js";
import { memoryRemote, relay, remoteEngine } from "../../src/sync/remote.js";
import { component, DispatchPath, scopeOf, specOf, Target, Task } from "../../src/tutuca.js";
import { setupHost, tick } from "../helpers.js";

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

test("applyOps checks every op against the state before changing it", () => {
	const conflicts = [
		[{ a: [1, 2] }, { op: "insert", path: ["a"], index: Number.NaN, values: [9] }],
		[{ a: [1, 2] }, { op: "insert", path: ["a"], index: 3, values: [9] }],
		[{ a: [1, 2] }, { op: "remove", path: ["a"], index: 1, count: -1 }],
		[{ a: [1] }, { op: "set", path: ["a", 3], value: 9 }],
		[{ a: [1] }, { op: "set", path: ["a", "length"], value: 0 }],
		[{ a: [1] }, { op: "delete", path: ["a", 0] }],
		[{ a: "x" }, { op: "set", path: ["a", "k"], value: 9 }],
		[{ a: "x" }, { op: "text", path: ["a"], index: 0, remove: 2, insert: "" }],
		[{ a: 1 }, { op: "text", path: ["a"], index: 0, remove: 0, insert: "y" }],
		[{}, { op: "delete", path: ["toString"] }],
		[{}, { op: "set", path: ["__proto__", "polluted"], value: 1 }],
		[{}, { op: "move", path: [] }],
	];
	for (const [root, op] of conflicts) {
		const before = structuredClone(root);
		assert.throws(() => applyOps(root, [op]), OpConflictError, JSON.stringify(op));
		assert.deepEqual(root, before);
	}
	assert.equal({}.polluted, undefined);
});

test("a map key named __proto__ is data", () => {
	const plain = JSON.parse('{"m":{"__proto__":1}}');
	assert.deepEqual(Object.keys(project(plain).m), ["__proto__"]);
	const set = applyOps({ m: {} }, [{ op: "set", path: ["m", "__proto__"], value: 2 }]);
	assert.equal(Object.getPrototypeOf(set.m), Object.prototype);
	assert.equal(Object.getOwnPropertyDescriptor(set.m, "__proto__").value, 2);
});

test("the relay applies a batch whole or not at all", () => {
	const r = relay({ version: 1, value: { a: 1, b: [] } });
	const batch = (ops) => ({ clientId: "c", seq: 1, base: 1, ops });
	const set = { op: "set", path: ["a"], value: 2 };
	const bad = { op: "remove", path: ["b"], index: 0, count: 1 };
	assert.deepEqual(r.receive(batch([set, bad])), { type: "reject", clientId: "c", seq: 1 });
	assert.deepEqual(r.receive(batch("not ops")).type, "reject");
	assert.deepEqual(r.load(), { version: 1, value: { a: 1, b: [] } });
	assert.equal(r.receive(batch([set])).version, 2);
});

test("overlay keeps the fields the level over lacks inside components, maps and arrays", () => {
	const { host } = setup();
	const Card = component({
		name: "Card",
		fields: (t) => ({ label: t.string(), open: t.boolean().sync("local") }),
		view: "x",
	});
	const Board = component({
		name: "Board",
		fields: (t) => ({ cards: t.array(t.component("Card")), byId: t.map(t.component("Card")) }),
		view: "x",
	});
	host.scope.register({ Card, Board });
	const card = (label, open) => ({ $: "Card", label, ...(open === undefined ? {} : { open }) });
	const local = {
		$: "Board",
		cards: [card("a", true)],
		byId: { k: card("b", true), gone: card("c", true) },
	};
	const shared = { $: "Board", cards: [card("a")], byId: { k: card("b") } };
	assert.deepEqual(overlay(local, shared, host.scope), {
		$: "Board",
		cards: [card("a", true)],
		byId: { k: card("b", true) }, // gone was removed by the shared level
	});
	// Other items where they were: shared's array, its local fields at their defaults.
	const moved = { ...shared, cards: [{ $: "Board", cards: [], byId: {} }] };
	assert.deepEqual(overlay(local, moved, host.scope).cards, moved.cards);
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

test("engines see each committed change", () => {
	const { host } = started();
	const seen = [];
	host.attachSync({
		level: "shared",
		commit: (change) => seen.push(opsOf(change, "shared", host.scope)),
	});
	send(host, "retitle", ["a"]);
	assert.deepEqual(seen, [[{ op: "text", path: ["title"], index: 0, remove: 0, insert: "a" }]]);
});

test("a throwing prepare fails the task before any engine wrote it", () => {
	const { host, failures } = started();
	const written = [];
	const writer = { level: "shared", commit: (change) => written.push(change) };
	const failing = {
		level: "local",
		prepare() {
			throw new Error("can't store");
		},
		commit: (change) => written.push(change),
	};
	host.attachSync(writer, failing);
	const before = host.rootComponent;
	send(host, "retitle", ["b"]);
	assert.equal(host.rootComponent, before);
	assert.match(failures.at(-1).message, /can't store/);
	assert.deepEqual(written, []);
});

test("a throwing commit is reported and the change stands for every engine", () => {
	const reports = [];
	const s = setupHost(
		{ Root, Item },
		{ sync: true, onReport: (type, info) => reports.push([type, info]) },
	);
	s.host.start(s.C.Root());
	const written = [];
	const failing = {
		level: "local",
		commit() {
			throw new Error("quota");
		},
	};
	s.host.attachSync(failing, { level: "shared", commit: (change) => written.push(change.next) });
	send(s.host, "retitle", ["c"]);
	assert.equal(s.host.rootComponent.title, "c");
	assert.deepEqual(s.failures, []);
	assert.equal(written.at(-1), s.host.rootComponent);
	const [, info] = reports.find(([type]) => type === "syncFailed");
	assert.equal(info.engine, failing);
	assert.match(info.error.message, /quota/);
});

test("a change an engine applies while engines commit waits until they all have", () => {
	const { host } = started();
	const seen = [];
	let link = null;
	const echo = {
		level: "shared",
		attach: (l) => (link = l),
		commit(change) {
			seen.push(["echo", change.next.title]);
			if (change.task !== null)
				link.apply((d) => {
					d.kind = "list";
				});
		},
	};
	const after = { level: "shared", commit: (change) => seen.push(["after", change.next.title]) };
	host.attachSync(echo, after);
	send(host, "retitle", ["t"]);
	assert.equal(host.rootComponent.title, "t");
	assert.equal(host.rootComponent.kind, "list");
	// after sees the task's change, then echo's, each once and in order.
	assert.deepEqual(seen, [
		["echo", "t"],
		["after", "t"],
		["after", "t"],
	]);
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
	await startSynced(s.host, { make: (C) => C.Root(), engines: [engine] });
	return { ...s, engine };
};

test("remote clients converge through the relay", async () => {
	const remote = memoryRemote();
	const a = await remoteClient(remote);
	await tick();
	const b = await remoteClient(remote);
	send(a.host, "retitle", ["shared title"]);
	send(a.host, "add", ["first"]);
	await tick();
	assert.equal(b.host.rootComponent.title, "shared title");
	assert.equal(specOf(b.host.rootComponent.items[0]), Item);
	send(b.host, "add", ["second"]);
	await tick();
	assert.deepEqual(project(a.host.rootComponent), project(b.host.rootComponent));
	assert.deepEqual(remote.relay.load().value, project(a.host.rootComponent));
});

test("a change made against an old version is rejected and reloads", async () => {
	const remote = memoryRemote();
	const a = await remoteClient(remote);
	await tick();
	const b = await remoteClient(remote);
	send(a.host, "retitle", ["from a"]);
	send(b.host, "retitle", ["from b"]); // before b hears of a's change
	await tick();
	await tick();
	assert.equal(a.host.rootComponent.title, "from a");
	assert.equal(b.host.rootComponent.title, "from a");
});

test("a local engine restores local fields under the shared ones", async () => {
	const remote = memoryRemote();
	const a = await remoteClient(remote);
	send(a.host, "add", ["x"]);
	await tick();
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
		make: (C) => C.Root(),
		engines: [remoteEngine({ transport: remote.connect() }), local],
	});
	s.host.applyExternal((d) => {
		d.selected = 0;
		d.open = true;
	});
	const t = setup();
	await startSynced(t.host, {
		make: (C) => C.Root(),
		engines: [remoteEngine({ transport: remote.connect() }), local],
	});
	assert.equal(t.host.rootComponent.selected, 0);
	assert.equal(t.host.rootComponent.open, false);
	assert.equal(t.host.rootComponent.items[0].label, "x");
});

// A transport per client over r whose pushes wait until the test delivers them, by place in the
// queue; a delivery's message reaches every client at once, in order.
const hub = (r) => {
	const queue = [];
	const subscribers = new Set();
	const send = (message) => {
		for (const fn of subscribers) fn(structuredClone(message));
		return message;
	};
	const h = {
		queue,
		loads: 0,
		send,
		deliver: (i = 0) => send(r.receive(structuredClone(queue.splice(i, 1)[0]))),
		connect: () => ({
			push: (batch) => queue.push(batch),
			subscribe(fn) {
				subscribers.add(fn);
				return () => subscribers.delete(fn);
			},
			load() {
				h.loads++;
				return Promise.resolve(r.load());
			},
		}),
	};
	return h;
};
const hubClient = async (h, specs = { Root, Item }) => {
	const reports = [];
	const s = setupHost(specs, { sync: true, onReport: (type, info) => reports.push([type, info]) });
	await startSynced(s.host, {
		make: (C) => C.Root(),
		engines: [remoteEngine({ transport: h.connect() })],
	});
	return { ...s, reports };
};
const reportsOf = (client, type) => client.reports.filter(([t]) => t === type).map(([, i]) => i);
const rootPlain = (fields) => ({
	$: "Root",
	title: "",
	kind: "note",
	items: [],
	meta: {},
	...fields,
});

test("a client has one batch in flight, so none goes on a version it wasn't made against", async () => {
	const r = relay({ version: 1, value: rootPlain({ title: "abc" }) });
	const h = hub(r);
	const a = await hubClient(h);
	const b = await hubClient(h);
	a.host.applyExternal((d) => {
		d.title = "abcX";
	});
	await tick();
	a.host.applyExternal((d) => {
		d.title = "abcXY";
	}); // waits for the first
	b.host.applyExternal((d) => {
		d.title = "Zabc";
	});
	await tick();
	assert.equal(h.queue.length, 2);
	h.deliver(1); // b's goes first, so a's is rejected
	h.deliver(0);
	await tick();
	assert.deepEqual(h.queue, []);
	assert.equal(r.load().value.title, "Zabc");
	assert.equal(a.host.rootComponent.title, "Zabc");
	assert.equal(b.host.rootComponent.title, "Zabc");
	const [rejected] = reportsOf(a, "syncRejected");
	assert.equal(rejected.ops.length, 2);
});

test("a resync keeps the fields the remote doesn't see", async () => {
	const h = hub(
		relay({ version: 1, value: rootPlain({ items: [{ $: "Item", label: "x", done: false }] }) }),
	);
	const a = await hubClient(h);
	const b = await hubClient(h);
	a.host.applyExternal((d) => {
		d.selected = 0;
		d.open = true;
	});
	b.host.applyExternal((d) => {
		d.title = "from b";
	});
	a.host.applyExternal((d) => {
		d.title = "from a";
	});
	await tick();
	h.deliver(); // b's, so a's is rejected
	h.deliver();
	await tick();
	assert.equal(a.host.rootComponent.title, "from b");
	assert.equal(a.host.rootComponent.selected, 0);
	assert.equal(a.host.rootComponent.open, true);
});

test("messages a client has seen don't make it resync", async () => {
	const h = hub(relay({ version: 1, value: rootPlain() }));
	const a = await hubClient(h);
	const b = await hubClient(h);
	b.host.applyExternal((d) => {
		d.title = "t";
	});
	await tick();
	const message = h.deliver();
	await tick();
	const loads = h.loads;
	h.send(message);
	h.send(message);
	await tick();
	assert.equal(h.loads, loads);
	assert.equal(a.host.rootComponent.title, "t");
});

test("a batch that arrives before a client pushed its own edits makes it resync", async () => {
	const r = relay({ version: 1, value: rootPlain({ title: "abc" }) });
	const h = hub(r);
	const a = await hubClient(h);
	const b = await hubClient(h);
	b.host.applyExternal((d) => {
		d.title = "Yabc";
	});
	await tick();
	a.host.applyExternal((d) => {
		d.title = "aXbc";
	});
	h.deliver(); // before a pushed its edit, which was made against "abc"
	await tick();
	assert.deepEqual(h.queue, []);
	assert.equal(a.host.rootComponent.title, "Yabc");
	assert.deepEqual(project(a.host.rootComponent), r.load().value);
	assert.equal(reportsOf(a, "syncRejected").length, 1);
});

test("a batch sent between a client's load and attach reaches it", async () => {
	const r = relay({ version: 1, value: rootPlain({ title: "abc" }) });
	const h = hub(r);
	const b = await hubClient(h);
	b.host.applyExternal((d) => {
		d.title = "Yabc";
	});
	await tick();
	const transport = h.connect();
	const s = setupHost({ Root, Item }, { sync: true });
	await startSynced(s.host, {
		make: (C) => C.Root(),
		engines: [
			remoteEngine({
				transport: {
					...transport,
					load() {
						const state = r.load();
						h.deliver(); // after the snapshot, before attach
						return Promise.resolve(state);
					},
				},
			}),
		],
	});
	const loads = h.loads;
	await tick();
	assert.equal(s.host.rootComponent.title, "Yabc");
	assert.equal(h.loads, loads);
});

test("a client whose copy doesn't take a batch resyncs to the remote", async () => {
	const r = relay({ version: 1, value: rootPlain({ title: "remote" }) });
	const h = hub(r);
	const a = await hubClient(h);
	const loads = h.loads;
	const op = { op: "remove", path: ["items"], index: 5, count: 1 };
	h.send({ type: "batch", clientId: "other", seq: 1, version: 2, ops: [op] });
	await tick();
	assert.equal(h.loads, loads + 1);
	assert.equal(reportsOf(a, "syncFailed").length, 1);
	assert.deepEqual(project(a.host.rootComponent), r.load().value);
});

// Two versions of an app: the second adds a text field.
const Doc1 = component({ name: "Root", fields: (t) => ({ title: t.string() }), view: "x" });
const Doc2 = component({
	name: "Root",
	fields: (t) => ({ title: t.string(), body: t.string() }),
	view: "x",
});

test("a field a newer version adds syncs through the relay, and older clients drop it", async () => {
	const r = relay({ version: 1, value: { $: "Root", title: "t" } });
	const h = hub(r);
	const old = await hubClient(h, { Root: Doc1 });
	const neu = await hubClient(h, { Root: Doc2 });
	const loads = h.loads;
	neu.host.applyExternal((d) => {
		d.body = "hi";
	});
	await tick();
	h.deliver();
	await tick();
	neu.host.applyExternal((d) => {
		d.body += "!";
	});
	await tick();
	assert.deepEqual(h.queue[0].ops, [
		{ op: "text", path: ["body"], index: 2, remove: 0, insert: "!" },
	]);
	h.deliver();
	await tick();
	assert.deepEqual(r.load().value, { $: "Root", title: "t", body: "hi!" });
	assert.equal(h.loads, loads);
	assert.equal(project(old.host.rootComponent).body, undefined);
	assert.deepEqual(reportsOf(old, "stateMigrated").at(-1).dropped, [["body"]]);
});

test("a field a newer version adds syncs through automerge, and older peers keep merging", async () => {
	const ha = docHandle();
	const failures = [];
	const peer = async (specs, handle) => {
		const s = setupHost(specs, {
			sync: true,
			onReport: (t, i) => t === "syncFailed" && failures.push(i),
		});
		await startSynced(s.host, { make: (C) => C.Root(), engines: [automergeEngine({ handle })] });
		return s.host;
	};
	const old = await peer({ Root: Doc1 }, ha);
	old.applyExternal((d) => {
		d.title = "t";
	});
	const hb = docHandle();
	hb.merge(ha.doc());
	const neu = await peer({ Root: Doc2 }, hb);
	neu.applyExternal((d) => {
		d.body = "hi";
	});
	neu.applyExternal((d) => {
		d.body += "!";
	});
	old.applyExternal((d) => {
		d.title += "itle";
	});
	ha.merge(hb.doc());
	hb.merge(ha.doc());
	assert.deepEqual(fromDoc(hb.doc()), { $: "Root", title: "title", body: "hi!" });
	assert.equal(neu.rootComponent.title, "title");
	assert.equal(old.rootComponent.title, "title");
	assert.deepEqual(failures, []);
});

test("automerge brings a state that parted from its document back to it", async () => {
	const ha = docHandle();
	const a = await amClient(ha);
	send(a.host, "add", ["x"]);
	const hb = docHandle();
	hb.merge(ha.doc());
	const b = await amClient(hb);
	// a loses the item without its document hearing of it.
	a.host.applyExternal((d) => void d.items.splice(0, 1), a.engine);
	send(b.host, "retitle", ["t"]);
	b.host.applyExternal((d) => void d.items.splice(0, 1));
	ha.merge(hb.doc());
	assert.deepEqual(project(a.host.rootComponent), fromDoc(ha.doc()));
	assert.equal(a.host.rootComponent.title, "t");
});

// --- automerge -----------------------------------------------------------------------------

const amClient = async (handle) => {
	const s = setup();
	const engine = automergeEngine({ handle });
	await startSynced(s.host, { make: (C) => C.Root(), engines: [engine] });
	return { ...s, engine };
};

test("automerge brings in what changed in the document between load and attach", async () => {
	const handle = docHandle();
	const a = await amClient(handle);
	const b = setup();
	const between = {
		level: "shared",
		load() {
			send(a.host, "retitle", ["between"]);
			return null;
		},
		commit() {},
	};
	await startSynced(b.host, {
		make: (C) => C.Root(),
		engines: [automergeEngine({ handle }), between],
	});
	assert.equal(b.host.rootComponent.title, "between");
	assert.deepEqual(project(b.host.rootComponent), fromDoc(handle.doc()));
});

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

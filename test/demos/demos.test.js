import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inferSchema, schemaDocument } from "../../components/json-schema/infer.js";
import { quadraticLabel } from "../../components/math/workbench.js";
import { addDays } from "../../components/todo/dates.js";
import { TODAY } from "../../components/todo/fixtures.js";
import { start as startComposition } from "../../demos/composition/main.js";
import { start as startDrawing } from "../../demos/drawing/main.js";
import { start as startStudio } from "../../demos/json-schema/main.js";
import { start as startKanban } from "../../demos/kanban/main.js";
import { start as startLang } from "../../demos/lang/main.js";
import { start as startMath } from "../../demos/math/main.js";
import { start as startNotes } from "../../demos/notes/main.js";
import { notesComponents } from "../../demos/notes/notes.js";
import { RELAY_URL, syncFromQuery } from "../../demos/sync/engines.js";
import { start as startTracker } from "../../demos/thing-tracker/main.js";
import { start as startTodo } from "../../demos/todo/main.js";
import { start as startTreeSpec } from "../../demos/tree-spec/main.js";
import { lint } from "../../src/lint/index.js";
import { startSynced } from "../../src/sync/index.js";
import { relay } from "../../src/sync/remote.js";
import { Host, specOf } from "../../src/tutuca.js";
import { dom, settle } from "../helpers.js";

// Boots a demo in jsdom, collecting what would go to console.error.
const mount = (start, ...args) => {
	const window = dom('<div id="app"></div>');
	const { document } = window;
	const host = start(document, ...args);
	const problems = [];
	const notify = host.onNotify;
	host.onNotify = (type, info) => {
		if (type === "taskFailed" || type === "stateInvalid") problems.push({ type, ...info });
		else notify(type, info);
	};
	const rootNode = document.getElementById("app");
	const $ = (selector) => rootNode.querySelector(selector);
	const fire = (type, el, value) => {
		if (value !== undefined) el.value = value;
		const Event = type === "click" ? window.MouseEvent : window.Event;
		el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
	};
	return { host, rootNode, $, fire, problems, state: () => host.rootComponent };
};

const checkClean = async ({ host, rootNode, problems }) => {
	await settle();
	assert.ok(rootNode.childNodes.length > 0, "renders");
	assert.deepEqual(problems, []);
	const errors = lint([...host.registrations], [...host.componentNames]).filter(
		(i) => i.level === "error",
	);
	assert.deepEqual(
		errors.map((i) => `${i.code} ${i.path}: ${i.message}`),
		[],
	);
};

test("drawing demo: picks a tool", async () => {
	const app = mount(startDrawing);
	assert.equal(app.state().shapes.length, 5);
	app.fire("click", app.$('button[title="Rectangle (R)"]'));
	assert.equal(app.state().tool, "rect");
	await checkClean(app);
});

test("tree spec demo: steps through an exported scenario", async () => {
	const scenario = JSON.parse(
		readFileSync(new URL("../../demos/tree-spec/scenarios/requests.json", import.meta.url), "utf8"),
	);
	const app = mount(startTreeSpec, scenario);
	app.fire("click", app.$("section button.btn-outline"));
	assert.equal(app.state().trail.length, 1);
	await checkClean(app);
});

test("kanban demo: moves a dragged card to the column it's dropped on", async () => {
	const app = mount(startKanban);
	const [todo, , done] = app.rootNode.querySelectorAll(".grid > div");
	const card = todo.querySelector('[data-dragtype="card"]');
	app.fire("dragstart", card);
	app.fire("dragover", done);
	app.fire("drop", done);
	app.fire("dragend", card);
	assert.deepEqual(
		app.state().columns.map((column) => column.cards.length),
		[2, 1, 1],
	);
	await checkClean(app);
});

test("composition demo: a picker becomes the cell picked, and adds pickers around it", async () => {
	const app = mount(startComposition);
	const kinds = () => app.state().order.map((key) => specOf(app.state().entries[key].content).name);
	app.fire("click", app.$('[data-choice="tracker"]'));
	app.fire("click", app.$('[data-choice="group:pets/care"]'));
	assert.deepEqual(kinds(), ["TrackerCell"]);
	app.fire("click", app.$('[title="Add a cell at the end"]'));
	app.fire("click", app.$('[data-choice="kanban"]'));
	assert.deepEqual(kinds(), ["TrackerCell", "Board"]);
	await checkClean(app);
});

test("lang demo: switches notation and edits the program", async () => {
	const app = mount(startLang);
	const output = () => app.$('[aria-label="Result"]').textContent;
	assert.equal(output(), '⇒ "ADA!"');
	app.fire("click", app.$('[data-notation="forth"]'));
	assert.match(app.$("pre").textContent, /IF .* ELSE .* THEN/);
	app.fire("click", app.$('[data-mode="edit"]'));
	assert.equal(app.state().viewName, "editForth");
	app.fire("input", app.$('[aria-label="number"]'), "2");
	assert.equal(output(), '⇒ s" 3"');
	await checkClean(app);
});

test("a demo's time travel bar steps back to an earlier state", async () => {
	const app = mount(startLang);
	const bar = app.rootNode.previousElementSibling;
	assert.equal(bar.className, "time-travel");
	app.fire("click", app.$('[data-notation="forth"]'));
	app.fire("click", app.$('[data-mode="edit"]'));
	await settle();
	assert.match(bar.textContent, /state 3 of 3 · ☝ click → setMode\("edit"\)/);
	app.fire("click", bar.querySelector('button[title="Back"]'));
	await settle();
	assert.equal(app.state().viewName, "viewForth");
	app.fire("click", bar.querySelector('button[title="First state"]'));
	await settle();
	assert.equal(app.state().viewName, "viewLisp");
	assert.match(bar.textContent, /state 1 of 3 · ◆ initial/);
	await checkClean(app);
});

test("math demo: saves, reopens and removes problems", async () => {
	const app = mount(startMath);
	const save = () =>
		app.fire(
			"click",
			[...app.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Save problem"),
		);
	save();
	assert.equal(app.state().history.length, 3);
	assert.equal(app.state().history[0].label, quadraticLabel(1, -3, 2));
	assert.equal(app.state().history[0].label, "x² − 3x + 2 = 0");
	save(); // Already saved: no duplicate.
	assert.equal(app.state().history.length, 3);
	app.fire("click", app.rootNode.querySelectorAll('button[title="Open"]')[2]);
	assert.equal(app.state().tab, "matrix");
	assert.deepEqual([app.state().matrix.a, app.state().matrix.d], [2, 2]);
	assert.equal(app.state().matrix.det, 0);
	app.fire("click", app.$('[aria-label="Remove problem"]'));
	assert.equal(app.state().history.length, 2);
	await checkClean(app);
});

test("todo demo: quick adds a task in plain words", async () => {
	const today = TODAY;
	const app = mount(startTodo, today);
	app.fire("input", app.$('[aria-label="Quick add"]'), "Call mom tomorrow p1 #Errands");
	app.fire("submit", app.$('[aria-label="Quick add task"]'));
	const task = app.state().tasks.at(-1);
	assert.equal(task.title, "Call mom");
	assert.equal(task.due, addDays(today, 1));
	assert.equal(task.priority, 1);
	assert.equal(app.state().projects.find((p) => p.id === task.projectId).name, "Errands");
	await checkClean(app);
});

test("json studio demo: the schema follows the payload", async () => {
	const app = mount(startStudio);
	const properties = () => app.state().schema.toSchema().properties;
	assert.deepEqual(Object.keys(properties()).slice(0, 3), ["orderId", "createdAt", "status"]);
	assert.equal(properties().createdAt.format, "date-time");
	// Renaming a key in the editor infers the schema again.
	app.fire("input", app.$('[aria-label="key"]'), "orderNumber");
	await settle();
	assert.ok("orderNumber" in properties());
	assert.equal(app.state().isStale, false);
	app.fire("change", app.$('[aria-label="Sample payload"]'), "user");
	assert.equal(properties().email.format, "email");
	assert.equal(app.state().schema.toSchema().title, "User");
	app.fire("input", app.$('[aria-label="JSON to paste"]'), "{ nope");
	app.fire(
		"click",
		[...app.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Use this JSON"),
	);
	assert.match(app.state().pasteError, /^Not JSON/);
	app.fire("input", app.$('[aria-label="JSON to paste"]'), '{"n": 1, "xs": [1, 2.5]}');
	app.fire(
		"click",
		[...app.rootNode.querySelectorAll("button")].find((b) => b.textContent === "Use this JSON"),
	);
	assert.deepEqual(properties(), {
		n: { type: "integer" },
		xs: { type: "array", items: { type: "number" } },
	});
	await checkClean(app);
});

test("inferSchema: types, formats, required keys and merged items", () => {
	assert.deepEqual(inferSchema({ a: 1, b: "x@y.io", c: null, d: true }), {
		type: "object",
		properties: {
			a: { type: "integer" },
			b: { type: "string", format: "email" },
			c: { type: "null" },
			d: { type: "boolean" },
		},
		required: ["a", "b", "c", "d"],
	});
	assert.deepEqual(inferSchema([]), { type: "array" });
	assert.deepEqual(inferSchema(["2026-01-02", "https://a.io/x"]), {
		type: "array",
		items: { type: "string" },
	});
	// Objects merge: properties from all, required only those in every one.
	assert.deepEqual(inferSchema([{ id: 1, tag: "a" }, { id: 2.5 }]), {
		type: "array",
		items: {
			type: "object",
			properties: { id: { type: "number" }, tag: { type: "string" } },
			required: ["id"],
		},
	});
	// Different types: a union, same-typed branches merged.
	assert.deepEqual(inferSchema([1, "a", 2.5, null]).items, {
		anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
	});
	assert.deepEqual(schemaDocument({ type: "null" }, "T"), {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: "T",
		type: "null",
	});
});

test("thing tracker demo: logs a thing with a tap", async () => {
	const app = mount(startTracker, Date.UTC(2026, 9, 16, 10, 30));
	const before = app.state().events.length;
	assert.ok(before > 50);
	app.fire("click", app.$('[aria-label^="Log Coffee"]'));
	await settle();
	assert.equal(app.state().events.length, before + 1);
	assert.equal(app.state().events.at(-1).thingId, "thing:hydration/coffee");
	await checkClean(app);
});

// A port to an in-process backend, answering like demos/sync/backend.js does.
const backendPorts = () => {
	const remote = relay();
	const ports = new Set();
	const connect = () => {
		const port = {
			onmessage: null,
			deliver(data) {
				setTimeout(() => port.onmessage?.({ data: structuredClone(data) }), 0);
			},
			postMessage(data) {
				if (data.type === "load")
					port.deliver({ type: "loaded", id: data.id, state: remote.load() });
				else if (data.type === "push") {
					const message = remote.receive(structuredClone(data.batch));
					for (const p of ports) p.deliver({ type: "message", message });
				}
			},
		};
		ports.add(port);
		return port;
	};
	return { remote, connect };
};
const memoryStorage = () => {
	const items = new Map();
	return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
};
const page = (query) =>
	dom('<header class="demo-bar"></header><div id="app"></div>', {
		url: `http://localhost/demos/notes/${query}`,
	});
const started = async (host) => {
	while (host.rootComponent === null) await settle();
	return host;
};

test("boot syncs any demo from the query: ?sync=local keeps the state in this browser", async () => {
	const window = page("?sync=local");
	const host = await started(startNotes(window.document));
	const $ = (selector) => window.document.querySelector(selector);
	$('[aria-label="New note"]').value = "buy milk";
	$('[aria-label="New note"]').dispatchEvent(new window.Event("input", { bubbles: true }));
	$("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	assert.match($(".sync-log").textContent, /sent: insert/);
	assert.equal($('.sync-modes [aria-current="page"]').textContent, "this browser");
	// Another page on the same address, in the same browser, starts from it.
	const again = page("?sync=local");
	Object.defineProperty(again, "localStorage", { value: window.localStorage });
	const other = await started(startNotes(again.document));
	assert.deepEqual(
		other.rootComponent.notes.map((n) => n.text),
		["buy milk"],
	);
	void host;
});

test("without ?sync a demo starts at once, its only engine the time travel history", () => {
	const host = startNotes(page("").document);
	assert.equal(host.engines.length, 1);
	assert.notEqual(host.rootComponent, null);
	assert.equal(startNotes(page("?history=0").document).engines.length, 0);
});

test("?sync=worker: tabs sync through the backend, and a new tab starts from it", async () => {
	const backend = backendPorts();
	const storage = memoryStorage();
	const open = async () => {
		const window = page("?sync=worker");
		const host = new Host({
			document: window.document,
			rootNode: window.document.getElementById("app"),
		});
		host.scope.register(notesComponents);
		const engines = await syncFromQuery(window, { connect: backend.connect, storage });
		await startSynced(host, { engines, make: (C) => C.Notes() });
		return host;
	};
	const a = await open();
	await settle();
	const b = await open();
	a.applyExternal((d) => void d.notes.push(a.scope.make("Note", { text: "buy milk" })));
	await settle();
	assert.deepEqual(
		b.rootComponent.notes.map((n) => n.text),
		["buy milk"],
	);
	a.applyExternal((d) => {
		d.filter = "open";
		d.draft = "unsaved";
	});
	const c = await open();
	assert.equal(c.rootComponent.notes[0].text, "buy milk");
	assert.equal(c.rootComponent.filter, "open"); // local: from this browser's storage
	assert.equal(c.rootComponent.draft, ""); // none: not kept
	assert.deepEqual(backend.remote.load().value.notes, [
		{ $: "Note", text: "buy milk", done: false },
	]);
});

test("?sync=relay: the Automerge document also syncs through the public relay", async () => {
	const { docHandle } = await import("../../src/sync/automerge.js");
	const window = page("?sync=relay");
	const opened = [];
	const open = (_, options) => {
		opened.push(options);
		return docHandle();
	};
	const engines = await syncFromQuery(window, { open, storage: memoryStorage() });
	assert.deepEqual(opened, [{ relay: RELAY_URL }]);
	assert.equal(engines[0].level, "shared");
});

test("?sync=automerge: tabs on the same document merge", async () => {
	const { docHandle } = await import("../../src/sync/automerge.js");
	const { clone } = await import("@automerge/automerge");
	const handle = docHandle();
	const open = async (h) => {
		const window = page("?sync=automerge");
		const host = new Host({
			document: window.document,
			rootNode: window.document.getElementById("app"),
		});
		host.scope.register(notesComponents);
		const engines = await syncFromQuery(window, { open: () => h, storage: memoryStorage() });
		await startSynced(host, { engines, make: (C) => C.Notes() });
		return host;
	};
	const a = await open(handle);
	const other = docHandle(clone(handle.doc()));
	const b = await open(other);
	a.applyExternal((d) => void d.notes.push(a.scope.make("Note", { text: "from a" })));
	b.applyExternal((d) => {
		d.title = "Merged";
	});
	handle.merge(other.doc());
	other.merge(handle.doc());
	for (const host of [a, b]) {
		assert.equal(host.rootComponent.title, "Merged");
		assert.equal(host.rootComponent.notes[0].text, "from a");
	}
});

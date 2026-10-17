import assert from "node:assert/strict";
import test from "node:test";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { addDays } from "../components/todo/dates.js";
import { TODAY } from "../components/todo/fixtures.js";
import { start as startDrawing } from "../demos/drawing/main.js";
import { inferSchema, schemaDocument } from "../demos/json-schema/infer.js";
import { start as startStudio } from "../demos/json-schema/main.js";
import { quadraticLabel, start as startMath } from "../demos/math/main.js";
import { start as startTracker } from "../demos/thing-tracker/main.js";
import { start as startTodo } from "../demos/todo/main.js";
import { lint } from "../src/lint/index.js";

// Lets tasks, notifications and the renders they cause settle.
const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

// Boots a demo in jsdom, collecting what would go to console.error.
const mount = (start, ...args) => {
	const { window } = new JSDOM('<div id="app"></div>');
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

import assert from "node:assert/strict";
import test from "node:test";
import { defineTutucaApp, mountTutucaApp, REQUEST } from "../../src/embed/element.js";
import { lint } from "../../src/lint/index.js";
import {
	component,
	DispatchPath,
	field,
	HOST,
	Host,
	h,
	send,
	Target,
	Task,
	t,
} from "../../src/tutuca.js";
import { dom } from "../helpers.js";

const Counter = component({
	name: "Counter",
	fields: { count: t.number() },
	view: h("button", { "on:click": send("inc") }, field("count")),
	on: {
		inc(next) {
			next.count++;
		},
	},
});

// Holds an inner app and counts its own clicks and the reports the app sends.
const Outer = component({
	name: "Outer",
	fields: { key: t.string("a"), clicks: t.number(), reports: t.array() },
	view: h(
		"div",
		{ "on:click": send("clicked") },
		h("tutuca-app", { "app-key": field("key"), "on:tutucareport": send("report") }),
	),
	on: {
		clicked(next) {
			next.clicks++;
		},
		report(next, _args, ctx) {
			const { key, type, data } = ctx.event.detail;
			next.reports.push({ key, type, data });
		},
		setKey(next, [key]) {
			next.key = key;
		},
		setClicks(next, [clicks]) {
			next.clicks = clicks;
		},
	},
});

const setup = () => {
	const window = dom("<body></body>");
	const { document } = window;
	defineTutucaApp(window);
	const rootNode = document.createElement("main");
	document.body.append(rootNode);
	const mounted = [];
	const disposed = [];
	rootNode.addEventListener(REQUEST, (e) => {
		const controller = mountTutucaApp(e.detail, {
			register: (scope) => scope.register({ Counter }),
			make: (C) => C.Counter({ count: e.detail.key.length }),
		});
		const { dispose } = controller;
		controller.dispose = () => {
			disposed.push(e.detail.key);
			dispose();
		};
		mounted.push(e.detail);
	});
	const host = new Host({ document, rootNode });
	host.scheduleNextTaskTick = () => {};
	const failures = [];
	host.notify = (type, info) => type === "taskFailed" && failures.push(info.error);
	host.scope.register({ Outer });
	host.start(host.scope.components.Outer());
	const element = rootNode.querySelector("tutuca-app");
	const send = (name, args) => {
		const task = new Task(name, args, HOST, new Target(new DispatchPath()), null);
		host.prepareTask(task, host.rootComponent);
		host.pushTask(task);
		host.handleTasks();
	};
	return { window, document, host, element, mounted, disposed, failures, send };
};

const innerButton = (element) => element.shadowRoot.querySelector("button");
const click = (window, node) =>
	node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));

test("the inner app mounts in the shadow root and survives outer renders", () => {
	const { element, mounted, host, send } = setup();
	assert.equal(mounted.length, 1);
	assert.equal(element.childNodes.length, 0);
	const button = innerButton(element);
	assert.equal(button.textContent, "1");
	send("setClicks", [5]);
	assert.equal(host.rootNode.querySelector("tutuca-app"), element);
	assert.equal(innerButton(element), button);
	assert.equal(mounted.length, 1);
});

test("inner clicks reach the inner host, and the outer host only sees the element", () => {
	const { window, element, host, failures } = setup();
	click(window, innerButton(element));
	assert.equal(innerButton(element).textContent, "2");
	assert.equal(element.controller.host.rootComponent.count, 2);
	// The outer div's own click handler fires, as for any element inside it.
	assert.equal(host.rootComponent.clicks, 1);
	assert.deepEqual(failures, []);
});

test("changing app-key disposes the app and requests a new one", () => {
	const { element, mounted, disposed, send } = setup();
	send("setKey", ["abc"]);
	assert.deepEqual(disposed, ["a"]);
	assert.equal(mounted.length, 2);
	assert.equal(innerButton(element).textContent, "3");
});

test("removing the element disposes its app", async () => {
	const { element, disposed } = setup();
	element.remove();
	await Promise.resolve();
	assert.deepEqual(disposed, ["a"]);
	assert.equal(element.controller, null);
});

test("moving the element keeps its app", async () => {
	const { document, element, mounted, disposed } = setup();
	document.body.append(element);
	await Promise.resolve();
	assert.equal(mounted.length, 1);
	assert.deepEqual(disposed, []);
});

test("emit reaches an outer on:tutucareport handler; stale requests are dropped", async () => {
	const { host, mounted, send } = setup();
	const first = mounted[0];
	first.emit("hello", 42);
	assert.deepEqual(host.rootComponent.reports, []);
	await Promise.resolve();
	assert.deepEqual(host.rootComponent.reports, [{ key: "a", type: "hello", data: 42 }]);
	first.emit("stale", 1);
	send("setKey", ["b"]);
	await Promise.resolve();
	assert.equal(host.rootComponent.reports.length, 1);
});

test("an element nobody answers says so", () => {
	const window = dom("<body></body>");
	defineTutucaApp(window);
	const element = window.document.createElement("tutuca-app");
	element.setAttribute("app-key", "missing");
	window.document.body.append(element);
	assert.equal(element.shadowRoot.textContent, "no app for missing");
	assert.equal(element.controller, null);
});

test("the outer view lints clean", () => {
	assert.deepEqual(
		lint([Outer]).map((i) => i.message),
		[],
	);
});

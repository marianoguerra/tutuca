import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import mathBook, { workbenchBook } from "../../components/math/stories.js";
import { playgroundComponents } from "../../src/playground/element.js";
import { makePlayground, storyChoices } from "../../src/playground/ui/playground.js";
import { defineTutucaApp, REQUEST } from "../../src/storybook/element.js";
import { StoryRegistry } from "../../src/storybook/index.js";
import { DispatchPath, Host, Target, Task } from "../../src/tutuca.js";
import { settle, testGenericProperties, testLintsClean } from "../helpers.js";

testLintsClean("playground", playgroundComponents);

testGenericProperties(playgroundComponents);

// What the element does around the Playground, without CodeMirror: a registry per run.
const start = () => {
	const { window } = new JSDOM("<body></body>");
	defineTutucaApp(window);
	const rootNode = window.document.createElement("div");
	window.document.body.append(rootNode);
	const state = { registry: null, runs: 0, picks: [] };
	rootNode.addEventListener(REQUEST, (e) => state.registry?.mount(e.detail));
	const host = new Host({ document: window.document, rootNode });
	host.scope.register(playgroundComponents);
	host.scope.registerAskHandlers({
		story: ([key, op, ...args]) => state.registry.call(key, op, args),
		delay: () => Promise.resolve(),
		playground: (pick) => {
			state.picks.push(pick);
		},
	});
	const failures = [];
	host.onNotify = (type, info) => {
		if (type === "taskFailed" || type === "stateInvalid") failures.push({ type, ...info });
	};
	host.start(makePlayground(host.scope.components));
	const send = (name, args) => {
		const path = new DispatchPath();
		const task = new Task(name, args, path, new Target(path), null);
		host.prepareTask(task, host.rootComponent);
		host.pushTask(task);
	};
	const run = (books, wanted = "") => {
		state.runs += 1;
		state.registry = new StoryRegistry({ fc, books, prefix: `r${state.runs}/` });
		send("loaded", [storyChoices(books), state.runs, wanted]);
	};
	const click = (node) =>
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
	const tab = (text) =>
		[...rootNode.querySelectorAll('[role="tab"]')].find((n) => n.textContent.startsWith(text));
	return { window, rootNode, host, state, failures, send, run, click, tab };
};

test("storyChoices names stories with their book only when there are many", () => {
	assert.equal(storyChoices([mathBook])[0].label, "Quadratic/Two roots");
	assert.equal(storyChoices([mathBook, workbenchBook])[0].label, "Math › Quadratic/Two roots");
});

test("a run shows its first story live, and the next run remounts it with the same story", async () => {
	const { rootNode, host, failures, run, window } = start();
	run([mathBook]);
	await settle();
	const app = () => rootNode.querySelector("tutuca-app");
	assert.equal(app().getAttribute("app-key"), "r1/Math/Quadratic/Two roots@0");
	assert.match(app().shadowRoot.textContent, /The roots/);
	const select = rootNode.querySelector('[aria-label="Story"]');
	select.value = "Math/Quadratic/Double root";
	select.dispatchEvent(new window.Event("change", { bubbles: true }));
	await settle();
	assert.equal(host.rootComponent.selectedId, "Math/Quadratic/Double root");
	run([mathBook]);
	await settle();
	assert.equal(app().getAttribute("app-key"), "r2/Math/Quadratic/Double root@0");
	assert.equal(host.rootComponent.status, "ready");
	assert.deepEqual(failures, []);
});

test("a run can ask for a story, and tabs show the steps and dev panels", async () => {
	const { rootNode, host, failures, run, click, tab } = start();
	run([mathBook, workbenchBook], "Math/Quadratic/Complex roots");
	await settle();
	assert.equal(host.rootComponent.selectedId, "Math/Quadratic/Complex roots");
	assert.equal(host.rootComponent.story.sequence, "−1 ± 2i");
	click(tab("Steps"));
	await settle();
	assert.equal(host.rootComponent.tab, "steps");
	click(rootNode.querySelector('[title="Run to end"]'));
	await settle();
	assert.deepEqual(
		host.rootComponent.story.steps.map((s) => s.status),
		["ok"],
	);
	click(tab("Dev"));
	await settle();
	assert.match(rootNode.textContent, /Components/);
	// The app stays mounted, hidden, while other tabs show.
	assert.ok(rootNode.querySelector("tutuca-app").shadowRoot.textContent.length > 0);
	assert.deepEqual(failures, []);
});

test("a failed run shows its error; picks are asked of the element", async () => {
	const { rootNode, host, failures, send, run, window, state } = start();
	send("setExamples", [
		[
			{ id: "math", title: "Math" },
			{ id: "json", title: "JSON" },
		],
	]);
	send("failed", ["SyntaxError: Unexpected token"]);
	await settle();
	assert.match(rootNode.querySelector('[role="alert"]').textContent, /Unexpected token/);
	assert.equal(rootNode.querySelector("tutuca-app"), null);
	const select = rootNode.querySelector('[aria-label="Example"]');
	select.value = "json";
	select.dispatchEvent(new window.Event("change", { bubbles: true }));
	await settle();
	assert.deepEqual(state.picks, [["example", "json"]]);
	assert.equal(host.rootComponent.status, "loading");
	run([mathBook]);
	await settle();
	assert.equal(host.rootComponent.status, "ready");
	assert.deepEqual(failures, []);
});

test("StoryRegistry with a prefix mounts only its own keys", () => {
	const registry = new StoryRegistry({ fc, books: [mathBook], prefix: "r2/" });
	const mounted = [];
	const detail = (key) => ({ key, mount: (c) => mounted.push(c) });
	registry.mount(detail("r1/Math/Quadratic/Two roots@0"));
	assert.equal(mounted.length, 0);
});

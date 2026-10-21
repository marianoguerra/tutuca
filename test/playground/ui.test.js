import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import mathBook, { workbenchBook } from "../../components/math/stories.js";
import { defineTutucaApp, REQUEST } from "../../src/embed/element.js";
import { playgroundComponents } from "../../src/playground/element.js";
import { makePlayground, storyChoices } from "../../src/playground/ui/playground.js";
import { StoryRegistry } from "../../src/storybook/index.js";
import { storyAskHandlers } from "../../src/storybook/runner.js";
import { DispatchPath, Host, Target, Task } from "../../src/tutuca.js";
import { dom, settle, testGenericProperties, testLintsClean } from "../helpers.js";

testLintsClean("playground", playgroundComponents);

testGenericProperties(playgroundComponents);

// What the element does around the Playground, without CodeMirror: a registry per run.
const start = () => {
	const window = dom("<body></body>");
	defineTutucaApp(window);
	const rootNode = window.document.createElement("div");
	window.document.body.append(rootNode);
	const state = { registry: null, runs: 0, picks: [] };
	rootNode.addEventListener(REQUEST, (e) => state.registry?.mount(e.detail));
	const host = new Host({ document: window.document, rootNode });
	host.scope.register(playgroundComponents);
	host.scope.registerAskHandlers({
		...storyAskHandlers(() => state.registry),
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

test("a time travel bar under the preview moves through the story's timeline", async () => {
	const { rootNode, host, failures, run, click, tab } = start();
	run([mathBook]);
	await settle();
	const bar = () => rootNode.querySelector('[aria-label="Time travel"]');
	assert.equal(bar(), null, "one state, no bar");
	click(tab("Steps"));
	await settle();
	click(rootNode.querySelector('[title="Run to end"]'));
	await settle();
	click(tab("Preview"));
	await settle();
	const { size } = host.rootComponent.travel;
	assert.ok(size > 2);
	assert.match(bar().textContent, new RegExp(`state ${size} of ${size}`));
	click(bar().querySelector('button[title="Back"]'));
	await settle();
	assert.equal(host.rootComponent.story.cursor, size - 2);
	click(bar().querySelector('button[title="First state"]'));
	await settle();
	assert.equal(host.rootComponent.story.cursor, 0);
	assert.match(bar().textContent, /state 1 of \d+ · ◆ initial/);
	assert.deepEqual(failures, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import jsonBook from "../../components/json/stories.js";
import mathBook from "../../components/math/stories.js";
import { startStorybook, storybookComponents } from "../../src/storybook/index.js";
import {
	collectProblems,
	dom,
	settle,
	testGenericProperties,
	testLintsClean,
	tick,
} from "../helpers.js";

testLintsClean("storybook", storybookComponents);

testGenericProperties(storybookComponents);

const start = (initialId = "") => {
	// A page's URL, as the storybook's: on about:blank, the hash can't be set.
	const window = dom("<body></body>", { url: "http://localhost/storybook.html" });
	const rootNode = window.document.createElement("div");
	window.document.body.append(rootNode);
	const { host, registry } = startStorybook({
		document: window.document,
		rootNode,
		fc,
		books: [jsonBook, mathBook],
		initialId,
	});
	const failures = collectProblems(host);
	const click = (node) =>
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
	const byText = (selector, text) =>
		[...rootNode.querySelectorAll(selector)].find((n) => n.textContent.trim() === text);
	return { window, rootNode, host, registry, failures, click, byText };
};

test("pick a story, step through it and rewind", async () => {
	const { rootNode, host, failures, click, byText } = start();
	click(byText("li button", "Bool (edit)"));
	await settle();
	const app = rootNode.querySelector("tutuca-app");
	assert.equal(app.getAttribute("app-key"), "JSON/Bool (edit)@0");
	assert.match(app.shadowRoot.textContent, /false/);
	const story = () => host.root.story;
	assert.equal(story().sequence, "toggle");
	assert.equal(story().steps.length, 4);
	click(rootNode.querySelector('[title="Run to end"]'));
	await settle();
	assert.deepEqual(
		story().steps.map((s) => s.status),
		["ok", "ok", "ok", "ok"],
	);
	assert.equal(story().timeline.length, 5);
	// The second timeline entry is the state after the first toggle.
	click(rootNode.querySelectorAll("ol button")[1]);
	await settle();
	assert.equal(story().cursor, 1);
	assert.match(story().stateJson, /"value": true/);
	assert.deepEqual(failures, []);
});

test("groups collapse, a filter shows their matches, and a pick scrolls to the top", async () => {
	const { host, rootNode, click, byText, window, failures } = start();
	const visible = () =>
		[...rootNode.querySelectorAll("aside li button[title]")].map((b) => b.title);
	const json = visible().filter((id) => id.startsWith("JSON/")).length;
	assert.ok(json > 5);
	click(byText("aside li button span.flex-1", "JSON").parentNode);
	await settle();
	assert.equal(visible().filter((id) => id.startsWith("JSON/")).length, 0);
	assert.ok(host.root.collapsed.includes("JSON"));
	const filter = rootNode.querySelector('[aria-label="Filter stories"]');
	filter.value = "JSON/Bool (edit)";
	filter.dispatchEvent(new window.Event("input", { bubbles: true }));
	await settle();
	assert.ok(visible().includes("JSON/Bool (edit)"));
	const main = rootNode.querySelector("[data-story-main]");
	main.scrollTop = 500;
	click(byText("li button", "Bool (edit)"));
	await settle();
	assert.equal(main.scrollTop, 0);
	assert.deepEqual(failures, []);
});

test("Ctrl+click on a group collapses every group, and again expands them", async () => {
	const { host, rootNode, window, byText, failures } = start();
	const ctrlClick = (node) =>
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
	const group = (name) => byText("aside li button span.flex-1", name).parentNode;
	ctrlClick(group("JSON"));
	await settle();
	assert.deepEqual(host.root.collapsed, ["JSON", "Math"]);
	assert.equal(rootNode.querySelectorAll("aside li button[title]").length, 0);
	ctrlClick(group("Math"));
	await settle();
	assert.deepEqual(host.root.collapsed, []);
	assert.deepEqual(failures, []);
});

test("a picked story goes in the URL's hash, which opens it again", async () => {
	const { window, click, byText, failures } = start();
	click(byText("li button", "Bool (edit)"));
	await settle();
	assert.equal(window.location.hash, "#JSON/Bool%20(edit)");
	assert.equal(decodeURIComponent(window.location.hash.slice(1)), "JSON/Bool (edit)");
	assert.deepEqual(failures, []);
});

test("clicks in the story canvas show up in the timeline", async () => {
	const { host, rootNode, click, failures } = start("JSON/Bool (edit)");
	await settle();
	const app = rootNode.querySelector("tutuca-app");
	click(app.shadowRoot.querySelector('[aria-label="boolean value"]'));
	await settle();
	const { timeline } = host.root.story;
	assert.deepEqual(
		timeline.map((e) => e.origin),
		["initial", "user"],
	);
	assert.equal(host.root.story.cursor, 1);
	assert.deepEqual(failures, []);
});

test("send a message from the step form", async () => {
	const { host, rootNode, click, byText, window, failures } = start("Math/Quadratic/Two roots");
	await settle();
	const message = rootNode.querySelector('[aria-label="Message"]');
	message.value = "setCoefficient";
	message.dispatchEvent(new window.Event("change", { bubbles: true }));
	await settle();
	const argsInput = rootNode.querySelector('[aria-label="Arguments as a JSON array"]');
	argsInput.value = '["c", "5"]';
	argsInput.dispatchEvent(new window.Event("input", { bubbles: true }));
	await settle();
	click(byText("button", "Send"));
	await settle();
	const app = rootNode.querySelector("tutuca-app");
	assert.match(app.shadowRoot.textContent, /x2−3x\+5=0/);
	assert.equal(host.root.story.timeline.at(-1).label, 'Quadratic at ·.setCoefficient("c", "5")');
	assert.deepEqual(failures, []);
});

test("the dev tab inspects the story's state, transitions, components and lint", async () => {
	const { host, rootNode, click, byText, failures } = start("JSON/Bool (edit)");
	await settle();
	click(rootNode.querySelector('[title="Step"]'));
	await settle();
	click(byText('[role="tab"]', "Dev"));
	await settle();
	const { dev } = host.root;
	assert.match(dev.state.nodes[0].tokens.map((t) => t.text).join(""), /^‹JsonEditor/);
	assert.ok(dev.transitions.nodes.length > 0);
	assert.ok(dev.specs.nodes.some((n) => n.tokens.some((t) => t.text === "JsonEditor")));
	const stateNode = rootNode.querySelector('[aria-label="Expand"]');
	click(stateNode);
	await settle();
	assert.equal(host.root.dev.state.nodes[0].isOpen, true);
	assert.match(rootNode.textContent, /showText/);
	// Another step keeps the components section, open nodes included, as it is.
	const specs = host.root.dev.specs;
	click(byText('[role="tab"]', "Steps"));
	click(rootNode.querySelector('[title="Step"]'));
	await settle();
	assert.equal(host.root.dev.specs, specs);
	assert.deepEqual(failures, []);
});

test("a stress run from the UI reports its result", async () => {
	const { host, rootNode, click, byText, failures } = start("Math/Quadratic/Two roots");
	await settle();
	click(byText('[role="tab"]', "Stress test"));
	await settle();
	// The panel starts with the story's own stress settings.
	assert.equal(host.root.stress.maxCommands, 10);
	const numRuns = rootNode.querySelector('input[type="number"]');
	numRuns.value = "15";
	numRuns.dispatchEvent(new numRuns.ownerDocument.defaultView.Event("input", { bubbles: true }));
	await settle();
	click(byText("button", "Run stress test"));
	for (let i = 0; i < 50 && host.root.stress.status === "running"; i++) await tick(5);
	await settle();
	const { stress } = host.root;
	assert.equal(stress.status, "passed");
	assert.equal(stress.done, 15);
	assert.deepEqual(failures, []);
});

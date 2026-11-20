// The canvas demo's drawer (components/trail): the canvas's component tree, read while it's
// open, and agents on it that inspect, query and send its components messages, on the live
// canvas, and check component sources where they stand.
import assert from "node:assert/strict";
import test from "node:test";
import { pickName } from "../../components/trail/names.js";
import { start } from "../../demos/canvas/main.js";
import { specOf } from "../../src/tutuca.js";
import { assertClean, mountDemo } from "../helpers.js";

const twelfths = () => {
	let i = 0;
	return () => (i++ % 12) / 12;
};
const withDrawer = () => {
	const random = twelfths();
	const app = mountDemo(start, "default", {
		inferenceAvailable: () => true,
		models: () => [],
		agentName: ([taken]) => pickName(taken, random),
	});
	const document = app.window.document;
	const tree = app.host.trail.tree;
	const drain = () => {
		while (tree.tasks.length > 0) tree.handleTasks();
	};
	const click = (el) => {
		el.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
		drain();
	};
	const $ = (selector) => document.querySelector(selector);
	const rows = () => [...document.querySelectorAll(".trail-drawer .pt-row")];
	const say = async (text) => {
		const prompt = $('.trail-drawer textarea[aria-label="Prompt"]');
		prompt.value = text;
		prompt.dispatchEvent(new app.window.Event("input", { bubbles: true }));
		drain();
		const submit = new app.window.Event("submit", { bubbles: true, cancelable: true });
		$(".trail-drawer form.agent-prompt").dispatchEvent(submit);
		await tree.whenIdle();
		drain();
	};
	const results = () =>
		tree.root.agents[tree.root.current].transcript.messages
			.filter((m) => m.role === "toolResult")
			.map((m) => ({ text: m.content[0].text, isError: m.isError }));
	return { ...app, document, tree, drain, click, $, rows, say, results };
};

test("canvas drawer: closed, it reads nothing; opened, it shows the canvas's tree", async () => {
	const app = withDrawer();
	assert.equal(app.$(".trail-drawer").classList.contains("trail-drawer-open"), false);
	assert.equal(app.rows().length, 0, "not read while closed");
	app.click(app.$(".trail-drawer-toggle"));
	assert.ok(app.$(".trail-drawer").classList.contains("trail-drawer-open"));
	assert.match(app.rows()[0].textContent, /Canvas/);
	assert.ok(app.rows().length > 5, "the canvas's items and what's in them");
	await assertClean(app);
});

test("canvas drawer: an agent on the canvas inspects it, adds a component and checks one", async () => {
	const app = withDrawer();
	app.click(app.$(".trail-drawer-toggle"));
	app.click(app.rows()[0]);
	app.click(app.$(".trail-drawer .trail-add-agent"));
	assert.equal(app.tree.root.agents.length, 1);

	await app.say("/spec {}");
	const spec = JSON.parse(app.results().at(-1).text);
	assert.equal(spec.component, "Canvas");
	assert.ok(spec.makes.includes("ComponentEditor"));

	// Sent to the live canvas: an item more, which the tree shows once it's read again.
	const before = app.state().order.length;
	await app.say('/send {"name": "add_component", "args": ["editor", null, 3000, 40]}');
	assert.match(app.results().at(-1).text, /^Sent\. What it did, in order:/);
	assert.equal(app.state().order.length, before + 1);
	const added = app.state().items[app.state().order.at(-1)];
	assert.equal(specOf(added.content).name, "ComponentEditor");
	app.host.trail.refresh();
	assert.ok(app.rows().some((row) => /ComponentEditor/.test(row.textContent)));

	// A query, read from the canvas as it is: the first its spec lists that takes nothing.
	const query = spec.queries.find((q) => Array.isArray(q.args) && q.args.length === 0).name;
	await app.say(`/query {"name": "${query}", "args": []}`);
	assert.equal(app.results().at(-1).isError, false, app.results().at(-1).text);

	// A source checked where it stands, defining nothing.
	await app.say(
		'/check_component {"source": "export type X = { a: number };\\nexport const X = { defaults: { a: 0 }, on: { f: { run(next) { this.a = 1; } } } };"}',
	);
	assert.match(
		app.results().at(-1).text,
		/^It doesn't check[\s\S]*= help: this is read-only: change next instead/,
	);
	assert.equal(app.host.scope.lookupSpec("X"), null);
	await assertClean(app);
});

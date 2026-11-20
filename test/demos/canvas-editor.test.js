// The canvas's component editor (components/canvas/editor.js) in the canvas demo: by hand, it
// checks a pure-tutuca module, registers it and adds one to the canvas beside it; registered
// again, what's on the canvas moves onto the new definition; a hole lists what was registered.
// Wrapped in an agent, its tools do the same.
import assert from "node:assert/strict";
import test from "node:test";
import { start } from "../../demos/canvas/main.js";
import { agentProblems } from "../../src/meta/index.js";
import { specOf } from "../../src/tutuca.js";
import { assertClean, mountDemo } from "../helpers.js";

const models = [{ provider: "echo", id: "echo", name: "Echo" }];
// The notebook with an editor added at the far right, and what reaches it.
const withEditor = () => {
	const app = mountDemo(start, "default", {
		inferenceAvailable: () => true,
		models: () => models,
	});
	app.host.send("add_component", ["editor", null, 3000, 40], { now: true });
	while (app.host.tasks.length > 0) app.host.handleTasks();
	const key = app.state().order.at(-1);
	const item = () => app.state().items[key];
	const card = () =>
		app.rootNode.querySelectorAll("foreignObject > .canvas-card")[app.state().order.indexOf(key)];
	const inCard = (selector) => card().querySelector(selector);
	const button = (text) =>
		[...card().querySelectorAll("button")].find((b) => b.textContent === text);
	return { ...app, key, item, card, inCard, button };
};
const editorOf = (app) => {
	const content = app.item().content;
	return specOf(content).name === "Agent" ? content.target : content;
};
// A report without its notes (the agent meta each component's definition derives).
const noNotes = (text) => text.replace(/\nnote: .*/g, "");
// The items added after the editor, newest last.
const addedAfter = (app) => app.state().order.slice(app.state().order.indexOf(app.key) + 1);

test("canvas editor: says agent meta an agent can run", () => {
	const app = withEditor();
	assert.equal(specOf(app.item().content).name, "ComponentEditor");
	assert.deepEqual(agentProblems(specOf(app.item().content)), []);
});

test("canvas editor: check, register, add to the canvas, and register again", async () => {
	const app = withEditor();
	app.fire("click", app.button("Check"));
	assert.equal(
		editorOf(app).report,
		"It checks: defines Counter.\nnote: Counter's https://tutuca.dev/meta/agent meta is derived from its definition.",
	);
	assert.equal(editorOf(app).name, "Counter", "named after what it defines");
	assert.equal(app.host.scope.lookupSpec("Counter"), null, "checking registers nothing");

	app.fire("click", app.button("Register"));
	assert.equal(noNotes(editorOf(app).report), "Defined Counter.");
	assert.deepEqual(editorOf(app).defined, ["Counter"]);

	app.fire("click", app.button("Add to canvas"));
	const [added] = addedAfter(app);
	const counter = () => app.state().items[added];
	assert.equal(specOf(counter().content).name, "Counter");
	assert.equal(counter().label, "🧩 Counter");
	assert.equal(counter().x, app.item().x + app.item().width + 24, "beside the editor");
	assert.equal(counter().y, app.item().y);
	assert.match(noNotes(editorOf(app).report), /^Added 🧩 Counter to the canvas, as item /);
	// It works as any component on the canvas.
	const counterCard = app.rootNode.querySelectorAll("foreignObject > .canvas-card")[
		app.state().order.indexOf(added)
	];
	app.fire("click", counterCard.querySelector("button.btn-primary"));
	app.fire("click", counterCard.querySelector("button.btn-primary"));
	assert.equal(counter().content.count, 2);

	// A second one goes below the first.
	app.fire("click", app.button("Add to canvas"));
	const second = app.state().items[addedAfter(app)[1]];
	assert.equal(second.x, counter().x);
	assert.ok(second.y > counter().y);

	// Registered again: what's on the canvas moves onto the new definition, with its state.
	const before = specOf(counter().content);
	const source = editorOf(app)
		.source.replace("count: number }", "count: number; step: number }")
		.replace("count: 0 }", "count: 0, step: 5 }")
		.replace("next.count += 1", "next.count += this.step");
	app.fire("input", app.inCard('textarea[aria-label="Component source"]'), source);
	app.fire("click", app.button("Register"));
	assert.match(noNotes(editorOf(app).report), /^Gave Counter a new definition/);
	assert.notEqual(specOf(counter().content), before);
	assert.equal(counter().content.count, 2);
	assert.equal(counter().content.step, 5);
	app.fire("click", counterCard.querySelector("button.btn-primary"));
	assert.equal(counter().content.count, 7);

	// A module that doesn't check says where and why, and registers nothing.
	app.fire(
		"input",
		app.inCard('textarea[aria-label="Component source"]'),
		source.replace("next.count +=", "this.count +="),
	);
	app.fire("click", app.button("Register"));
	assert.match(noNotes(editorOf(app).report), /^Nothing was defined\.\n1 error, 0 warnings/);
	assert.match(noNotes(editorOf(app).report), /= help: this is read-only: change next instead/);
	assert.equal(specOf(counter().content), app.host.scope.lookupSpec("Counter"));
	await assertClean(app);
});

test("canvas editor: what it registered is a kind, which a hole and the canvas's agent can make", async () => {
	const app = withEditor();
	const kindIds = () => app.state().kinds.map((k) => k.id);
	assert.ok(!kindIds().includes("defined:Counter"));
	app.fire("click", app.button("Register"));
	assert.ok(kindIds().includes("defined:Counter"), "the canvas asked its kinds again");
	// What its agent's add_component makes.
	app.host.send("add_component", ["defined:Counter", null, 3000, 900], { now: true });
	while (app.host.tasks.length > 0) app.host.handleTasks();
	const last = app.state().items[app.state().order.at(-1)];
	assert.equal(specOf(last.content).name, "Counter");
	assert.equal(last.label, "🧩 Counter");
	// What a hole lists, and becomes.
	app.host.send("addHole", [3000, 1400], { now: true });
	while (app.host.tasks.length > 0) app.host.handleTasks();
	const holeCard = () =>
		app.rootNode.querySelectorAll("foreignObject > .canvas-card")[app.state().order.length - 1];
	app.fire("click", holeCard().querySelector('[title="Put a component here"]'));
	app.fire("click", holeCard().querySelector('[data-choice="defined:Counter"]'));
	assert.equal(specOf(app.state().items[app.state().order.at(-1)].content).name, "Counter");
	await assertClean(app);
});

test("canvas editor: wrapped in an agent, its tools edit, check, register and add", async () => {
	const app = withEditor();
	app.fire("click", app.inCard('[title="Wrap in an agent"]'));
	assert.equal(specOf(app.item().content).name, "Agent");
	const say = async (text) => {
		app.fire("input", app.inCard('textarea[aria-label="Prompt"]'), text);
		app.fire("submit", app.inCard("form.agent-prompt"));
		await app.host.whenIdle();
		while (app.host.tasks.length > 0) app.host.handleTasks();
	};
	const lastResult = () =>
		app
			.item()
			.content.transcript.messages.filter((m) => m.role === "toolResult")
			.at(-1);

	await say("/read_source {}");
	assert.match(noNotes(lastResult().content[0].text), /^ {2}1 \| import \{ button/);

	await say('/replace_in_source {"find": "\\"Clicks\\"", "replacement": "\\"Taps\\""}');
	assert.match(editorOf(app).source, /label: "Taps"/);
	// Text that isn't there says so.
	await say('/replace_in_source {"find": "nowhere", "replacement": "x"}');
	assert.equal(lastResult().isError, true);
	assert.match(noNotes(lastResult().content[0].text), /That text isn't in the source/);

	await say(
		'/set_source {"source": "export type X = { a: number };\\nexport const X = { defaults: { a: 0 }, on: { f: { run(next) { this.a = 1; } } } };"}',
	);
	await say("/check {}");
	assert.match(noNotes(lastResult().content[0].text), /error\[immutable-target\]/);
	assert.match(noNotes(lastResult().content[0].text), /--> line 2, column \d+/);

	await say('/replace_in_source {"find": "this.a = 1", "replacement": "next.a = 1"}');
	await say("/check {}");
	assert.match(noNotes(lastResult().content[0].text), /^It checks: defines X\./);
	await say("/register {}");
	assert.equal(noNotes(lastResult().content[0].text), "Defined X.");
	await say('/add_to_canvas {"fields": {"a": 3}}');
	assert.match(noNotes(lastResult().content[0].text), /^Added 🧩 X to the canvas/);
	const added = app.state().items[addedAfter(app).at(-1)];
	assert.equal(specOf(added.content).name, "X");
	assert.equal(added.content.a, 3);
	await assertClean(app);
});

test("canvas editor: a preview is registered in scratch, shown in the editor, and keeps its state", async () => {
	const app = withEditor();
	app.fire("click", app.button("Preview"));
	const ed = () => editorOf(app);
	assert.equal(specOf(ed().preview).name, "Counter");
	assert.equal(app.host.scope.lookupSpec("Counter"), null, "the canvas doesn't see it");
	assert.ok(app.host.scope.children.scratch.specs.Counter);
	assert.match(
		noNotes(ed().report),
		/^Defined Counter in scope scratch\.\nPreviewing Counter: \{"label":"Clicks","count":0\}/,
	);
	assert.equal(ed().name, "Counter");
	// It works inside the editor.
	app.fire("click", app.inCard(".editor-preview button.btn-primary"));
	app.fire("click", app.inCard(".editor-preview button.btn-primary"));
	assert.equal(ed().preview.count, 2);
	// Previewed again: the new definition, the same state.
	const source = ed()
		.source.replace('"Clicks"', '"Taps"')
		.replace("btn-primary", "btn-primary btn-wide");
	app.fire("input", app.inCard('textarea[aria-label="Component source"]'), source);
	app.fire("click", app.button("Preview"));
	assert.equal(ed().preview.count, 2);
	assert.ok(app.inCard(".editor-preview button.btn-wide"), "with the new view");
	assert.match(noNotes(ed().report), /Gave Counter in scope scratch a new definition/);

	// The scopes panel lists scratch, with the preview in use; scratch can't go while it's there.
	assert.deepEqual(ed().scopes, [
		{ name: "scratch", path: "scratch", components: [{ name: "Counter", live: 1 }] },
	]);
	const rows = () => [...app.card().querySelectorAll(".editor-scopes li")];
	assert.deepEqual(
		rows().map((r) => r.querySelector("span").textContent),
		["scratch", "Counter · 1 in use"],
	);
	app.fire("click", rows()[0].querySelector('[title="Remove this scope"]'));
	assert.match(
		noNotes(ed().report),
		/^Can't remove scope scratch: it's in use at\n {2}\.items\.[\w-]+\.content\.preview\nRemove those first\./,
	);
	assert.ok(app.host.scope.children.scratch);

	// Added to the canvas from scratch, it's a canvas item made in scratch.
	app.fire("click", rows()[1].querySelector('[title="Add one to the canvas"]'));
	const added = app.state().items[addedAfter(app).at(-1)];
	assert.equal(specOf(added.content), app.host.scope.children.scratch.specs.Counter);
	assert.equal(rows()[1].querySelector("span").textContent, "Counter · 2 in use");

	// Discarded and taken off the canvas, Counter and then scratch can go.
	app.fire("click", app.inCard('.editor-preview [type="button"]'));
	assert.equal(ed().preview, null);
	app.host.send("remove", [], { to: { item: "items", key: addedAfter(app).at(-1) }, now: true });
	while (app.host.tasks.length > 0) app.host.handleTasks();
	app.fire("click", rows()[1].querySelector('[title="Remove it from its scope"]'));
	assert.equal(noNotes(ed().report), "Removed Counter from scratch.");
	app.fire("click", rows()[0].querySelector('[title="Remove this scope"]'));
	assert.equal(noNotes(ed().report), "Removed scope scratch.");
	assert.equal(app.host.scope.children.scratch, undefined);
	assert.deepEqual(ed().scopes, []);
	await assertClean(app);
});

test("canvas editor: register in a scope below, then add one from it by its path", async () => {
	const app = withEditor();
	app.fire("input", app.inCard('input[aria-label="Register in scope"]'), "lab");
	app.fire("click", app.button("Register"));
	assert.equal(noNotes(editorOf(app).report), "Defined Counter in scope lab.");
	assert.equal(editorOf(app).name, "lab/Counter");
	assert.deepEqual(editorOf(app).defined, [], "not the canvas's");
	assert.ok(!app.state().kinds.some((k) => k.id === "defined:Counter"), "nor a kind");
	app.fire("click", app.button("Add to canvas"));
	const added = app.state().items[addedAfter(app).at(-1)];
	assert.equal(specOf(added.content), app.host.scope.children.lab.specs.Counter);
	assert.equal(added.label, "🧩 lab/Counter");
	await assertClean(app);
});

test("canvas editor: its agent previews, lists, unregisters and removes scopes", async () => {
	const app = withEditor();
	app.fire("click", app.inCard('[title="Wrap in an agent"]'));
	const say = async (text) => {
		app.fire("input", app.inCard('textarea[aria-label="Prompt"]'), text);
		app.fire("submit", app.inCard("form.agent-prompt"));
		await app.host.whenIdle();
		while (app.host.tasks.length > 0) app.host.handleTasks();
	};
	const lastResult = () =>
		app
			.item()
			.content.transcript.messages.filter((m) => m.role === "toolResult")
			.at(-1);
	await say("/preview {}");
	assert.match(
		noNotes(lastResult().content[0].text),
		/Previewing Counter: \{"label":"Clicks","count":0\}/,
	);
	await say("/list_scopes {}");
	assert.equal(noNotes(lastResult().content[0].text), "scratch: Counter (1 in use)");
	await say('/remove_scope {"scope": "scratch"}');
	assert.match(
		noNotes(lastResult().content[0].text),
		/^Can't remove scope scratch: it's in use at/,
	);
	await say("/discard_preview {}");
	await say('/unregister {"name": "Counter", "scope": "scratch"}');
	assert.equal(noNotes(lastResult().content[0].text), "Removed Counter from scratch.");
	await say('/remove_scope {"scope": "scratch"}');
	assert.equal(noNotes(lastResult().content[0].text), "Removed scope scratch.");
	await say('/register {"scope": "lab"}');
	assert.equal(noNotes(lastResult().content[0].text), "Defined Counter in scope lab.");
	await say("/add_to_canvas {}");
	assert.match(noNotes(lastResult().content[0].text), /^Added 🧩 lab\/Counter to the canvas/);
	await assertClean(app);
});

test("canvas editor: what it adds to the canvas is wrapped in an agent, with tools its definition derives", async () => {
	const app = withEditor();
	app.fire("click", app.button("Register"));
	app.fire("click", app.button("Add to canvas"));
	const key = addedAfter(app).at(-1);
	const card = () =>
		app.rootNode.querySelectorAll("foreignObject > .canvas-card")[app.state().order.indexOf(key)];
	const counter = () => app.state().items[key];
	app.fire("click", card().querySelector('[title="Wrap in an agent"]'));
	assert.equal(specOf(counter().content).name, "Agent");
	assert.equal(specOf(counter().content.target).name, "Counter");
	assert.deepEqual(
		counter().content.tools.map((tool) => tool.name),
		["inc"],
	);
	app.fire("input", card().querySelector('textarea[aria-label="Prompt"]'), "/inc {}");
	app.fire("submit", card().querySelector("form.agent-prompt"));
	await app.host.whenIdle();
	while (app.host.tasks.length > 0) app.host.handleTasks();
	assert.equal(counter().content.target.count, 1);
	const results = counter().content.transcript.messages.filter((m) => m.role === "toolResult");
	assert.equal(results.at(-1).content[0].text, '{"label":"Clicks","count":1}');
	await assertClean(app);
});

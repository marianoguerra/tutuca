// The components the canvas bundles offer that say agent meta: what they say is sound (lint
// finds no agent-meta problem), what each kind makes has a summary and tools, and their tools
// do what they say, run as an agent runs them (planToolCall).
import assert from "node:assert/strict";
import test from "node:test";
import { drawingComponents } from "../../components/drawing/index.js";
import { HTTP_KINDS, httpComponents } from "../../components/http/index.js";
import { LLM_KINDS, llmComponents } from "../../components/llm/index.js";
import { MUSIC_KINDS, musicComponents } from "../../components/music/index.js";
import { sampleApp } from "../../components/todo/fixtures.js";
import { todoComponents } from "../../components/todo/index.js";
import { BUNDLES } from "../../demos/canvas/bundles.js";
import { notesComponents } from "../../demos/notes/notes.js";
import { lint } from "../../src/lint/index.js";
import {
	agentMetaSchemas,
	agentProblems,
	hasAgentMeta,
	planToolCall,
	Scope,
	summaryOf,
	systemPrompt,
	toolsFor,
} from "../../src/tutuca.js";
import { scopeWith } from "../helpers.js";

let calls = 0;
// Runs the tool name with args on c: { done: { text, isError }, next } or { send, result }.
const call = (c, name, args = {}) =>
	planToolCall(c, { id: `call-${++calls}`, name, arguments: args });
// c after the tool, which must run here and succeed.
const ran = (c, name, args) => {
	const plan = call(c, name, args);
	assert.ok(plan.done, `${name} runs here`);
	assert.equal(plan.done.isError, false, plan.done.text);
	return plan.next;
};
const failsWith = (c, name, args, pattern) => {
	const plan = call(c, name, args);
	assert.equal(plan.done?.isError, true, `${name} fails`);
	assert.match(plan.done.text, pattern);
};

for (const [id, bundle] of Object.entries(BUNDLES)) {
	test(`${id} bundle: what says agent meta is sound, and each kind has a summary and tools`, () => {
		const specs = Object.values(bundle.components).filter(hasAgentMeta);
		for (const spec of specs) assert.deepEqual(agentProblems(spec), [], spec.name);
		const issues = lint(specs).filter((i) => i.code === "agent-meta");
		assert.deepEqual(issues, []);
		const scope = new Scope(() => {});
		scope.registerMetaSchemas({ ...bundle.metaSchemas, ...agentMetaSchemas });
		scope.register(bundle.components);
		let uuids = 0;
		const read = { scope, now: () => Date.UTC(2026, 0, 1), uuid: () => `u-${++uuids}` };
		for (const kind of bundle.askHandlers.componentKinds([], read)) {
			const choice = kind.choices[0]?.id ?? null;
			const { content } = bundle.askHandlers.makeComponent([kind.id, choice], read);
			if (!hasAgentMeta(content)) continue;
			const summary = summaryOf(content);
			assert.ok(summary.length > 0 && !summary.startsWith("(no summary"), `${kind.id}: ${summary}`);
			assert.match(systemPrompt(content), /Now: /);
			assert.ok(toolsFor(content).length > 0, kind.id);
		}
	});
}

test("notes: added, ticked off and removed by index", () => {
	const C = scopeWith(notesComponents).components;
	let notes = C.Notes({ title: "Groceries" });
	notes = ran(notes, "add_notes", { texts: ["milk", "eggs"] });
	notes = ran(notes, "set_done", { index: 1, done: true });
	assert.match(summaryOf(notes), /0\. \[ \] milk\n1\. \[x\] eggs/);
	failsWith(notes, "remove_note", { index: 5 }, /no note 5/);
	notes = ran(notes, "remove_note", { index: 0 });
	assert.deepEqual(
		notes.notes.map((n) => n.text),
		["eggs"],
	);
});

test("todos: tasks by id, at any depth; adding one goes through the quick add", () => {
	const C = scopeWith(todoComponents).components;
	let app = sampleApp(C);
	const task = app.tasks.find((tk) => tk.subtasks.length > 0) ?? app.tasks[0];
	assert.match(summaryOf(app), new RegExp(task.id));
	app = ran(app, "complete_task", { id: task.id });
	assert.equal(app.tasks.find((tk) => tk.id === task.id).isCompleted, true);
	app = ran(app, "set_priority", { id: task.id, priority: 1 });
	app = ran(app, "move_task", { id: task.id, project: app.projects.at(-1).name.toUpperCase() });
	assert.equal(app.tasks.find((tk) => tk.id === task.id).projectId, app.projects.at(-1).id);
	failsWith(app, "move_task", { id: task.id, project: "Nowhere" }, /no project Nowhere/);
	failsWith(app, "rename_task", { id: "nope", title: "x" }, /no task nope/);
	if (task.subtasks.length > 0) {
		const sub = task.subtasks[0].id;
		app = ran(app, "rename_task", { id: sub, title: "Renamed deep" });
		assert.match(summaryOf(app), /Renamed deep/);
		app = ran(app, "remove_task", { id: sub });
		assert.doesNotMatch(summaryOf(app), new RegExp(sub));
	}
	app = ran(app, "set_labels", { id: task.id, labels: ["urgent"] });
	assert.ok(app.labels.includes("urgent"));
	assert.deepEqual(call(app, "add_task", { text: "Call the bank tomorrow p2" }).send, {
		name: "addTask",
		args: ["Call the bank tomorrow p2"],
	});
});

test("drawing: shapes made by message, then moved, styled, layered and removed by id", () => {
	const C = scopeWith(drawingComponents).components;
	const rect = (id, x) =>
		C.Rect({ id, x0: x, y0: 0, x1: x + 10, y1: 10, fill: "none", stroke: "#000000", width: 2 });
	let d = C.Drawing({ shapes: [rect("a", 0), rect("b", 20)] });
	const add = ["rect", 0, 0, 50, 50, "#ff0000", "none", 2];
	const [kind, x0, y0, x1, y1, fill, stroke, width] = add;
	assert.equal(
		call(d, "add_shape", { kind, x0, y0, x1, y1, fill, stroke, width }).send.name,
		"add_shape",
	);
	failsWith(d, "style_shape", { id: "a", fill: "red", stroke: "none", width: 2 }, /fill isn't/);
	d = ran(d, "style_shape", { id: "a", fill: "#ff0000", stroke: "none", width: 4 });
	d = ran(d, "move_shape", { id: "a", dx: 5, dy: 5 });
	d = ran(d, "layer_shape", { id: "a", to: "front" });
	assert.deepEqual(
		d.shapes.map((s) => s.id),
		["b", "a"],
	);
	assert.match(summaryOf(d), /a rect at \(5, 5\), 10×10, fill #ff0000/);
	d = ran(d, "remove_shape", { id: "b" });
	d = ran(d, "undo");
	assert.equal(d.shapes.length, 2, "undone");
});

test("http: headers and bodies by name, operations' responses by status, exchanges fixed", () => {
	const C = scopeWith(httpComponents).components;
	let req = HTTP_KINDS.request.make(C, {});
	req = ran(req, "set_header", { name: "ACCEPT", value: "text/plain" });
	assert.equal(req.headers.filter((h) => h.name.toLowerCase() === "accept").length, 1);
	req = ran(req, "set_body", { kind: "json", value: { a: 1 } });
	assert.match(summaryOf(req), /"a": ?1/);
	failsWith(req, "remove_header", { name: "X-Nope" }, /no X-Nope header/);
	let op = HTTP_KINDS.operation.make(C, {});
	op = ran(op, "set_response", { status: "404", description: "No such task", schema: null });
	assert.ok(op.responses.some((r) => r.status === "404"));
	op = ran(op, "remove_response", { status: "404" });
	failsWith(op, "remove_response", { status: "418" }, /no 418 response/);
	let ex = HTTP_KINDS.exchange.make(C, {});
	assert.match(summaryOf(ex), /✓/);
	ex = ran(ex, "set_response", { response: { status: 500, headers: [] } });
	assert.match(summaryOf(ex), /✗/);
	assert.ok(ex.failures > 0);
});

test("music: chords, keys and marks by note name", () => {
	const C = scopeWith(musicComponents).components;
	let chords = MUSIC_KINDS.chords.make(C, {});
	chords = ran(chords, "set_chord", { root: "Eb", kind: "min7", inversion: 2 });
	assert.match(summaryOf(chords), /^E♭m7\/B♭/);
	assert.deepEqual(chords.guitar.marked, [10, 1, 3, 6], "on the neck too, by pitch class");
	failsWith(chords, "set_chord", { root: "C", kind: "major", inversion: 3 }, /inversions 0 to 2/);
	failsWith(chords, "set_chord", { root: "H", kind: "major", inversion: 0 }, /root isn't/);
	let circle = MUSIC_KINDS.circle.make(C, {});
	circle = ran(circle, "set_key", { tonic: "F#", mode: "minor" });
	assert.equal(circle.keyName, "F♯ minor");
	let intervals = MUSIC_KINDS.intervals.make(C, {});
	intervals = ran(intervals, "set_intervals", { root: "D", intervals: ["m3", "P5"] });
	assert.match(summaryOf(intervals), /D minor/);
	assert.deepEqual(intervals.guitar.labels, ["D", "F", "A"]);
	let scales = MUSIC_KINDS.scales.make(C, {});
	scales = ran(scales, "set_scale", { root: "F#", kind: "harmonicMinor" });
	assert.match(summaryOf(scales), /^F♯ harmonic minor/);
	assert.deepEqual(scales.guitar.labels, ["F♯", "G♯", "A", "B", "C♯", "D", "E♯"]);
	failsWith(scales, "set_scale", { root: "C", kind: "bebop" }, /kind/);
	scales = ran(scales, "set_instrument", { instrument: "guitar" });
	assert.equal(scales.instrument, "guitar");
	let keys = MUSIC_KINDS.piano.make(C, {});
	keys = ran(keys, "set_marks", { notes: ["C4", "E4", "G4"], color: "sky" });
	assert.deepEqual(keys.marked, [60, 64, 67]);
	keys = ran(keys, "add_marks", { notes: ["Bb4"], color: "amber" });
	assert.deepEqual(keys.marked, [60, 64, 67, 70]);
	let neck = MUSIC_KINDS.guitar.make(C, {});
	neck = ran(neck, "set_marks", { notes: ["A", "C", "E"], color: "green" });
	assert.deepEqual(neck.marked, [9, 0, 4]);
	neck = ran(neck, "clear_marks");
	assert.deepEqual(neck.marked, []);
});

test("llm: a schema checks values, a request gets tools and messages", () => {
	const C = scopeWith(llmComponents).components;
	const schema = LLM_KINDS.jsonSchema.make(C, {});
	const checked = call(schema, "check_value", { value: 42 });
	assert.equal(checked.done.isError, false);
	assert.notEqual(checked.done.text, "[]", "42 isn't an object");
	let req = LLM_KINDS.request.make(C, {});
	req = ran(req, "set_tool", {
		name: "get_time",
		description: "The time.",
		parameters: { type: "object" },
	});
	req = ran(req, "add_message", { role: "user", text: "And the time?" });
	assert.match(summaryOf(req), /get_time/);
	req = ran(req, "remove_tool", { name: "get_time" });
	assert.doesNotMatch(summaryOf(req), /get_time/);
	failsWith(req, "remove_tool", { name: "get_time" }, /no tool get_time/);
});

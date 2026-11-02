import assert from "node:assert/strict";
import test from "node:test";
import { decodeMessage, encodeMessage } from "../../components/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "tq-lab";

test("the notes sample matches tq-lab, its empty sample decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "notes"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const root = registry.open(agent, registry.sample(agent));
	assert.match(root.summary, /^0 queries, 0 samples/);
});

test("decode then encode gives back the same bytes for every sample", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const { id } of agent.samples) {
		const msg = registry.sample(agent, id);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
});

test("samples are shown as indented tdata JSON that decodes to the same message", async () => {
	const { registry, agent } = await loadAgent(ID);
	const msg = registry.sample(agent, "notes");
	const root = registry.open(agent, msg);
	for (const [i, x] of root.samples.items.entries()) {
		assert.equal(
			encodeMessage(decodeMessage(x.text)),
			encodeMessage(msg.messages[4 + i].messages[0]),
		);
	}
	assert.match(root.samples.items[0].text, /"pin": \["#","app\/point",\{"x":1,"y":2\.5\}\]/);
});

test("the grid checks expectations, and the focused query's solutions show", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "notes");
	// q2 finds the note by lin in s2, which q1 can't see since s2 is a batch.
	assert.equal(d.state.headline, "6 pass · 0 fail · 6 unset");
	d.send(ROOT, "set_query", ["q1", '.. ~ {kind: "note"}']);
	d.drain();
	assert.equal(d.state.headline, "5 pass · 1 fail · 6 unset");
	d.send(ROOT, "focus", ["q4"]);
	d.drain();
	const s3 = d.state.results[2];
	assert.equal(s3.label, "matches");
	assert.deepEqual(
		s3.solutions[0].bindings.map((b) => [b.name, b.value]),
		[
			["$cls", '"lead"'],
			["$first", '"Hello "'],
			["$rest", '[[["node","b",{},[["world"]]]]]'],
		],
	);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0].data.get("query"), '.. ~ {kind: "note"}');
	assert.equal(out.messages[1], message.messages[1]);
	assert.equal(out.messages[6], message.messages[6]);
});

test("an agent opens empty and grows from there", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "empty");
	d.send(ROOT, "add_query", [".data.n > 1"]);
	d.send(ROOT, "add_sample", ['{"id":"a","kind":"x","data":{"n":2}}']);
	d.send(ROOT, "add_sample", ['{"id":"b","kind":"x","data":{"n":1.5}}']);
	d.send(ROOT, "add_sample", ["not tdata"]);
	d.drain();
	d.send(ROOT, "cycle_cell", [3]); // s1 × q1: none → match
	d.send(ROOT, "set_expectation", ["s2", "q1", "no-match"]);
	d.drain();
	assert.equal(d.state.headline, "1 pass · 1 fail · 0 unset");
	assert.match(d.state.samples.items[2].error, /./);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, registry.sample(agent));
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
	assert.equal(
		encodeMessage(out.messages[1]),
		'{"id":"s1","kind":"tdata-sample","messages":[{"id":"a","kind":"x","data":{"n":2}}],"meta":{"https://tutuca.dev/d/expect":{"q1":"match"}}}',
	);
	assert.deepEqual(out.messages[3].messages, []); // a sample that doesn't decode holds nothing
});

test("tools run through the tool runner", async () => {
	const { call, env, text } = await toolRunner(ID, "notes");
	const r = await call("set_query", { id: "q3", query: '.. ~ #"app/point" {y: $y}' });
	assert.equal(r.isError, false);
	assert.equal(JSON.parse(text(r))[0].cells[2].matched, true);
	const bad = await call("set_query", { id: "q9", query: "." });
	assert.equal(bad.isError, true);
	assert.match(text(bad), /precondition/);
	const run = JSON.parse(text(await call("run", { query: "q2", sample: "s2" })));
	assert.equal(run.matched, true);
	assert.deepEqual(run.solutions[0].bindings, { $title: '"Retro"', $who: '"lin"' });
	const tried = JSON.parse(text(await call("run", { query: ".messages | length", sample: "s2" })));
	assert.equal(tried.solutions[0].value, "2");
	const parseError = await call("run", { query: ".a |", sample: "s1" });
	assert.equal(parseError.isError, true);
	assert.match(text(parseError), /line 1, col/);
	const shape = JSON.parse(text(await call("sample_shape", { sample: "s1" }))).paths;
	assert.ok(shape.includes('.data.pin: typed "app/point"'));
	assert.ok(shape.includes(".data.pin.value.y: double"));
	assert.ok(shape.includes(".data.tags[]: string"));
	assert.ok(shape.includes('.meta."https://tutuca.dev/d/trace".at: instant'));
	assert.equal((await call("sample_shape", { sample: "s9" })).isError, true);
	await call("set_expectation", { sample: "s3", query: "q1", outcome: "no-match" });
	assert.equal(env.root().headline, "7 pass · 0 fail · 5 unset");
});

test("samples are edited in JsonViews, and solutions with bindings show in JsonViews", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "notes");
	d.send(ROOT, "focus", ["q4"]);
	d.drain();
	assert.deepEqual(
		d.state.views.map((v) => v.label),
		["s1 · no match · 0 solutions", "s2 · no match · 0 solutions", "s3 · matches · 1 solution"],
	);
	const s3 = JSON.parse(d.state.views[2].text);
	assert.deepEqual(s3["1"].bindings.$cls, "lead");
	assert.equal(d.state.views[2].isJson, true);
	d.send(new Selector().field("samples").item("items", 0).field("view"), "edit", [
		'{"id":"n","kind":"note","data":{"n":1.0}}',
	]);
	d.drain();
	assert.equal(d.state.samples.items[0].text, '{"id":"n","kind":"note","data":{"n":1.0}}');
	d.send(new Selector().field("samples").item("items", 1).field("view"), "edit", ["[1]"]);
	d.drain();
	assert.match(d.state.samples.items[1].tdataError, /./);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(
		encodeMessage(out.messages[4].messages[0]),
		'{"id":"n","kind":"note","data":{"n":1.0}}',
	);
});

test("a set_query call shows the query and how many samples it matches", async () => {
	const { call, agent } = await toolRunner(ID, "notes");
	const args = { id: "q1", query: '.. ~ {kind: "note"}' };
	const result = await call("set_query", args);
	assert.equal(result.isError, false);
	const view = agent.scope.make("SetQueryCall", {
		call: { type: "toolCall", id: "c1", name: "set_query", arguments: args },
		result,
		kind: "message",
	});
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_queryq1 = \.\. ~ \{kind: "note"\}matches 2\/3 · 1 pass · 1 fail · 1 unset/,
	);
	assert.equal(view.lines[1].text, "s2: matches (expected no-match)");
	assert.deepEqual(d.problems, []);
});

test("tq-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("queries and samples reorder by tool and by drag; encode keeps the order", async () => {
	const { call, env, message, registry, agent } = await toolRunner(ID, "notes");
	assert.equal((await call("reorder_queries", { id: "q4", index: 0 })).isError, false);
	assert.equal((await call("reorder_samples", { id: "s1", index: 2 })).isError, false);
	assert.equal((await call("reorder_queries", { id: "q9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["q4", "q1", "q2", "q3", "s2", "s3", "s1"]);
	assert.deepEqual(
		env.root().grid.map((row) => [row.sample, row.cells.map((c) => c.query).join()]),
		[
			["s2", "q4,q1,q2,q3"],
			["s3", "q4,q1,q2,q3"],
			["s1", "q4,q1,q2,q3"],
		],
	);
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="samples"]');
	dispatchDrag(handles()[2], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["q1", "q2", "q3", "q4", "s3", "s1", "s2"]);
	d.send(ROOT, "remove_queries_at", [3]);
	d.send(ROOT, "add_samples", []);
	assert.deepEqual(d.state.sampleById("s3").expect, {});
	assert.deepEqual(
		d.state.samples.items.map((x) => x.id),
		["s3", "s1", "s2", "s4"],
	);
	assert.deepEqual(d.problems, []);
});

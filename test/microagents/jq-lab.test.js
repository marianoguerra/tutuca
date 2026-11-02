import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../components/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "jq-lab";

test("the orders sample matches jq-lab, its empty sample decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "orders"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const root = registry.open(agent, registry.sample(agent));
	assert.equal(root.filters.items.length, 0);
	assert.match(root.summary, /^0 filters, 0 inputs/);
});

test("decode then encode gives back the same bytes for every sample", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const { id } of agent.samples) {
		const msg = registry.sample(agent, id);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
});

test("the grid runs every filter on every input and checks expectations", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "orders");
	// f2 on i2 gives null (add of []), but 0 is expected.
	assert.equal(d.state.headline, "1 pass · 1 fail · 2 unset · 0 errors");
	d.send(ROOT, "set_filter", ["f2", ".orders | map(.total) | add // 0"]);
	d.drain();
	assert.equal(d.state.headline, "2 pass · 0 fail · 2 unset · 0 errors");
	assert.deepEqual(d.state.outputs[1].cells[0].outputs, [49.5]);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[1].data.get("filter"), ".orders | map(.total) | add // 0");
	assert.equal(out.messages[0], message.messages[0]); // untouched parts stay the same objects
	assert.equal(out.messages[5], message.messages[5]);
});

test("errors show on the filter and in the cells", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "orders");
	d.send(ROOT, "set_filter", ["f1", ".orders[] |"]);
	d.send(ROOT, "add_filter", [".customer.name"]);
	d.drain();
	assert.match(d.state.filters.items[0].error, /syntax error/);
	assert.equal(d.state.outputs[0].cells[0].status, "fail");
	assert.equal(d.state.outputs[2].cells[0].status, "error");
	assert.match(d.state.outputs[2].cells[0].error, /Cannot index string/);
	assert.deepEqual(d.problems, []);
});

test("an agent opens empty and grows from there", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "empty");
	d.send(ROOT, "add_filter", [".a[]"]);
	d.send(ROOT, "add_input", [{ a: [1, 2] }]);
	d.drain();
	d.send(ROOT, "set_expected", ["f1", "i1", [1, 2]]);
	d.drain();
	assert.equal(d.state.headline, "1 pass · 0 fail · 0 unset · 0 errors");
	d.send(ROOT, "toggle_cell", [3]); // the f1 × i1 cell clears its expectation
	d.drain();
	assert.equal(d.state.expected.length, 0);
	d.send(ROOT, "toggle_cell", [3]); // and pins the outputs again
	d.drain();
	assert.deepEqual(d.state.expected[0].outputs, [1, 2]);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, registry.sample(agent));
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
	assert.equal(
		encodeMessage(out),
		'{"id":"jq-lab","kind":"jq-lab","messages":[{"id":"f1","kind":"jq","data":{"filter":".a[]"}},{"id":"i1","kind":"json","data":{"a":[[1,2]]}},{"id":"e1","kind":"jq-expected","data":{"filter":"f1","input":"i1","outputs":[[1,2]]}}]}',
	);
});

test("tools run through the tool runner", async () => {
	const { call, env, text } = await toolRunner(ID, "orders");
	const r = await call("set_filter", { id: "f2", filter: "[.orders[].total] | add // 0" });
	assert.equal(r.isError, false);
	assert.equal(JSON.parse(text(r))[1].cells[1].status, "pass");
	const bad = await call("set_filter", { id: "f9", filter: "." });
	assert.equal(bad.isError, true);
	assert.match(text(bad), /precondition/);
	const exp = await call("set_expected", { filter: "f2", input: "i1", outputs: [49.5] });
	assert.equal(JSON.parse(text(exp))[1].cells[0].status, "pass");
	assert.match(env.root().headline, /^3 pass · 0 fail/);
	assert.equal(
		JSON.parse(text(await call("input_shape", { input: "i1" }))).shape,
		"{customer: string, orders: [{id: string, status: string, total: number}]}",
	);
	assert.deepEqual(
		JSON.parse(text(await call("get_input", { input: "i1", pointer: "/orders/1/id" }))),
		{
			value: "o2",
		},
	);
	assert.equal((await call("get_input", { input: "i1", pointer: "/nope" })).isError, true);
	assert.equal((await call("input_shape", { input: "i9" })).isError, true);
	assert.equal((await call("clear_expected", { filter: "f1", input: "i2" })).isError, true);
});

test("inputs are editable JsonViews, and the focused filter's outputs show in JsonViews", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "orders");
	assert.deepEqual(
		d.state.views.map((v) => v.label),
		["i1 outputs", "i1 expected", "i2 outputs"],
	);
	assert.deepEqual(JSON.parse(d.state.views[0].text), [["o1", "o3"]]);
	assert.equal(d.state.inputs.items[0].editable, true);
	d.send(new Selector().field("inputs").item("items", 1), "edit", ['{"orders": [{"total": 2}]}']);
	d.send(ROOT, "focus", ["f2"]);
	d.drain();
	assert.equal(d.state.inputs.items[1].text, '{"orders": [{"total": 2}]}');
	assert.deepEqual(
		d.state.views.map((v) => [v.label, v.text]),
		[
			["i1 outputs", "[\n  49.5\n]"],
			["i2 outputs", "[\n  2\n]"],
			["i2 expected", "[\n  0\n]"],
		],
	);
	assert.equal(d.state.outputs[1].cells[1].status, "fail");
	assert.deepEqual(d.problems, []);
});

test("a set_filter call shows the filter and how its row fares", async () => {
	const { call, agent } = await toolRunner(ID, "orders");
	const args = { id: "f2", filter: ".orders | map(.total) | add // 0" };
	const result = await call("set_filter", args);
	assert.equal(result.isError, false);
	const view = agent.scope.make("SetFilterCall", {
		call: { type: "toolCall", id: "c1", name: "set_filter", arguments: args },
		result,
		kind: "message",
	});
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_filterf2 = \.orders \| map\(\.total\) \| add \/\/ 01 pass · 0 fail · 1 unset/,
	);
	assert.deepEqual(
		view.lines.map((l) => l.text),
		["i1 (none): [49.5]", "i2 (pass): [0]"],
	);
	assert.deepEqual(d.problems, []);
});

test("jq-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("filters and inputs reorder by tool and by drag; encode keeps the order", async () => {
	const { call, env, message, registry, agent } = await toolRunner(ID, "orders");
	assert.equal((await call("reorder_filters", { id: "f2", index: 0 })).isError, false);
	assert.equal((await call("reorder_inputs", { id: "i2", index: 0 })).isError, false);
	assert.equal((await call("reorder_inputs", { id: "i9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["f2", "f1", "i2", "i1", "e1", "e2"]);
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="inputs"]');
	dispatchDrag(handles()[1], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["f1", "f2", "i2", "i1", "e1", "e2"]);
	assert.deepEqual(
		d.state.views.map((v) => v.label),
		["i2 outputs", "i1 outputs", "i1 expected"],
	);
	d.send(ROOT, "remove_filters_at", [0]);
	d.send(ROOT, "add_filters", []);
	assert.deepEqual(
		d.state.filters.items.map((f) => [f.id, f.filter]),
		[
			["f2", ".orders | map(.total) | add"],
			["f3", "."],
		],
	);
	assert.deepEqual(
		d.state.expected.map((e) => e.id),
		["e2"],
	);
	assert.deepEqual(d.problems, []);
});

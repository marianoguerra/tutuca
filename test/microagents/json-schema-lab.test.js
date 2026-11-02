import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "json-schema-lab";

test("the user sample matches json-schema-lab and its empty sample decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "user"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const { d } = drive(registry, agent, "empty");
	assert.equal(d.state.examples.items.length, 0);
	assert.equal(d.state.headline, "0 pass · 0 fail");
});

test("decode then encode gives back the same bytes for every sample", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const s of agent.samples) {
		const root = registry.open(agent, s.message);
		assert.equal(encodeMessage(registry.encode(agent, root, s.message)), encodeMessage(s.message));
	}
});

test("the results show which expectations hold, and edits change only their part", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "user");
	assert.equal(d.state.headline, "3 pass · 1 fail");
	assert.deepEqual(
		d.state.errors_for("e4").errors.map((e) => e.keyword),
		["additionalProperties"],
	);
	d.send(ROOT, "patch_schema", ["/properties/nickname", { type: "string" }]);
	d.drain();
	assert.equal(d.state.headline, "4 pass · 0 fail");
	d.send(ROOT, "set_expectation", ["e1", "fail"]);
	d.drain();
	assert.equal(d.state.headline, "3 pass · 1 fail");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	const nickname = out.messages[0].data.get("properties").get("nickname");
	assert.equal(nickname.get("type"), "string");
	assert.equal(out.messages[1].meta.get("https://tutuca.dev/d/expect").get("outcome"), "fail");
	assert.equal(out.messages[2], message.messages[2]); // untouched parts stay the same objects
	assert.equal(out.messages[4].meta.get("x/notes").get("why"), "users may have a nickname");
});

test("an empty lab grows into one that matches its query", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "empty");
	d.send(ROOT, "set_schema", [{ type: "integer", minimum: 0 }]);
	d.send(ROOT, "add_example", [3, "pass"]);
	d.send(ROOT, "add_example", [-1, "fail"]);
	d.send(ROOT, "add_examples", []);
	d.drain();
	d.send(ROOT, "set_example_text", ["e3", "1.5"]);
	d.drain();
	assert.equal(d.state.headline, "2 pass · 1 fail");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
	assert.deepEqual(
		out.messages.map((m) => m.kind),
		["json-schema", "json-example", "json-example", "json-example"],
	);
});

test("the tools edit the schema and report errors", async () => {
	const { call, text } = await toolRunner(ID, "user");
	const v = JSON.parse(text(await call("validation")));
	assert.deepEqual(
		v.examples.map((x) => x.status),
		["pass", "pass", "pass", "fail"],
	);
	const r = await call("patch_schema", { pointer: "/additionalProperties", value: true });
	assert.equal(r.isError, false);
	assert.ok(JSON.parse(text(r)).examples.every((x) => x.status === "pass"));
	assert.equal((await call("set_example", { id: "e9", value: {} })).isError, true);
	assert.equal((await call("patch_schema", { pointer: "/nope/x", value: 1 })).isError, true);
	assert.equal((await call("errors_for", { id: "e9" })).isError, true);
	assert.match(
		text(await call("add_example", { value: { id: 5 }, outcome: "fail" })),
		/5 examples/,
	);
	assert.match(text(await call("errors_for", { id: "e5" })), /must have required property/);
	assert.equal((await call("remove_example", { id: "e1" })).isError, false);
});

test("a schema that doesn't compile says why", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "user");
	d.send(ROOT, "set_schema", [{ type: "wat" }]);
	d.drain();
	assert.match(d.state.schemaError, /invalid/);
	assert.equal(d.state.counts.invalid, 4);
	assert.deepEqual(d.problems, []);
});

test("json-schema-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("the schema and the examples are edited in JsonViews, which keep the root's text", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "user");
	assert.equal(d.state.schemaView.editable, true);
	assert.equal(d.state.examples.items[0].view.text, d.state.examples.items[0].text);
	d.send(new Selector().field("examples").item("items", 1).field("view"), "edit", [
		'{"id":2,"name":"G","email":"g@x.io"}',
	]);
	assert.equal(d.state.examples.items[1].text, '{"id":2,"name":"G","email":"g@x.io"}');
	assert.equal(d.state.headline, "2 pass · 2 fail");
	d.send(ROOT, "patch_schema", ["/minProperties", 1]);
	assert.equal(d.state.schemaView.text, d.state.schemaText);
	assert.match(d.state.schemaView.text, /"minProperties": 1/);
	d.send(new Selector().field("schemaView"), "edit", ["{"]);
	assert.equal(d.state.schemaText, "{");
	assert.equal(d.state.schemaView.hasError, true);
	assert.equal(d.state.hasSchemaProblem, false); // the editor says it
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0], message.messages[0]); // a schema that isn't JSON stays as it was
	assert.equal(out.messages[2].data.get("email"), "g@x.io");
});

test("a patch_schema call shows the pointer, the value and how the examples fare", async () => {
	const { agent } = await loadAgent(ID);
	const C = agent.scope.components;
	const call = {
		id: "c1",
		name: "patch_schema",
		arguments: { pointer: "/properties/age/minimum", value: 18 },
	};
	const validation = {
		examples: [
			{ id: "e1", expected: "pass", valid: true, status: "pass", errors: 0 },
			{ id: "e2", expected: "pass", valid: false, status: "fail", errors: 1 },
		],
	};
	const result = { content: [{ type: "text", text: JSON.stringify(validation) }], isError: false };
	const d = new Driver({ root: C.SchemaEditCall({ call, result, kind: "message" }), document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messagepatch_schema\/properties\/age\/minimum = 181 pass · 1 fail/,
	);
	assert.deepEqual(
		d.state.problems.map((x) => x.text),
		["e2: expected valid, invalid (1 errors)"],
	);
	const failed = { content: [{ type: "text", text: "bad pointer" }], isError: true };
	assert.equal(C.SchemaEditCall({ call, result: failed }).state, "bad pointer");
	assert.equal(C.SchemaEditCall({ call, result: null }).state, "running");
	assert.deepEqual(d.problems, []);
});

test("examples reorder by tool and by drag; encode keeps the order", async () => {
	const { call, env, message, registry, agent } = await toolRunner(ID, "user");
	assert.equal((await call("reorder_examples", { id: "e3", index: 0 })).isError, false);
	assert.equal((await call("reorder_examples", { id: "e9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["s1", "e3", "e1", "e2", "e4"]);
	assert.deepEqual(
		env.root().rows.map((r) => r.id),
		["e3", "e1", "e2", "e4"],
	);
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="examples"]');
	dispatchDrag(handles()[3], handles()[1].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["s1", "e1", "e4", "e2", "e3"]);
	d.send(ROOT, "remove_examples_at", [0]);
	assert.deepEqual(
		d.state.examples.items.map((x) => x.id),
		["e4", "e2", "e3"],
	);
	assert.deepEqual(d.problems, []);
});

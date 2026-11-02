import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "jsonpointer-lab";

test("the config sample matches jsonpointer-lab and its empty sample decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "config"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const { d } = drive(registry, agent, "empty");
	assert.equal(d.state.pointers.items.length, 0);
	assert.equal(d.state.headline, "0 pointers · 0 resolve · 0 don't");
});

test("decode then encode gives back the same bytes for every sample", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const s of agent.samples) {
		const root = registry.open(agent, s.message);
		assert.equal(encodeMessage(registry.encode(agent, root, s.message)), encodeMessage(s.message));
	}
});

test("pointers resolve with escapes, or say where and why they don't", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "config");
	const [q1, q2, q3, q4] = d.state.resolutions;
	assert.equal(q1.value, "a.example.com");
	assert.equal(q2.value, "listUsers");
	assert.deepEqual(q2.tokens, ["routes", "/api/users", "get"]);
	assert.equal(q3.segment, 2);
	assert.match(q3.reason, /index 2 is out of range \(the array has 2 items\)/);
	assert.equal(q4.value, true);
	assert.equal(d.state.resolve("/").value, "the empty key");
	assert.match(d.state.resolve("/a~2b").reason, /segment 1 .* ~ that isn't/);
	assert.match(d.state.resolve("/nme").reason, /no key "nme" \(its keys: "name"/);
	assert.match(d.state.resolve("/name/x").reason, /can't look up "x" in a string/);
	assert.match(d.state.resolve("/servers/-").reason, /after the last one/);
	assert.match(d.state.resolve("/servers/01").reason, /isn't an array index/);
	assert.match(d.state.resolve("name").reason, /starts with "\/"/);
	assert.equal(d.state.headline, "4 pointers · 3 resolve · 1 don't");
});

test("clicking a tree node sets the focused pointer, and edits change only their part", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "config");
	d.send(ROOT, "focus", ["q3"]);
	d.drain();
	const i = d.state.treeRows.findIndex((r) => r.pointer === "/servers/1/port");
	d.send(ROOT, "pick_node", [i]);
	d.drain();
	assert.equal(d.state.pointerById("q3").pointer, "/servers/1/port");
	assert.ok(d.state.treeRows[i].cls.includes("btn-warning"));
	assert.equal(d.state.headline, "4 pointers · 4 resolve · 0 don't");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[2].data.get("pointer"), "/servers/1/port");
	for (const n of [0, 1, 3, 4]) assert.equal(out.messages[n], message.messages[n]);
});

test("an empty lab grows into one that matches its query", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "empty");
	d.send(ROOT, "set_document", [{ "a/b": [10, 20] }]);
	d.drain();
	d.send(ROOT, "pick_node", [3]); // no pointer yet: a click adds one
	d.drain();
	assert.equal(d.state.pointers.items[0].pointer, "/a~1b/1");
	assert.equal(d.state.resolutions[0].value, 20);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
});

test("the tools resolve and find pointers, and reject bad ids", async () => {
	const { call, text } = await toolRunner(ID, "config");
	assert.equal(
		JSON.parse(text(await call("resolve", { pointer: "/servers/1/host" }))).value,
		"b.example.com",
	);
	assert.match(text(await call("find", { text: "createuser" })), /\/routes\/~1api~1users\/post/);
	assert.equal((await call("set_pointer", { id: "q9", pointer: "" })).isError, true);
	assert.match(
		text(await call("set_pointer", { id: "q3", pointer: "/servers/0/port" })),
		/q3: "\/servers\/0\/port" → 8080/,
	);
	assert.match(text(await call("add_pointer", { pointer: "/name" })), /q5: "\/name" → "billing"/);
	assert.equal((await call("remove_pointer", { id: "q5" })).isError, false);
	assert.equal(JSON.parse(text(await call("resolutions"))).length, 4);
});

test("jsonpointer-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("the document is edited in a JsonView, and the focused pointer's value shows in one", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "config");
	assert.equal(d.state.docView.text, d.state.docText);
	assert.equal(JSON.parse(d.state.valueView.text), "a.example.com");
	d.send(ROOT, "focus", ["q3"]);
	assert.match(d.state.valueView.text, /index 2 is out of range/);
	assert.equal(d.state.valueView.isJson, false);
	d.send(new Selector().field("docView"), "edit", ['{"servers":[1,2,{"port":9}]}']);
	assert.equal(d.state.docText, '{"servers":[1,2,{"port":9}]}');
	assert.equal(d.state.valueView.text, "9");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[4].data.get("servers")[2].get("port"), 9n);
	for (const n of [0, 1, 2, 3]) assert.equal(out.messages[n], message.messages[n]);
});

test("set_pointer and resolve calls show the pointer and what it reaches", async () => {
	const { agent } = await loadAgent(ID);
	const C = agent.scope.components;
	const summary = [
		"2 pointers: 1 resolve, 1 don't.",
		"pointers:",
		'  q1: "/name" → "billing"',
		'  q2: "/servers/5" → segment 2: index 5 is out of range (the array has 2 items)',
		"document d1: {}",
	].join("\n");
	const text = (t) => ({ content: [{ type: "text", text: t }], isError: false });
	const call = (id, pointer) => ({ id: "c1", name: "set_pointer", arguments: { id, pointer } });
	const d = new Driver({
		root: C.PointerCall({ call: call("q1", "/name"), result: text(summary), kind: "message" }),
		document,
	});
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_pointerq1 = "\/name"→ "billing"/,
	);
	const bad = C.PointerCall({ call: call("q2", "/servers/5"), result: text(summary) });
	assert.equal(bad.resolves, false);
	assert.match(bad.state, /^segment 2: index 5 is out of range/);
	const answer = { pointer: "/a~1b", tokens: ["a/b"], resolves: true, value: [1] };
	const resolved = new Driver({
		root: C.ResolveCall({
			call: { id: "c2", name: "resolve", arguments: { pointer: "/a~1b" } },
			result: text(JSON.stringify(answer)),
			kind: "view",
		}),
		document,
	});
	assert.match(
		resolved.rootNode.querySelector("summary").textContent,
		/viewresolve"\/a~1b"resolves/,
	);
	assert.deepEqual(
		resolved.state.rows.map((r) => r.text),
		['tokens: ["a/b"]', "value: [1]"],
	);
	assert.deepEqual([...d.problems, ...resolved.problems], []);
});

test("pointers reorder by tool and by drag; encode keeps the order, the value follows the first", async () => {
	const { call, env, message, registry, agent } = await toolRunner(ID, "config");
	assert.equal((await call("reorder_pointers", { id: "q3", index: 0 })).isError, false);
	assert.equal((await call("reorder_pointers", { id: "q9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["q3", "q1", "q2", "q4", "d1"]);
	assert.match(env.root().valueView.text, /index 2 is out of range/);
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="pointers"]');
	dispatchDrag(handles()[2], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["q3", "q1", "q2", "q4", "d1"]);
	assert.match(d.state.valueView.text, /index 2 is out of range/);
	d.send(ROOT, "remove_pointers_at", [0]);
	d.send(ROOT, "add_pointers", []);
	assert.deepEqual(
		d.state.pointers.items.map((x) => [x.id, x.pointer]),
		[
			["q1", "/servers/0/host"],
			["q2", "/routes/~1api~1users/get"],
			["q4", "/a~0b"],
			["q5", ""],
		],
	);
	assert.equal(JSON.parse(d.state.valueView.text), "a.example.com");
	assert.deepEqual(d.problems, []);
});

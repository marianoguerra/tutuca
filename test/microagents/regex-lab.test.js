import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { packAgent, unpackAgent } from "../../apps/microagents/core/pack.js";
import { AgentRegistry } from "../../apps/microagents/core/registry.js";
import {
	decodeMessage,
	decodeMessageCbor,
	encodeMessage,
	encodeMessageCbor,
} from "../../apps/microagents/core/tdata.js";
import { makeKit } from "../../apps/microagents/kit.js";
import { lint } from "../../src/lint/index.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { DispatchPath } from "../../src/tutuca.js";
import { document, scopeWith } from "../helpers.js";
import { toolRunner } from "./helpers.js";

const ROOT = new DispatchPath();
const AGENTS = new URL("../../apps/microagents/agents/", import.meta.url);
const readText = (path) => readFile(new URL(path, AGENTS), "utf8");

const setup = async () => {
	const scope = scopeWith({});
	const registry = new AgentRegistry({ scope, kit: makeKit() });
	const agent = await registry.register(await packAgent(readText, "regex-lab"), { builtin: true });
	return { registry, agent };
};

test("the packed agent is a tdata message that survives both encodings", async () => {
	const msg = await packAgent(readText, "regex-lab");
	const again = decodeMessageCbor(encodeMessageCbor(decodeMessage(encodeMessage(msg))));
	assert.equal(encodeMessage(again), encodeMessage(msg));
	const parts = unpackAgent(again);
	assert.equal(parts.manifest.id, "regex-lab");
	assert.deepEqual(
		parts.samples.map((s) => s.id),
		["empty", "emails"],
	);
	assert.ok(parts.skills["reference/flags.md"].includes("dotAll"));
});

test("the emails sample matches regex-lab, its empty sample doesn't", async () => {
	const { registry, agent } = await setup();
	const { matches } = registry.match(registry.sample(agent, "emails"));
	assert.deepEqual(
		matches.map((m) => m.agent.id),
		["regex-lab"],
	);
	assert.deepEqual(
		matches[0].bindings.get("regexes").map((m) => m.id),
		["r1", "r2"],
	);
	assert.equal(registry.match(registry.sample(agent)).matches.length, 0);
});

test("decode then encode gives back the same bytes, unknown meta included", async () => {
	const { registry, agent } = await setup();
	const msg = registry.sample(agent, "emails");
	const root = registry.open(agent, msg);
	assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg));
	assert.deepEqual(
		[...encodeMessageCbor(registry.encode(agent, root, msg))],
		[...encodeMessageCbor(msg)],
	);
});

test("the grid shows which expectations pass, and tools change it", async () => {
	const { registry, agent } = await setup();
	const msg = registry.sample(agent, "emails");
	const d = new Driver({ root: registry.open(agent, msg), document });
	assert.equal(d.state.headline, "5 pass · 1 fail · 2 unset");
	// t4 "two@@signs.com" matches r1 though it shouldn't: forbid a second @.
	d.send(ROOT, "set_regex", ["r1", "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$", ""]);
	d.drain();
	assert.equal(d.state.headline, "6 pass · 0 fail · 2 unset");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, msg);
	assert.equal(out.messages[0].data.get("pattern"), "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$");
	assert.equal(out.messages[1], msg.messages[1]); // untouched parts stay the same objects
	assert.equal(out.messages[5].meta.get("x/notes").get("why"), "a double @ must fail");
});

test("an agent opens empty and grows from there", async () => {
	const { registry, agent } = await setup();
	const d = new Driver({ root: registry.open(agent, registry.sample(agent)), document });
	d.send(ROOT, "add_regex", ["\\d+", "g"]);
	d.send(ROOT, "add_text", ["abc 123"]);
	d.drain();
	d.send(ROOT, "set_expectation", ["t1", "r1", "match"]);
	d.drain();
	assert.equal(d.state.headline, "1 pass · 0 fail · 0 unset");
	assert.deepEqual(
		d.state.explain_matches("r1", "t1").matches.map((m) => m.text),
		["123"],
	);
	const out = registry.encode(agent, d.state, registry.sample(agent));
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === "regex-lab"));
});

test("regex-lab's components lint clean", async () => {
	const { agent } = await setup();
	const issues = lint(Object.values(agent.def.components), Object.keys(agent.def.components));
	assert.deepEqual(
		issues.filter((i) => i.level === "error").map((i) => i.message ?? String(i)),
		[],
	);
});

test("the grid's cells cycle expectations through kit.lib.grid", async () => {
	const { registry, agent } = await setup();
	const msg = registry.sample(agent, "emails");
	const d = new Driver({ root: registry.open(agent, msg), document });
	const cells = d.state.statusGridCells;
	const i = cells.findIndex((c) => !c.fixed && c.row === 2 && c.col === 1); // t3 × r2
	assert.equal(cells[i].status, "none");
	d.send(ROOT, "cycle_cell", [i]);
	assert.deepEqual(d.state.textById("t3").expect, { r1: "no-match", r2: "match" });
	assert.equal(d.state.statusGridCells[i].status, "fail");
	d.send(ROOT, "cycle_cell", [0]); // a label: nothing changes
	assert.equal(d.state.headline, "5 pass · 2 fail · 1 unset");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, msg);
	assert.equal(out.messages[4].meta.get("https://tutuca.dev/d/expect").get("r2"), "match");
	assert.equal(out.messages[0], msg.messages[0]);
});

test("a set_regex call shows the regex and the grid's headline", async () => {
	const { agent } = await setup();
	const C = agent.scope.components;
	const call = { id: "c1", name: "set_regex", arguments: { id: "r1", pattern: "a+", flags: "i" } };
	const rows = [{ text: "t1", cells: [{ regex: "r1", status: "fail", expected: "match" }] }];
	const result = { content: [{ type: "text", text: JSON.stringify(rows) }], isError: false };
	const d = new Driver({ root: C.SetRegexCall({ call, result, kind: "message" }), document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_regexr1 = \/a\+\/i0 pass · 1 fail/,
	);
	assert.equal(C.SetRegexCall({ call, result: null }).state, "running");
	assert.deepEqual(d.problems, []);
});

test("regexes and texts reorder by tool and by drag; encode keeps the order", async () => {
	const { call, env, message, registry, agent } = await toolRunner("regex-lab", "emails");
	assert.equal((await call("reorder_regexes", { id: "r2", index: 0 })).isError, false);
	assert.equal((await call("reorder_texts", { id: "t1", index: 9 })).isError, false);
	assert.equal((await call("reorder_texts", { id: "t9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["r2", "r1", "t2", "t3", "t4", "t1"]);
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="texts"]');
	dispatchDrag(handles()[3], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["r1", "r2", "t4", "t1", "t2", "t3"]);
	assert.deepEqual(d.state.statusGrid.cells[3].label, "t4");
	d.send(ROOT, "remove_regexes_at", [0]);
	d.send(ROOT, "add_regexes", []);
	assert.deepEqual(
		d.state.regexes.items.map((r) => [r.id, r.pattern]),
		[
			["r2", "@example\\.(com|org)"],
			["r3", ""],
		],
	);
	assert.equal(d.state.textById("t1").expect.r1, undefined);
	assert.deepEqual(d.problems, []);
});

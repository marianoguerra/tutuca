import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	AGENTS_URL,
	memoryStore,
	shellComponents,
	startApp,
} from "../../components/microagents/app.js";
import { scriptedClient } from "../../components/microagents/core/llm.js";
import { decodeMessage, encodeMessage } from "../../components/microagents/core/tdata.js";
import { packFolder } from "../../scripts/pack-agent.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";

const shellOf = (root, i = 0) => root.sessions[root.order[i]];

import { document, setupHost } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, readAgentFile, toolRunner } from "./helpers.js";

const EXAMPLES = new URL("agent-builder/examples/", AGENTS_URL);
const example = (path) => readFile(new URL(path, EXAMPLES), "utf8");
const readText = (path) => readFile(new URL(path, AGENTS_URL), "utf8");

test("the builder's samples are its examples, packed (just pack-agents)", async () => {
	for (const [sample, dir] of [
		["empty", "starter"],
		["logo", "logo"],
	]) {
		const packed = await packFolder(new URL(dir, EXAMPLES).pathname);
		assert.equal(
			encodeMessage(
				decodeMessage(await readAgentFile(`agent-builder/samples/${sample}.tdata.json`)),
			),
			packed,
			sample,
		);
	}
});

test("an agent file matches the builder; its samples round-trip", async () => {
	const { registry, agent } = await loadAgent("agent-builder");
	for (const id of ["empty", "logo"]) {
		const msg = registry.sample(agent, id);
		assert.ok(
			registry.match(msg).matches.some((m) => m.agent.id === "agent-builder"),
			id,
		);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
	assert.deepEqual(lintErrors(agent), []);
});

test("check passes for the logo example and opens its preview", async () => {
	const { call, env, text } = await toolRunner("agent-builder", "logo");
	const report = text(await call("check"));
	assert.doesNotMatch(report, /FAIL/);
	assert.match(report, /sample square matches the query/);
	assert.equal(env.root().preview.program, "repeat 4 [ fd 100 rt 90 ]");
});

test("check reports what's wrong, in words", async () => {
	const { call, text } = await toolRunner("agent-builder", "logo");
	assert.match(text(await call("set_query", { query: "[.messages[" })), /FAIL the query parses/);
	await call("set_query", { query: '.kind == "nope"' });
	assert.match(text(await call("check")), /FAIL sample square matches the query/);
	assert.match(
		text(await call("upsert_tool", { tool: { name: "fly", kind: "message", params: [] } })),
		/FAIL tool fly/,
	);
	assert.match(
		text(await call("write_module", { source: "export default 1" })),
		/FAIL the module defines an agent: the module must export default function define/,
	);
	assert.equal((await call("remove_tool", { name: "nope" })).isError, true);
});

// The acceptance scenario: from New, build the Logo agent with the builder's tools, install it,
// and open a Logo file with it; then export it and install it in another app.
test("build the Logo agent from scratch, install it and open a Logo program", async () => {
	const { host } = setupHost(shellComponents);
	const saved = [];
	const files = { saveText: (...a) => saved.push(a), saveBytes: () => {} };
	const llm = scriptedClient([]);
	const { asks } = await startApp({ host, readText, llm, store: memoryStore(), files });
	const send = async (name, args = [], to = new Selector()) => {
		host.send(name, args, { to });
		await host.whenIdle();
	};
	await send("start", ["agent-builder", "empty"]);
	let n = 0;
	const call = async (name, args = {}) => {
		const r = await asks.runTool([
			host.root.order[0],
			{ type: "toolCall", id: `c${++n}`, name, arguments: args },
		]);
		assert.equal(r.isError, false, `${name}: ${r.content[0].text}`);
		return r.content[0].text;
	};
	const manifest = {
		id: "logo",
		title: "Logo",
		icon: "🐢",
		needs: "a logo-program part",
		description: "Turtle graphics.",
	};
	for (const [field, value] of Object.entries(manifest))
		await call("set_manifest", { field, value });
	await call("upsert_sample", {
		id: "empty",
		tdata_json: await example("logo/samples/empty.tdata.json"),
	});
	await call("upsert_sample", {
		id: "square",
		tdata_json: await example("logo/samples/square.tdata.json"),
	});
	await call("remove_sample", { id: "hello" });
	await call("set_query", {
		query: '[.messages[] ~ {kind: "logo-program"}] as $programs | ($programs | length) > 0',
	});
	await call("write_module", { source: await example("logo/agent.js") });
	await call("remove_tool", { name: "set_text" });
	for (const tool of JSON.parse(await example("logo/tools.json")))
		await call("upsert_tool", { tool });
	await call("set_prompt", { prompt: "You are Logo." });
	await call("write_skill", { path: "SKILL.md", text: await example("logo/skills/SKILL.md") });
	assert.doesNotMatch(await call("check"), /FAIL/);
	// The preview runs the module being written.
	assert.equal(shellOf(host.root).workspace.preview.program, "repeat 4 [ fd 100 rt 90 ]");
	await call("install");
	assert.ok(host.root.agents.some((a) => a.id === "logo"));
	assert.match(shellOf(host.root).workspace.notice, /Installed Logo/);
	// Export the agent and drop it in a new app with an empty store.
	await send("download", ["json"], new Selector().item("sessions", host.root.order[0]));
	const agentFile = saved.at(-1)[1];
	assert.equal(decodeMessage(agentFile).kind, "microagent");
	const other = setupHost(shellComponents);
	await startApp({ host: other.host, readText, llm, store: memoryStore(), files });
	const sendOther = async (name, args = []) => {
		other.host.send(name, args);
		await other.host.whenIdle();
	};
	await sendOther("setPaste", [agentFile]);
	await sendOther("openPaste");
	assert.equal(other.host.root.picker.agent.title, "Logo");
	assert.deepEqual(
		other.host.root.picker.choices.map((c) => c.id),
		["agent-builder"],
	);
	await sendOther("reviewInstall");
	await sendOther("confirmInstall");
	await sendOther("setPaste", [await example("logo/samples/spiral.tdata.json")]);
	await sendOther("openPaste");
	assert.equal(other.host.root.mode, "active");
	assert.equal(shellOf(other.host.root).title, "Logo");
	assert.equal(shellOf(other.host.root).workspace.drawing.segments.length, 144);
});

test("the tools and the samples are edited in JsonViews", async () => {
	const { registry, agent } = await loadAgent("agent-builder");
	const { d } = drive(registry, agent, "logo");
	const tools = JSON.parse(d.state.toolsView.text);
	d.send(new Selector().field("toolsView"), "edit", [JSON.stringify(tools.slice(1))]);
	d.drain();
	d.send(ROOT, "apply_tools", []);
	d.drain();
	assert.equal(d.state.tools.length, tools.length - 1);
	assert.equal(d.state.toolsError, "");
	const text = '{"id":"x","kind":"logo-file","messages":[]}';
	d.send(new Selector().field("samples").item("items", 0).field("view"), "edit", [text]);
	d.drain();
	assert.equal(d.state.samples.items[0].text, text);
	assert.equal(d.state.samples.items[0].view.text, text);
	d.send(ROOT, "add_samples", []);
	d.drain();
	assert.equal(d.state.samples.items.at(-1).view.editable, true);
	assert.deepEqual(d.problems, []);
});

test("reorder_samples moves a sample, and the agent message keeps the new order", async () => {
	const { call, env, registry, agent, message } = await toolRunner("agent-builder", "logo");
	assert.equal(registry.encode(agent, env.root(), message), message);
	assert.equal((await call("reorder_samples", { id: "spiral", index: 0 })).isError, false);
	assert.equal((await call("reorder_samples", { id: "nope", index: 0 })).isError, true);
	const out = registry.encode(agent, env.root(), message);
	assert.deepEqual(
		out.messages.filter((m) => m.kind === "microagent/sample").map((m) => m.id),
		["spiral", "empty", "square"],
	);
	assert.equal(out.messages.at(-3), message.messages.at(-1));
});

test("the sample list: drag to reorder, the remove button and the add button", async () => {
	const { registry, agent } = await loadAgent("agent-builder");
	const { d, message } = drive(registry, agent, "logo");
	d.send(ROOT, "set_tab", [6]); // samples
	d.drain();
	const ids = () => d.state.samples.items.map((s) => s.id);
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="samples"]');
	assert.equal(handles().length, 3);
	dispatchDrag(handles()[1], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(), ["square", "empty", "spiral"]);
	[...d.rootNode.querySelectorAll('button[title="Remove"]')][2].click();
	d.drain();
	[...d.rootNode.querySelectorAll("button")].find((b) => b.textContent === "+ Sample").click();
	d.drain();
	assert.deepEqual(ids(), ["square", "empty", "sample3"]);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(
		out.messages.filter((m) => m.kind === "microagent/sample").map((m) => m.id),
		["square", "empty", "sample3"],
	);
});

test("a write_module call shows how the check went, opening to what fails", async () => {
	const { call, agent } = await toolRunner("agent-builder", "logo");
	const make = (name, args, result) =>
		agent.scope.make("CheckCall", {
			call: { type: "toolCall", id: "c1", name, arguments: args },
			result,
			kind: "message",
		});
	const good = make("check", {}, await call("check"));
	assert.match(good.state, /^all \d+ checks pass$/);
	const args = { source: "export default 1" };
	const view = make("write_module", args, await call("write_module", args));
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messagewrite_module1 lines\d+ of \d+ checks fail/,
	);
	assert.ok(view.failing.some((f) => f.startsWith("the module defines an agent")));
	assert.equal(
		make("upsert_tool", { tool: { name: "fly", kind: "message" } }, null).what,
		"fly (message)",
	);
	assert.deepEqual(d.problems, []);
});

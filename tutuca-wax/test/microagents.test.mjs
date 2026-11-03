// The micro-agents (microagents/): each built-in agent's module, as
// scripts/build.mjs packs it into dist/agents/<id>.wasm, loads into a scope
// under the kit, keeps its contract, opens its samples and not other JSON,
// and runs its tools on a headless dev host as the shell does.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, describe, test } from "node:test";
import { load } from "../js/tutuca-rt.js";
import { agentMeta, fits, loadAgent, openWith } from "../microagents/agent.js";
import { hostEnv, parseType, runToolCall, toolsFor, typeSchema } from "../microagents/tools.js";

const root = new URL("../", import.meta.url);
const bytes = (path) => readFileSync(new URL(path, root));
const IDS = readdirSync(new URL("dist/agents/", root))
	.filter((f) => f.endsWith(".wasm") && !f.endsWith(".debug.wasm"))
	.map((f) => f.slice(0, -".wasm".length));

let tw;
let shell;
const agents = new Map();

before(async () => {
	tw = await load(new URL("dist/tutuca-rt.wasm", root));
	shell = tw.runtime.scope();
	await tw.loadComponent(bytes("dist/components/microagent_kit.wasm"), shell);
	for (const id of IDS) agents.set(id, await loadAgent(tw, bytes(`dist/agents/${id}.wasm`), shell));
});

// A headless dev host on agent's root made from json, and the env tools run in.
const session = (agent, json) => {
	const host = tw.runtime.createHost(null, null, openWith(tw, agent, json), { dev: true });
	let restored = null;
	const env = hostEnv(tw.runtime, host, [], {
		restore: (prev) => {
			restored = prev;
		},
	});
	return { host, env, restored: () => restored };
};
let nextCall = 0;
const call = (agent, env, name, args = {}) => runToolCall(tw.runtime, env, agent, { id: `c${nextCall++}`, name, arguments: args });
const textOf = (result) => result.content[0].text;

test("TCD types read as JSON Schemas", () => {
	assert.deepEqual(typeSchema(parseType("list<record { id: string, n: s32 }>")), {
		type: "array",
		items: {
			type: "object",
			properties: { id: { type: "string" }, n: { type: "integer", minimum: -(2 ** 31), maximum: 2 ** 31 - 1 } },
			required: ["id", "n"],
			additionalProperties: false,
		},
	});
	assert.deepEqual(typeSchema(parseType("option<enum { a, b }>")), { anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] });
});

for (const id of IDS) {
	describe(id, () => {
		const agent = () => agents.get(id);
		test("loads with no problems: its contract holds and its samples open", () => {
			assert.deepEqual(agent().problems, []);
		});
		test("doesn't open JSON of another shape, and says why", () => {
			const fit = fits(tw, agent(), { something: "else" });
			assert.equal(fit.ok, false);
			assert.ok(fit.issues.length > 0 || fit.error !== "");
		});
		test("gives every tool a description and a JSON Schema for its parameters", () => {
			const tools = toolsFor(tw.runtime, agent(), openWith(tw, agent(), agent().meta.samples.empty));
			for (const tool of tools) {
				assert.ok(tool.description, tool.name);
				assert.equal(tool.parameters.type, "object", tool.name);
			}
		});
		test("has data and domain as JSON, and a summary, for each sample", () => {
			for (const [name, sample] of Object.entries(agent().meta.samples)) {
				const c = openWith(tw, agent(), structuredClone(sample));
				assert.equal(typeof tw.runtime.get(c, "summary"), "string", name);
				JSON.stringify(tw.runtime.get(c, "data"));
				JSON.stringify(tw.runtime.get(c, "domain"));
			}
		});
	});
}

test("the built-in agents are built", () => assert.ok(IDS.includes("jsonpointer-lab"), `built: ${IDS.join(", ")}`));

describe("the shell", () => {
	// The shell on a jsdom page, with the built-in agents and a scripted model.
	const shellWith = async (turns) => {
		const { JSDOM } = await import("jsdom");
		const { createApp } = await import("../microagents/app.js");
		const { scriptedClient } = await import("../microagents/llm.js");
		const t = await load(new URL("dist/tutuca-rt.wasm", root));
		const base = t.runtime.scope();
		await t.loadComponent(bytes("dist/components/microagent_kit.wasm"), base);
		const shellScope = t.runtime.enter(base, "shell");
		await t.loadComponent(bytes("dist/components/microagents.wasm"), shellScope);
		const client = scriptedClient(turns);
		const downloads = [];
		const app = await createApp({
			tw: t,
			base,
			shellScope,
			client,
			builtins: IDS.map((id) => ({ id, bytes: bytes(`dist/agents/${id}.wasm`) })),
			download: (name, text) => downloads.push({ name, text }),
		});
		const { window } = new JSDOM("<div></div>");
		const container = window.document.querySelector("div");
		const host = t.runtime.createHost(
			window.document,
			container,
			t.runtime.make(shellScope, "MicroAgents", { agents: app.agentRows(), sessions: [], models: [{ value: "scripted/script", name: "Scripted" }], model: "" }),
			{ dev: true, asks: app.asks },
		);
		app.attach(host);
		host.mount();
		app.setModel("scripted/script");
		return { t, app, host, container, client, downloads, window };
	};
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	test("lists the agents; a sample's button opens it in a session whose workspace renders", async () => {
		const { t, host, container, window } = await shellWith([]);
		assert.match(container.textContent, /JSON Pointer lab/);
		const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "config");
		button.dispatchEvent(new window.Event("click", { bubbles: true }));
		await host.settled();
		const [session] = t.runtime.get(host.root(), "sessions");
		assert.equal(t.runtime.get(host.root(), "active"), t.runtime.get(session, "id"));
		assert.match(container.textContent, /4 pointers · 3 resolve · 1 don't/);
		assert.deepEqual(host.issues, []);
		assert.deepEqual(host.failures, []);
	});

	test("the model's tool calls edit the workspace, and the chat shows them", async () => {
		const { t, host, container, client } = await shellWith([
			[{ name: "set_pointer", arguments: { id: "q3", pointer: "/servers/1/port" } }],
			[{ name: "set_pointer", arguments: { id: "zz", pointer: "/x" } }, { name: "resolve", arguments: { pointer: "/name" } }],
			["Fixed q3: the array has two servers."],
		]);
		host.send("open_sample", ["jsonpointer-lab", "config"]);
		await host.settled();
		host.sendAt([["sessions", 0]], "set_draft", ["fix q3"]);
		host.sendAt([["sessions", 0]], "send_chat", []);
		await host.settled();
		for (let i = 0; i < 20 && t.runtime.get(t.runtime.get(host.root(), "sessions")[0], "busy"); i++) {
			await tick();
			await host.settled();
		}
		const session = t.runtime.get(host.root(), "sessions")[0];
		assert.equal(t.runtime.get(session, "busy"), false);
		const chat = t.runtime.get(session, "chat");
		assert.deepEqual(
			chat.map((r) => [r.kind, r.error]),
			[
				["user", false],
				["tool", false],
				["tool", true],
				["tool", false],
				["assistant", false],
			],
		);
		assert.match(chat[2].text, /can't run with these arguments now/);
		assert.match(container.textContent, /4 pointers · 4 resolve · 0 don't/);
		assert.match(client.requests[0].systemPrompt, /q3: "\/servers\/2\/port" → segment 2/);
		assert.ok(client.requests[0].tools.some((tool) => tool.name === "find"));
		assert.deepEqual(host.issues, []);
		assert.deepEqual(host.failures, []);
	});

	test("a dropped JSON document opens with the agent it fits; other JSON says what the agents open", async () => {
		const { t, app, host } = await shellWith([]);
		assert.deepEqual(app.dropJson({ nope: 1 }), []);
		await host.settled();
		assert.match(t.runtime.get(host.root(), "status"), /no agent opens this file\..*JSON Pointer lab opens/);
		const fitting = app.dropJson({ pointers: [{ id: "a", pointer: "/x" }], document: { x: 1 } });
		assert.equal(fitting.length, 1);
		await host.settled();
		await tick();
		await host.settled();
		const [session] = t.runtime.get(host.root(), "sessions");
		assert.match(t.runtime.get(t.runtime.get(session, "workspace"), "summary"), /a: "\/x" → 1/);
	});

	test("export downloads the workspace's data", async () => {
		const { host, downloads } = await shellWith([]);
		host.send("open_sample", ["jsonpointer-lab", "empty"]);
		await host.settled();
		host.sendAt([["sessions", 0]], "export", []);
		await host.settled();
		assert.equal(downloads.length, 1);
		assert.deepEqual(JSON.parse(downloads[0].text), { pointers: [{ id: "q1", pointer: "" }], document: {} });
	});
});

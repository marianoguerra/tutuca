// The micro-agents: every built-in agent's package loads and holds up its tools, and the shell
// runs them, on a jsdom page with a scripted model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { testEnv } from "../../src/testing/driver.js";
import { dom } from "../../test/helpers.js";
import { createRuntime } from "../js/tutuca-wasm.js";
import { fits, loadAgent, parsePackage } from "../microagents/agent.js";
import { createApp, SHELL } from "../microagents/app.js";
import { scriptedClient } from "../microagents/llm.js";
import { agentIds, packAgentDir } from "../microagents/pack.mjs";
import { hostEnv, toolsFor, typeSchema } from "../microagents/tools.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const kit = read("../microagents/kit/kit.tutuca.ts");
const IDS = agentIds();
const packages = IDS.map((id) =>
	packAgentDir(new URL(`../microagents/agents/${id}`, import.meta.url).pathname),
);

// A runtime on a page, with the kit at its base.
const runtime = async (asks = {}) => {
	const page = dom().document;
	const node = page.createElement("main");
	const tutuca = await createRuntime({ env: testEnv(), document: page, rootNode: node, asks });
	assert.equal((await tutuca.load(kit)).ok, true);
	return { tutuca, node, window: page.defaultView };
};

test("types read as JSON Schemas", () => {
	assert.deepEqual(typeSchema({ type: "number", int: true, min: 0 }), {
		type: "integer",
		minimum: 0,
	});
	assert.deepEqual(typeSchema({ type: "array", of: { type: "string" }, minLength: 1 }), {
		type: "array",
		items: { type: "string" },
		minItems: 1,
	});
	assert.deepEqual(typeSchema({ type: "option", of: { type: "enum", values: ["a", "b"] } }), {
		anyOf: [{ enum: ["a", "b"] }, { type: "null" }],
	});
	assert.deepEqual(typeSchema({ type: "record", fields: { a: { type: "boolean" } } }), {
		type: "object",
		properties: { a: { type: "boolean" } },
		required: ["a"],
		additionalProperties: false,
	});
	assert.deepEqual(typeSchema({ type: "map", of: { type: "boolean" } }), {
		type: "object",
		additionalProperties: { type: "boolean" },
	});
});

test("a package is told from other JSON", () => {
	assert.equal(parsePackage(JSON.stringify(packages[0])).id, packages[0].id);
	assert.equal(parsePackage('{ "pointers": [] }'), null);
	assert.equal(parsePackage("not json"), null);
});

describe("the built-in agents", async () => {
	const { tutuca } = await runtime();
	const agents = new Map();
	for (const pkg of packages) agents.set(pkg.id, await loadAgent(tutuca, pkg, kit));
	for (const id of IDS) {
		describe(id, () => {
			const agent = () => agents.get(id);
			test("loads with no problems: its contract holds and its samples open", () => {
				assert.deepEqual(agent().problems, []);
			});
			test("doesn't open JSON of another shape, and says why", () => {
				const fit = fits(tutuca, agent(), { something: "else" });
				assert.equal(fit.ok, false);
				assert.ok(fit.issues.length > 0 || fit.error !== "");
			});
			test("gives every tool a description and a JSON Schema with its arguments' names", () => {
				for (const tool of toolsFor(agent())) {
					assert.ok(tool.description, tool.name);
					assert.equal(tool.parameters.type, "object", tool.name);
					for (const name of tool.parameters.required) assert.doesNotMatch(name, /^arg\d+$/);
				}
			});
			test("has data and domain as JSON, and a summary, for each sample", () => {
				for (const [name, sample] of Object.entries(agent().meta.samples)) {
					tutuca.start(agent().meta.root, structuredClone(sample), { scope: agent().scope });
					const env = hostEnv(tutuca);
					assert.equal(typeof env.get("summary"), "string", name);
					JSON.stringify(env.get("data"));
					JSON.stringify(env.get("domain"));
				}
			});
		});
	}
});

describe("the shell", () => {
	// The shell on a jsdom page, with the built-in agents and a scripted model.
	const shellWith = async (turns) => {
		const asks = {};
		const { tutuca, node, window } = await runtime(asks);
		const shell = read("../microagents/microagents.tutuca.ts");
		assert.deepEqual((await tutuca.load(shell, { scope: SHELL })).diagnostics, []);
		const client = scriptedClient(turns);
		const downloads = [];
		const app = await createApp({
			tutuca,
			kit,
			client,
			builtins: packages,
			download: (name, text) => downloads.push({ name, text }),
		});
		Object.assign(asks, app.asks);
		tutuca.start(
			"MicroAgents",
			{
				agents: app.agentRows(),
				sessions: [],
				models: [{ value: "scripted/script", name: "Scripted" }],
				model: "",
			},
			{ scope: SHELL },
		);
		app.attach();
		tutuca.mount();
		app.setModel("scripted/script");
		return { tutuca, app, node, client, downloads, window };
	};
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
	const session = [{ item: "sessions", key: 0 }];
	const problems = (tutuca) =>
		tutuca
			.reports()
			.filter((r) => r.outcome === "failed" || r.type === "renderFailed" || r.issues?.length > 0);

	test("lists the agents; a sample's button opens it in a session whose workspace renders", async () => {
		const { tutuca, node, window } = await shellWith([]);
		assert.match(node.textContent, /JSON Pointer lab/);
		const button = [...node.querySelectorAll("button")].find((b) => b.textContent === "config");
		button.dispatchEvent(new window.Event("click", { bubbles: true }));
		await tutuca.idle();
		const state = tutuca.state();
		assert.equal(state.active, state.sessions[0].id);
		assert.match(node.textContent, /4 pointers · 3 resolve · 1 don't/);
		assert.deepEqual(problems(tutuca), []);
	});

	test("the model's tool calls edit the workspace, and the chat shows them", async () => {
		const { tutuca, node, client } = await shellWith([
			[{ name: "setPointer", arguments: { id: "q3", pointer: "/servers/1/port" } }],
			[
				{ name: "setPointer", arguments: { id: "zz", pointer: "/x" } },
				{ name: "resolve", arguments: { pointer: "/name" } },
			],
			["Fixed q3: the array has two servers."],
		]);
		tutuca.send("openSample", ["jsonpointer-lab", "config"]);
		await tutuca.idle();
		tutuca.send("setDraft", ["fix q3"], { to: session });
		tutuca.send("sendChat", [], { to: session });
		await tutuca.idle();
		for (let i = 0; i < 50 && tutuca.state().sessions[0].busy; i++) {
			await tick();
			await tutuca.idle();
		}
		const { busy, chat } = tutuca.state().sessions[0];
		assert.equal(busy, false);
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
		assert.match(node.textContent, /4 pointers · 4 resolve · 0 don't/);
		assert.match(client.requests[0].systemPrompt, /q3: "\/servers\/2\/port" → segment 2/);
		assert.ok(client.requests[0].tools.some((tool) => tool.name === "find"));
		assert.deepEqual(problems(tutuca), []);
	});

	test("a dropped JSON document opens with the agent it fits; other JSON says what the agents open", async () => {
		const { tutuca, app } = await shellWith([]);
		assert.deepEqual(app.dropJson({ nope: 1 }), []);
		await tick();
		assert.match(tutuca.state().status, /no agent opens this file\..*JSON Pointer lab opens/);
		const fitting = app.dropJson({ pointers: [{ id: "a", pointer: "/x" }], document: { x: 1 } });
		assert.equal(fitting.length, 1);
		await tick();
		await tutuca.idle();
		assert.match(tutuca.query("summary", [], { to: [...session, "workspace"] }), /a: "\/x" → 1/);
	});

	test("export downloads the workspace's data", async () => {
		const { tutuca, downloads } = await shellWith([]);
		tutuca.send("openSample", ["jsonpointer-lab", "empty"]);
		await tutuca.idle();
		tutuca.send("export", [], { to: session });
		await tutuca.idle();
		assert.equal(downloads.length, 1);
		assert.deepEqual(JSON.parse(downloads[0].text), {
			pointers: [{ id: "q1", pointer: "" }],
			document: {},
		});
	});

	test("an agent's package dropped installs it, and it can be removed", async () => {
		const { tutuca, app } = await shellWith([]);
		const pkg = { ...packages.find((p) => p.id === "regex-lab"), id: "my-regex", title: "Mine" };
		const agent = await app.dropPackage(JSON.stringify(pkg));
		assert.deepEqual(agent.problems, []);
		await tick();
		assert.match(tutuca.state().status, /installed Mine/);
		assert.ok(tutuca.state().agents.some((a) => a.id === "my-regex"));
		tutuca.send("openSample", ["my-regex", "empty"]);
		await tutuca.idle();
		assert.equal(tutuca.typeAt([...session, "workspace"]), "RegexLab");
	});
});

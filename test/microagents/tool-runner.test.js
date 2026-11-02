import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { packAgent } from "../../apps/microagents/core/pack.js";
import { AgentRegistry } from "../../apps/microagents/core/registry.js";
import { hostEnv, runToolCall } from "../../apps/microagents/core/tool-runner.js";
import { toolsFor } from "../../apps/microagents/core/tool-schema.js";
import { makeKit } from "../../apps/microagents/kit.js";
import { ContractError, Selector } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const AGENTS = new URL("../../apps/microagents/agents/", import.meta.url);
const readText = (path) => readFile(new URL(path, AGENTS), "utf8");

const setup = async () => {
	const { host } = setupHost({});
	const registry = new AgentRegistry({ scope: host.scope, kit: makeKit() });
	const agent = await registry.register(await packAgent(readText, "regex-lab"));
	const original = registry.sample(agent, "emails");
	host.start(registry.open(agent, original));
	const env = hostEnv(host, new Selector());
	let n = 0;
	const call = (name, args = {}) =>
		runToolCall(env, agent, original, { id: `c${++n}`, name, arguments: args });
	return { host, agent, env, call };
};
const textOf = (r) => r.content[0].text;

test("message tools get their parameters from the handler's args", async () => {
	const { agent, env } = await setup();
	const tools = toolsFor(agent, env.root());
	const setRegex = tools.find((t) => t.name === "set_regex");
	assert.deepEqual(setRegex.parameters, {
		type: "object",
		properties: { id: { type: "string" }, pattern: { type: "string" }, flags: { type: "string" } },
		required: ["id", "pattern", "flags"],
	});
	const expect = tools.find((t) => t.name === "set_expectation");
	assert.deepEqual(expect.parameters.properties.outcome, { enum: ["match", "no-match", "none"] });
	assert.ok(tools.some((t) => t.name === "skills_read"));
});

test("a message tool runs the root's handler and answers with its result query", async () => {
	const { env, call } = await setup();
	const r = await call("set_regex", {
		id: "r1",
		pattern: "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$",
		flags: "",
	});
	assert.equal(r.isError, false);
	assert.equal(r.details.changed, true);
	assert.equal(JSON.parse(textOf(r)).find((row) => row.text === "t4").cells[0].status, "pass");
	assert.equal(env.root().headline, "6 pass · 0 fail · 2 unset");
});

test("bad arguments and a failed precondition come back as errors, changing nothing", async () => {
	const { env, call } = await setup();
	const before = env.root();
	const bad = await call("set_regex", { id: "r1", pattern: 3, flags: "" });
	assert.equal(bad.isError, true);
	assert.match(textOf(bad), /argument pattern is 3, which isn't a string/);
	const missing = await call("set_regex", { id: "r9", pattern: "x", flags: "" });
	assert.equal(missing.isError, true);
	assert.match(textOf(missing), /precondition/);
	assert.equal(env.root(), before);
	assert.equal((await call("nope")).isError, true);
});

test("view tools read, shared tools read the skills and the export", async () => {
	const { env, call } = await setup();
	const before = env.root();
	const r = await call("explain_matches", { regex: "r2", text: "t2" });
	assert.deepEqual(
		JSON.parse(textOf(r)).matches.map((m) => m.text),
		["@EXAMPLE.org"],
	);
	assert.equal(env.root(), before);
	assert.deepEqual(JSON.parse(textOf(await call("skills_list", { dir: "reference" }))), [
		"reference/flags.md",
	]);
	assert.match(textOf(await call("skills_read", { path: "SKILL.md" })), /Workflow/);
	assert.equal((await call("skills_read", { path: "nope.md" })).isError, true);
	assert.match(textOf(await call("export_preview")), /^\{"id":"emails","kind":"regex-lab"/);
});

test("a pure message tool is applied at once: no task is queued and no send waited for", async () => {
	const { host, env, call } = await setup();
	let sent = 0;
	const send = env.send;
	env.send = (...args) => {
		sent++;
		return send(...args);
	};
	const before = host.root;
	const result = call("set_regex", { id: "r1", pattern: "x+", flags: "" });
	// Apply is synchronous: the root changed before the call's promise settled.
	assert.notEqual(host.root, before);
	assert.equal(host.root.regexes.items[0].pattern, "x+");
	assert.equal(host.tasks.length, 0);
	const r = await result;
	assert.equal(r.isError, false);
	assert.equal(r.details.changed, true);
	assert.equal(sent, 0);
});

test("a message tool that reads the world is still sent", async () => {
	const { host, env, call } = await setup();
	let sent = 0;
	const send = env.send;
	env.send = (...args) => {
		sent++;
		return send(...args);
	};
	const count = host.root.regexes.items.length;
	const r = await call("add_regex", { pattern: "y", flags: "" });
	assert.equal(r.isError, false);
	assert.equal(sent, 1);
	assert.equal(host.root.regexes.items.length, count + 1);
});

test("a pure tool's contract errors come back as the model reads them, changing nothing", async () => {
	const { host, call } = await setup();
	const before = host.root;
	const pre = await call("set_regex", { id: "nope", pattern: "x", flags: "" });
	assert.equal(pre.isError, true);
	assert.match(textOf(pre), /precondition doesn't hold/);
	const bad = await call("set_regex", { id: "r1", pattern: 3, flags: "" });
	assert.equal(bad.isError, true);
	assert.match(textOf(bad), /argument pattern is 3, which isn't a string/);
	assert.equal(host.root, before);
});

test("a view tool is a query: one the root doesn't have is an error", async () => {
	const { env, call } = await setup();
	const r = await call("explain_matches", { regex: "r1", text: "t1" });
	assert.equal(r.isError, false);
	assert.deepEqual(JSON.parse(textOf(r)), env.query("explain_matches", ["r1", "t1"]));
	env.query = () => {
		throw new ContractError("RegexLab", "x", ["unknown"]);
	};
	const missing = await call("explain_matches", { regex: "r1", text: "t1" });
	assert.equal(missing.isError, true);
	assert.match(textOf(missing), /has no explain_matches/);
});

// What the micro-agent tests share: an agent packed from its folder and registered, its root
// driven by messages, and its tools run as a model would run them.
import { readFile } from "node:fs/promises";
import { AGENTS_URL } from "../../apps/microagents/app.js";
import { packAgent } from "../../apps/microagents/core/pack.js";
import { AgentRegistry } from "../../apps/microagents/core/registry.js";
import { hostEnv, runToolCall } from "../../apps/microagents/core/tool-runner.js";
import { makeKit } from "../../apps/microagents/kit.js";
import { lint } from "../../src/lint/index.js";
import { Driver } from "../../src/test/driver.js";
import { DispatchPath, Selector } from "../../src/tutuca.js";
import { document, scopeWith, setupHost } from "../helpers.js";

export const ROOT = new DispatchPath();
export const readAgentFile = (path) => readFile(new URL(path, AGENTS_URL), "utf8");

// The registry with the agents ids (folders under apps/microagents/agents/).
export const loadAgents = async (ids, scope = scopeWith({})) => {
	const registry = new AgentRegistry({ scope, kit: makeKit() });
	for (const id of ids)
		await registry.register(await packAgent(readAgentFile, id), { builtin: true });
	return registry;
};
// { registry, agent } for one agent.
export const loadAgent = async (id) => {
	const registry = await loadAgents([id]);
	return { registry, agent: registry.get(id) };
};
// A Driver on the agent's root for msg (a sample's id or a message); d.send(ROOT, name, args).
export const drive = (registry, agent, msg = "empty") => {
	const message = typeof msg === "string" ? registry.sample(agent, msg) : msg;
	return { message, d: new Driver({ root: registry.open(agent, message), document }) };
};
// call(name, args) runs a tool as the chat does, on a live host whose root is agent id's.
export const toolRunner = async (id, msg = "empty") => {
	const { host } = setupHost({});
	const registry = await loadAgents([id], host.scope);
	const agent = registry.get(id);
	const message = typeof msg === "string" ? registry.sample(agent, msg) : msg;
	host.start(registry.open(agent, message));
	const env = hostEnv(host, new Selector());
	let n = 0;
	const call = (name, args = {}) =>
		runToolCall(env, agent, message, { id: `c${++n}`, name, arguments: args });
	return { host, env, call, message, registry, agent, text: (r) => r.content[0].text };
};
// The lint errors of the agent's components, as text.
export const lintErrors = (agent) =>
	lint(Object.values(agent.def.components), Object.keys(agent.def.components))
		.filter((i) => i.level === "error")
		.map((i) => `${i.code} ${i.path}: ${i.message}`);

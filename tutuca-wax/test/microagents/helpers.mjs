// What the micro-agents' tests share: the runtime with the kit, an agent
// loaded from dist/agents/<id>.wasm (as scripts/build.mjs packs it), a
// headless dev host on its root, and running its tools as the shell does.
import { readFileSync } from "node:fs";
import { load } from "../../js/tutuca-rt.js";
import { loadAgent, openWith } from "../../microagents/agent.js";
import { hostEnv, runToolCall } from "../../microagents/tools.js";

export const root = new URL("../../", import.meta.url);
export const bytes = (path) => readFileSync(new URL(path, root));

let world = null;
// { tw, base }: one runtime, the kit loaded in its root scope.
export async function runtime() {
	if (world) return world;
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const base = tw.runtime.scope();
	await tw.loadComponent(bytes("dist/components/microagent_kit.wasm"), base);
	world = { tw, base };
	return world;
}

const agents = new Map();
// The agent id, loaded once: { meta, scope, problems, classes }.
export async function agent(id) {
	if (!agents.has(id)) {
		const { tw, base } = await runtime();
		agents.set(id, await loadAgent(tw, bytes(`dist/agents/${id}.wasm`), base));
	}
	return agents.get(id);
}

// A headless dev host on agent's root made from json (the sample named so,
// when json is a string): { host, env, root(), get(name), call(name, args)
// → the ToolResultMessage, json(name, args) → its text parsed, send(name,
// ...args) }.
export async function session(a, json) {
	const { tw } = await runtime();
	const doc = typeof json === "string" ? structuredClone(a.meta.samples[json]) : json;
	const host = tw.runtime.createHost(null, null, openWith(tw, a, doc), { dev: true });
	const env = hostEnv(tw.runtime, host, [], { restore: () => {} });
	let n = 0;
	const call = (name, args = {}) => runToolCall(tw.runtime, env, a, { id: `c${n++}`, name, arguments: args });
	return {
		host,
		env,
		root: () => host.root(),
		get: (name) => tw.runtime.get(host.root(), name),
		call,
		text: async (name, args) => (await call(name, args)).content[0].text,
		json: async (name, args) => JSON.parse((await call(name, args)).content[0].text),
		send: (name, ...args) => host.send(name, args),
	};
}

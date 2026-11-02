// The agents the app knows: each one is registered from its agent message, which puts its
// components in a scope of its own, and matched against dropped messages with its tq query.
import { defineAgent } from "./load-module.js";
import { AGENT_KIND, EMPTY_SAMPLE, unpackAgent } from "./pack.js";
import { queries } from "./tdata.js";

// The core's own query: a message that is a micro-agent, to install.
export const AGENT_QUERY = `.kind == "${AGENT_KIND}"`;

const scopeName = (id) => id.replace(/[^a-zA-Z0-9_.-]/g, "_");

export class AgentRegistry {
	// scope is where agents' scopes go (the host's); kit is what their define(kit) gets.
	constructor({ scope, kit }) {
		this.scope = scope;
		this.kit = kit;
		this.agents = new Map();
	}
	// Registers the agent msg is, replacing one with its id. Throws, saying why, when the
	// message isn't an agent, its query doesn't parse or its module doesn't define one.
	async register(msg, { builtin = false } = {}) {
		const parts = unpackAgent(msg);
		const { id, query } = parts.manifest;
		try {
			queries.parse(query);
		} catch (error) {
			throw new Error(`the agent's query doesn't parse: ${error.message}`);
		}
		const def = await defineAgent(parts.module, this.kit);
		const scope = this.scope.enter(scopeName(id));
		scope.register(def.components);
		scope.registerAskHandlers(def.asks ?? {});
		const agent = { ...parts, id, message: msg, def, scope, builtin };
		this.agents.set(id, agent);
		return agent;
	}
	get(id) {
		return this.agents.get(id);
	}
	list() {
		return [...this.agents.values()];
	}
	// The agents whose query matches msg, with the bindings of the first match, and the ones
	// that don't. isAgent: msg is itself an agent, to install.
	match(msg) {
		const matches = [];
		const misses = [];
		for (const agent of this.agents.values()) {
			const found = queries.match(agent.manifest.query, msg);
			if (found === undefined) misses.push(agent);
			else matches.push({ agent, bindings: found.bindings });
		}
		return { matches, misses, isAgent: queries.test(AGENT_QUERY, msg) };
	}
	sample(agent, id = EMPTY_SAMPLE) {
		const sample = agent.samples.find((s) => s.id === id);
		if (sample === undefined) throw new Error(`${agent.manifest.title} has no sample "${id}"`);
		return sample.message;
	}
	// The agent's root component for msg. The bindings are its query's on msg; the empty sample
	// needn't match, so it decodes with none.
	open(agent, msg, bindings = queries.match(agent.manifest.query, msg)?.bindings ?? new Map()) {
		return agent.def.decode(agent.scope.components, Object.fromEntries(bindings), msg);
	}
	encode(agent, root, original) {
		return agent.def.encode(root, original);
	}
}

// What the launcher shows of an agent.
export const agentInfo = (agent) => ({
	id: agent.id,
	title: agent.manifest.title,
	description: agent.manifest.description ?? "",
	needs: agent.manifest.needs ?? "",
	icon: agent.manifest.icon ?? "🧩",
	samples: agent.samples.map((s) => s.id).filter((id) => id !== EMPTY_SAMPLE),
	builtin: agent.builtin,
});

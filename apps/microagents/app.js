// Sets the micro-agents app up on a host: registers the built-in agents (packed from their
// folders with readText) and the installed ones (from store), answers the app's asks and
// tells the root which agents there are.
import { createAppAsks } from "./core/app-asks.js";
import { packAgent } from "./core/pack.js";
import { AgentRegistry } from "./core/registry.js";
import { decodeMessage } from "./core/tdata.js";
import { shellComponents } from "./index.js";
import { makeKit } from "./kit.js";

export { shellComponents };
export const BUILTIN_AGENTS = [
	"agent-builder",
	"regex-lab",
	"json-schema-lab",
	"jsonpath-lab",
	"jsonpointer-lab",
	"jq-lab",
	"tq-lab",
	"glob-lab",
	"vega-lite-lab",
	"echarts-lab",
	"css-layout-lab",
	"cron-lab",
	"datefmt-lab",
	"blockkit-lab",
];
// Where the built-in agents' folders are, for readText: path relative to it → its text.
export const AGENTS_URL = new URL("./agents/", import.meta.url);

// A store that keeps nothing between runs, for tests and pages without storage.
export const memoryStore = () => {
	const agents = new Map();
	let model = null;
	return {
		installed: () => [...agents.values()],
		save: (id, text) => agents.set(id, text),
		remove: (id) => agents.delete(id),
		model: () => model,
		setModel: (m) => {
			model = m;
		},
	};
};

// Starts host on the app, once the agents are registered; returns { registry, asks }.
export const startApp = async ({
	host,
	readText,
	llm,
	store = memoryStore(),
	files,
	builtins = BUILTIN_AGENTS,
}) => {
	const registry = new AgentRegistry({ scope: host.scope, kit: makeKit() });
	for (const id of builtins)
		await registry.register(await packAgent(readText, id), { builtin: true });
	for (const text of store.installed()) {
		try {
			await registry.register(decodeMessage(text));
		} catch (error) {
			console.warn("an installed agent didn't load", error);
		}
	}
	const { asks, cards } = createAppAsks({ host, registry, llm, store, files });
	host.scope.registerAskHandlers(asks);
	if (host.root === null) host.start(host.scope.components.MicroAgentApp({ agents: cards() }));
	else host.send("setAgents", [cards()]);
	return { registry, asks };
};

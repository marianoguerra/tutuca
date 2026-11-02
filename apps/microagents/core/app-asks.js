// The asks the micro-agents app makes, answered with the registry, the live host, the model
// client and a store for installed agents and the chosen model:
//   store: { installed() → [tdata JSON text], save(id, text), remove(id), model(), setModel(m) }
//   files: { saveText(name, text, type), saveBytes(name, bytes, type) }

import { jsonViewArgs } from "../ui.js";
import { agentPrompt } from "./loop.js";
import { EMPTY_SAMPLE, unpackAgent } from "./pack.js";
import { agentInfo } from "./registry.js";
import { skillsIndex } from "./shared-tools.js";
import { decodeFile, encodeMessage, encodeMessageCbor } from "./tdata.js";
import { hostEnv, runToolCall, sessionWorkspace } from "./tool-runner.js";
import { toolsFor } from "./tool-schema.js";

const fileName = (s) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "data";

export const createAppAsks = ({ host, registry, llm, store, files }) => {
	const C = () => host.scope.components;
	const cards = () => registry.list().map((agent) => C().AgentCard(agentInfo(agent)));
	// An open agent: its shell (the session, keyed by its id in the app's sessions) and agent.
	const session = (id) => {
		const shell = host.root?.sessions?.[id];
		const agent = shell && registry.get(shell.agentId);
		if (!agent) throw new Error(`no open agent ${id}`);
		return { shell, agent };
	};
	// The AbortController of each session's inference step in flight, by session id.
	const inflight = new Map();
	let sessions = 0;

	const shellFor = async (agent, msg, source, bindings) => {
		const workspace = registry.open(agent, msg, bindings);
		const models = await llm.models().catch(() => []);
		const ids = models.map((m) => `${m.provider}/${m.id}`);
		const remembered = store.model();
		const paths = Object.keys(agent.skills);
		const sessionId = `s${++sessions}-${agent.id}`;
		const toolSpecs = toolsFor(agent, workspace);
		return C().AgentShell({
			sessionId,
			agentId: agent.id,
			title: agent.manifest.title,
			icon: agent.manifest.icon ?? "🧩",
			source,
			original: msg,
			workspace,
			tab: models.length > 0 ? "chat" : "tools",
			chat: C().ChatPanel({
				models,
				model: ids.includes(remembered) ? remembered : (ids[0] ?? ""),
				checked: true,
			}),
			prompt: agentPrompt(agent.prompt, skillsIndex(agent.skills)),
			toolSpecs,
			tools: toolSpecs.map((tool) =>
				C().ToolCard({
					sessionId,
					name: tool.name,
					kind: agent.tools.find((x) => x.name === tool.name)?.kind ?? "shared",
					description: tool.description,
					schemaText: JSON.stringify(tool.parameters.properties, null, 1),
					schema: C().JsonView(jsonViewArgs(tool.parameters.properties, { label: "Parameters" })),
					argsText: JSON.stringify(
						Object.fromEntries(Object.keys(tool.parameters.properties).map((k) => [k, ""])),
					),
				}),
			),
			skills: agent.skills,
			skillPath: paths.includes("SKILL.md") ? "SKILL.md" : (paths[0] ?? ""),
			toolViews: agent.def.toolViews ?? {},
		});
	};
	const choice = (agent, detail) =>
		C().Choice({
			id: agent.id,
			title: agent.manifest.title,
			icon: agent.manifest.icon ?? "🧩",
			detail,
		});
	const bound = (bindings) =>
		[...bindings]
			.map(
				([name, v]) =>
					`$${name}: ${Array.isArray(v) ? `${v.length} part${v.length === 1 ? "" : "s"}` : "1"}`,
			)
			.join(", ");

	const asks = {
		openAgent: ([id, sample = EMPTY_SAMPLE]) => {
			const agent = registry.get(id);
			if (agent === undefined) throw new Error(`no agent ${id}`);
			const source = sample === EMPTY_SAMPLE ? "new" : `sample: ${sample}`;
			return shellFor(agent, registry.sample(agent, sample), source);
		},
		// A dropped File, or { name, text }: { shell } when one agent opens it, { picker } otherwise.
		dropped: async ([file]) => {
			const read =
				typeof file.text === "string"
					? file
					: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
			const msg = decodeFile(read);
			const { matches, misses, isAgent } = registry.match(msg);
			if (!isAgent && matches.length === 1) {
				return { shell: await shellFor(matches[0].agent, msg, read.name, matches[0].bindings) };
			}
			let agent = null;
			if (isAgent) {
				const parts = unpackAgent(msg);
				const installed = registry.get(parts.manifest.id);
				agent = {
					title: parts.manifest.title,
					id: parts.manifest.id,
					version: String(parts.manifest.version ?? ""),
					needs: parts.manifest.needs ?? "",
					tools: parts.tools.map((x) => x.name),
					moduleSize: new TextEncoder().encode(parts.module).length,
					replaces: installed === undefined ? "" : String(installed.manifest.version ?? "?"),
				};
			}
			return {
				picker: C().Picker({
					file: read.name,
					message: msg,
					choices: matches.map((m) => choice(m.agent, bound(m.bindings))),
					misses: misses.map((a) => choice(a, a.manifest.needs ?? "")),
					agent,
				}),
			};
		},
		openWith: ([id, msg, file]) => {
			const agent = registry.get(id);
			if (agent === undefined) throw new Error(`no agent ${id}`);
			return shellFor(agent, msg, file);
		},
		installAgent: async ([msg]) => {
			const agent = await registry.register(msg);
			store.save(agent.id, encodeMessage(msg));
			// Installs from inside an agent (the Agent Builder) update the launcher too.
			host.send("setAgents", [cards()]);
			return { agents: cards(), title: agent.manifest.title };
		},
		uninstallAgent: ([id]) => {
			if (registry.get(id)?.builtin) throw new Error("built-in agents can't be removed");
			registry.agents.delete(id);
			store.remove(id);
			return { agents: cards() };
		},
		runTool: ([id, call]) => {
			const { shell, agent } = session(id);
			return runToolCall(hostEnv(host, sessionWorkspace(id)), agent, shell.original, call);
		},
		llmModels: async () => ({ models: await llm.models(), remembered: store.model() }),
		rememberModel: ([model]) => store.setModel(model),
		// Copy buttons (JsonView): the page's clipboard, or files.copyText where there's none.
		copyText: async ([text]) => {
			if (files.copyText) await files.copyText(text);
			else await globalThis.navigator?.clipboard?.writeText(text);
			return true;
		},
		// One inference step of session id. The request carries all of it (stepRequest in
		// loop.js), so this only passes it on; a new step of a session aborts its old one.
		infer: async ([id, request]) => {
			inflight.get(id)?.abort();
			const controller = new AbortController();
			inflight.set(id, controller);
			try {
				return await llm.complete(request, controller.signal);
			} finally {
				if (inflight.get(id) === controller) inflight.delete(id);
			}
		},
		abortInfer: ([id]) => {
			inflight.get(id)?.abort();
			inflight.delete(id);
			return true;
		},
		// "preview": the export's canonical JSON; "json" or "cbor": also saved as a file.
		exportData: ([id, format]) => {
			const { shell, agent } = session(id);
			const msg = registry.encode(agent, shell.workspace, shell.original);
			const text = encodeMessage(msg);
			const name = fileName(msg.id || agent.id);
			if (format === "json") files.saveText(`${name}.tdata.json`, text, "application/json");
			if (format === "cbor")
				files.saveBytes(`${name}.tdata.cbor`, encodeMessageCbor(msg), "application/cbor");
			return text;
		},
	};
	return { asks, cards };
};

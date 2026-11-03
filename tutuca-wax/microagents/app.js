// What the shell (microagents.tcd's MicroAgents) asks its host for, with no
// DOM: the agents (built in, and installed ones kept by store), opening a
// sample or a dropped JSON document with one, each session's conversation
// with the model and its tool calls, exporting, installing. main.js is the
// page around it; tests drive it headless with a scripted client (llm.js).
//
// A session's transcript (pi-ai's messages) is the host's; the shell's
// Session shows its lines, which the host sends it (set_chat) as it goes.

import { agentMeta, fits, loadAgent, mismatchText, openWith } from "./agent.js";
import { agentPrompt, nextAction, stepRequest, textOf, toolCallsOf, userMessage } from "./loop.js";
import { hostEnv, runToolCall, skillsIndex, toolsFor } from "./tools.js";

// The longest a tool result shows in the chat.
const CHAT_CLIP = 2000;
const clipText = (text, n = CHAT_CLIP) => (text.length <= n ? text : `${text.slice(0, n)}…`);

// The chat's lines for a transcript: what the user and the model said, and
// each tool call with what it answered.
export function chatRows(transcript) {
	const rows = [];
	const calls = new Map();
	for (const msg of transcript) {
		if (msg.role === "user") rows.push({ kind: "user", title: "", text: textOf(msg), error: false });
		if (msg.role === "assistant") {
			const text = textOf(msg).trim();
			if (text !== "") rows.push({ kind: "assistant", title: "", text, error: false });
			for (const c of toolCallsOf(msg)) {
				const row = { kind: "tool", title: `${c.name}(${clipText(JSON.stringify(c.arguments ?? {}), 120)})`, text: "running…", error: false };
				calls.set(c.id, row);
				rows.push(row);
			}
			if (msg.stopReason === "error" || msg.stopReason === "aborted") {
				rows.push({ kind: "note", title: "", text: msg.errorMessage ?? msg.stopReason, error: true });
			}
		}
		if (msg.role === "toolResult") {
			const row = calls.get(msg.toolCallId);
			if (row) {
				row.text = clipText(textOf(msg));
				row.error = msg.isError === true;
			}
		}
	}
	return rows;
}

// The app: tw (js/tutuca-rt.js's load), base (the scope the kit is loaded
// in, which agents' scopes hang from), shellScope (where Session is),
// client (llm.js), store ({ all(), put({ id, wasm }), delete(id) }, the
// installed agents), builtins ([{ id, bytes }]), loads(id) → whether to
// load the agent id at the start (built in or installed), model() → the model picked,
// download(name, text) and say(text) for the page.
export async function createApp({ tw, base, shellScope, client, store = null, builtins = [], loads = () => true, download = () => {}, rememberModel = () => {} }) {
	const { runtime } = tw;
	const agents = new Map(); // id → { meta, scope, problems, builtin, bytes }
	const sessions = new Map(); // id → { id, agent, transcript, prompt, abort }
	let host = null;
	let dropped = null; // the JSON document dropped last
	let opened = 0;
	let model = "";

	const tell = (name, ...args) => queueMicrotask(() => host?.send(name, args));
	const say = (text) => tell("say", text);
	const sessionIndex = (id) => runtime.get(host.root(), "sessions").findIndex((s) => runtime.get(s, "id") === id);
	const tellSession = (id, name, ...args) =>
		queueMicrotask(() => {
			const i = sessionIndex(id);
			if (i >= 0) host.sendAt([["sessions", i]], name, args);
		});

	// The agents as the shell lists them: its AgentCards.
	const agentRows = () =>
		[...agents.values()].map(({ meta, problems }) => runtime.make(shellScope, "AgentCard", {
			id: meta?.id ?? "?",
			title: meta?.title ?? "?",
			description: meta?.description ?? "",
			needs: meta?.needs ?? "",
			icon: meta?.icon ?? "🤖",
			samples: Object.keys(meta?.samples ?? {}).map((name) => ({ name })),
			problems: problems.join("; "),
		}));

	const add = async (bytes, builtin) => {
		const agent = await loadAgent(tw, bytes, base);
		if (agent.meta === null) throw new Error("it isn't a micro-agent: it has no microagent section");
		if (agents.has(agent.meta.id)) runtime.leave(base, `agent:${agent.meta.id}`);
		agents.set(agent.meta.id, { ...agent, builtin, bytes });
		return agents.get(agent.meta.id);
	};
	for (const { id, bytes } of builtins) if (loads(id)) await add(bytes, true);
	for (const { id, wasm } of (await store?.all()) ?? []) {
		if (!loads(id)) continue;
		try {
			await add(wasm, false);
		} catch (error) {
			console.warn("an installed agent doesn't load:", error);
		}
	}

	// A session of agent on json: the shell's Session, its workspace the
	// agent's root made from json.
	const open = (agentId, json) => {
		const agent = agents.get(agentId);
		if (!agent) throw new Error(`there's no agent ${agentId}`);
		if (agent.problems.length > 0) throw new Error(`${agentId} has problems: ${agent.problems.join("; ")}`);
		const fit = fits(tw, agent, json);
		if (!fit.ok) throw new Error(`${agent.meta.title} opens ${agent.meta.needs}: ${mismatchText(fit)}`);
		const workspace = openWith(tw, agent, json);
		const id = `s${++opened}`;
		sessions.set(id, {
			id,
			agent,
			transcript: [],
			prompt: agentPrompt(agent.meta.prompt, skillsIndex(agent.meta.skills)),
			abort: null,
		});
		return runtime.make(shellScope, "Session", {
			id,
			agent: agentId,
			title: agent.meta.title,
			icon: agent.meta.icon ?? "🤖",
			workspace,
			chat: [],
			draft: "",
			busy: false,
			stopped: "",
		});
	};

	// The env a session's tools run in: its workspace in the shell's state.
	const envOf = (id) => {
		const i = sessionIndex(id);
		return hostEnv(runtime, host, [["sessions", i], "workspace"]);
	};

	// The model's turns on session id until it's done or stopped.
	const infer = async (id, text) => {
		const s = sessions.get(id);
		if (!s) throw new Error(`no session ${id}`);
		if (model === "") throw new Error("pick a model first");
		s.transcript.push(userMessage(text));
		s.abort = new AbortController();
		const update = (busy, stopped = "") => tellSession(id, "set_chat", chatRows(s.transcript), busy, stopped);
		update(true);
		try {
			while (true) {
				const next = nextAction(s.transcript);
				if (next.kind === "idle") {
					update(false, next.reason);
					return true;
				}
				const env = envOf(id);
				if (next.kind === "tools") {
					for (const call of next.calls) {
						s.transcript.push(await runToolCall(runtime, env, s.agent, call));
						update(true);
					}
					continue;
				}
				const root = env.root();
				const request = stepRequest({
					model,
					prompt: s.prompt,
					summary: runtime.get(root, "summary"),
					tools: toolsFor(runtime, s.agent, root),
					transcript: s.transcript,
				});
				const message = await client.complete(request, s.abort.signal);
				s.transcript.push(message);
				update(true);
			}
		} catch (error) {
			const stopped = s.abort.signal.aborted ? "stopped" : (error?.message ?? String(error));
			update(false, stopped);
			return true;
		} finally {
			s.abort = null;
		}
	};

	const asks = {
		open_sample: (agentId, sample) => {
			const json = agents.get(agentId)?.meta.samples?.[sample];
			if (json === undefined) throw new Error(`${agentId} has no sample ${sample}`);
			return open(agentId, structuredClone(json));
		},
		open_dropped: (agentId) => {
			if (dropped === null) throw new Error("nothing was dropped");
			return open(agentId, dropped);
		},
		// Starts the turns and answers at once: the tool calls wait for the
		// host to settle, which an ask still in flight would keep it from.
		infer: (id, text) => {
			if (model === "") throw new Error("pick a model first");
			infer(id, text);
			return true;
		},
		stop_infer: (id) => {
			sessions.get(id)?.abort?.abort();
			return true;
		},
		export_data: (id) => {
			const s = sessions.get(id);
			if (!s) return false;
			download(`${s.agent.meta.id}.json`, `${JSON.stringify(runtime.get(envOf(id).root(), "data"), null, "\t")}\n`);
			return true;
		},
		remember_model: (m) => {
			model = m;
			rememberModel(m);
			return true;
		},
		uninstall: async (agentId) => {
			const agent = agents.get(agentId);
			if (!agent) return false;
			if (agent.builtin) {
				say(`${agent.meta.title} is built in: it can't be removed`);
				return false;
			}
			await store?.delete(agentId);
			agents.delete(agentId);
			runtime.leave(base, `agent:${agentId}`);
			tell("set_agents", agentRows());
			say(`removed ${agent.meta.title}`);
			return true;
		},
	};

	return {
		agents,
		sessions,
		asks,
		agentRows,
		setModel: (m) => {
			model = m;
		},
		// The shell's host, once it's made.
		attach: (h) => {
			host = h;
		},
		// A JSON document dropped (or picked): opened with the agent it fits,
		// offered to pick one when it fits several, or why none fits.
		dropJson: (json) => {
			const fitting = [...agents.values()].filter((a) => a.problems.length === 0 && fits(tw, a, json).ok);
			dropped = json;
			if (fitting.length === 0) {
				const needs = [...agents.values()].map((a) => `${a.meta.title} opens ${a.meta.needs}`).join("; ");
				say(`no agent opens this file. ${needs}`);
				return [];
			}
			if (fitting.length === 1) {
				const session = asks.open_dropped(fitting[0].meta.id);
				queueMicrotask(() => {
					host.send("say", [""]);
					host.send("add_session", [session]);
				});
				return fitting;
			}
			tell(
				"offer",
				fitting.map((a) => ({ id: a.meta.id, title: a.meta.title, icon: a.meta.icon ?? "🤖" })),
			);
			return fitting;
		},
		// A .wasm dropped: installed when it's an agent.
		dropWasm: async (bytes) => {
			const meta = agentMeta(bytes);
			if (meta === null) {
				say("that .wasm isn't a micro-agent: it has no microagent section");
				return null;
			}
			const agent = await add(bytes, false);
			if (agent.problems.length === 0) await store?.put({ id: meta.id, wasm: bytes });
			tell("set_agents", agentRows());
			say(agent.problems.length === 0 ? `installed ${meta.title}` : `${meta.title} has problems: ${agent.problems.join("; ")}`);
			return agent;
		},
	};
}

// What the shell (microagents.tutuca.ts's MicroAgents) asks its page for, with no DOM: the
// agents (built in, and installed ones kept by store), opening a sample or a dropped JSON
// document with one, each session's conversation with the model and its tool calls, exporting,
// installing. main.js is the page around it; tests drive it headless with a scripted client
// (llm.js).
//
// A session's transcript (pi-ai's messages) is the page's; the shell's Session shows its lines,
// which the page sends it (setChat) as it goes.
import { fits, loadAgent, mismatchText, parsePackage, rootFrom } from "./agent.js";
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
		if (msg.role === "user")
			rows.push({ kind: "user", title: "", text: textOf(msg), error: false });
		if (msg.role === "assistant") {
			const text = textOf(msg).trim();
			if (text !== "") rows.push({ kind: "assistant", title: "", text, error: false });
			for (const c of toolCallsOf(msg)) {
				const row = {
					kind: "tool",
					title: `${c.name}(${clipText(JSON.stringify(c.arguments ?? {}), 120)})`,
					text: "running…",
					error: false,
				};
				calls.set(c.id, row);
				rows.push(row);
			}
			if (msg.stopReason === "error" || msg.stopReason === "aborted") {
				rows.push({
					kind: "note",
					title: "",
					text: msg.errorMessage ?? msg.stopReason,
					error: true,
				});
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

/** The scope the shell's components are registered in. */
export const SHELL = ["shell"];

/**
 * The app: tutuca (a runtime with the kit loaded at its base and the shell in SHELL), kit (the
 * kit module's text, for the agents to import from), client (llm.js), store ({ all(),
 * put({ id, package }), delete(id) }, the installed agents), builtins (packages), loads(id) →
 * whether to load the agent id at the start, download(name, text) and rememberModel(model) for
 * the page.
 */
export async function createApp({
	tutuca,
	kit,
	client,
	store = null,
	builtins = [],
	loads = () => true,
	download = () => {},
	rememberModel = () => {},
}) {
	const agents = new Map(); // id → { meta, scope, definitions, problems, builtin }
	const sessions = new Map(); // id → { id, agent, transcript, prompt, abort }
	let started = false;
	let dropped = null; // the JSON document dropped last
	let opened = 0;
	let model = "";
	// Deferred to a microtask, out of the run that asked.
	const tell = (name, ...args) => queueMicrotask(() => started && tutuca.send(name, args));
	const say = (text) => tell("say", text);
	const sessionIndex = (id) => tutuca.state().sessions.findIndex((s) => s.id === id);
	const pathOf = (id) => [{ item: "sessions", key: sessionIndex(id) }];
	const tellSession = (id, name, ...args) =>
		queueMicrotask(() => {
			if (sessionIndex(id) >= 0) tutuca.send(name, args, { to: pathOf(id) });
		});
	// The agents as the shell lists them: its AgentCards.
	const agentRows = () =>
		[...agents.values()].map(({ meta, problems }) => ({
			$make: "AgentCard",
			fields: {
				id: meta?.id ?? "?",
				title: meta?.title ?? "?",
				description: meta?.description ?? "",
				needs: meta?.needs ?? "",
				icon: meta?.icon ?? "🤖",
				samples: Object.keys(meta?.samples ?? {}).map((name) => ({ name })),
				problems: problems.join("; "),
			},
		}));
	const add = async (pkg, builtin) => {
		const agent = await loadAgent(tutuca, pkg, kit);
		agents.set(pkg.id, { ...agent, builtin });
		return agents.get(pkg.id);
	};
	for (const pkg of builtins) if (loads(pkg.id)) await add(pkg, true);
	for (const record of (await store?.all()) ?? []) {
		if (!loads(record.id)) continue;
		try {
			await add(record.package, false);
		} catch (error) {
			console.warn("an installed agent doesn't load:", error);
		}
	}
	// A session of an agent on json: the shell's Session, its workspace the agent's root made
	// from json.
	const open = (agentId, json) => {
		const agent = agents.get(agentId);
		if (!agent) throw new Error(`there's no agent ${agentId}`);
		if (agent.problems.length > 0) {
			throw new Error(`${agentId} has problems: ${agent.problems.join("; ")}`);
		}
		const fit = fits(tutuca, agent, json);
		if (!fit.ok) {
			throw new Error(`${agent.meta.title} opens ${agent.meta.needs}: ${mismatchText(fit)}`);
		}
		const id = `s${++opened}`;
		sessions.set(id, {
			id,
			agent,
			transcript: [],
			prompt: agentPrompt(agent.meta.prompt, skillsIndex(agent.meta.skills)),
			abort: null,
		});
		return {
			$make: "Session",
			fields: {
				id,
				agent: agentId,
				title: agent.meta.title,
				icon: agent.meta.icon ?? "🤖",
				workspace: rootFrom(agent, json),
				chat: [],
				draft: "",
				busy: false,
				stopped: "",
			},
		};
	};
	// The env a session's tools run in: its workspace in the shell's state.
	const envOf = (id) => hostEnv(tutuca, [...pathOf(id), "workspace"]);
	// The model's turns on a session until it's done or stopped.
	const infer = async (id, text) => {
		const s = sessions.get(id);
		if (!s) throw new Error(`no session ${id}`);
		if (model === "") throw new Error("pick a model first");
		s.transcript.push(userMessage(text));
		s.abort = new AbortController();
		const update = (busy, stopped = "") =>
			tellSession(id, "setChat", chatRows(s.transcript), busy, stopped);
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
						s.transcript.push(await runToolCall(env, s.agent, call));
						update(true);
					}
					continue;
				}
				const request = stepRequest({
					model,
					prompt: s.prompt,
					summary: env.get("summary"),
					tools: toolsFor(s.agent),
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
	// What the shell asks: each takes the ask's arguments.
	const asks = {
		openSample: ([agentId, sample]) => {
			const json = agents.get(agentId)?.meta.samples?.[sample];
			if (json === undefined) throw new Error(`${agentId} has no sample ${sample}`);
			return open(agentId, structuredClone(json));
		},
		openDropped: ([agentId]) => {
			if (dropped === null) throw new Error("nothing was dropped");
			return open(agentId, dropped);
		},
		// Starts the turns and answers at once: the tool calls wait for the runtime to be idle,
		// which an ask still in flight would keep it from.
		infer: ([id, text]) => {
			if (model === "") throw new Error("pick a model first");
			void infer(id, text);
			return true;
		},
		stopInfer: ([id]) => {
			sessions.get(id)?.abort?.abort();
			return true;
		},
		exportData: ([id]) => {
			const s = sessions.get(id);
			if (!s) return false;
			download(`${s.agent.meta.id}.json`, `${JSON.stringify(envOf(id).get("data"), null, "\t")}\n`);
			return true;
		},
		rememberModel: ([m]) => {
			model = m;
			rememberModel(m);
			return true;
		},
		uninstall: async ([agentId]) => {
			const agent = agents.get(agentId);
			if (!agent) return false;
			if (agent.builtin) {
				say(`${agent.meta.title} is built in: it can't be removed`);
				return false;
			}
			await store?.delete(agentId);
			agents.delete(agentId);
			if (agent.scope !== null) tutuca.leave(agent.scope);
			tell("setAgents", agentRows());
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
		/** Once the shell's root is started: what the app tells it reaches it from now on. */
		attach: () => {
			started = true;
		},
		/**
		 * A JSON document dropped (or picked): opened with the agent it fits, offered to pick one
		 * when it fits several, or why none fits.
		 */
		dropJson: (json) => {
			const usable = [...agents.values()].filter((a) => a.problems.length === 0);
			const fitting = usable.filter((a) => fits(tutuca, a, json).ok);
			dropped = json;
			if (fitting.length === 0) {
				const needs = usable.map((a) => `${a.meta.title} opens ${a.meta.needs}`).join("; ");
				say(`no agent opens this file. ${needs}`);
				return [];
			}
			if (fitting.length === 1) {
				const session = asks.openDropped([fitting[0].meta.id]);
				queueMicrotask(() => {
					tutuca.send("say", [""]);
					tutuca.send("addSession", [session]);
				});
				return fitting;
			}
			const offered = fitting.map((a) => ({
				id: a.meta.id,
				title: a.meta.title,
				icon: a.meta.icon ?? "🤖",
			}));
			tell("offer", offered);
			return fitting;
		},
		/** An agent's package dropped (its text): installed when it is one. */
		dropPackage: async (text) => {
			const pkg = parsePackage(text);
			if (pkg === null) return null;
			const agent = await add(pkg, false);
			if (agent.problems.length === 0) await store?.put({ id: pkg.id, package: pkg });
			tell("setAgents", agentRows());
			say(
				agent.problems.length === 0
					? `installed ${pkg.title}`
					: `${pkg.title} has problems: ${agent.problems.join("; ")}`,
			);
			return agent;
		},
	};
}

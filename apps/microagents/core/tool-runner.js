// Runs a tool call against an agent's root, as a pi-ai ToolResultMessage. Message tools run the
// handler a button would: a pure one is applied to the root at once, any other is sent and
// waited for. View tools run one of the root's queries, module tools run a function of the
// agent's module on the root's domain, and shared tools read the skills and the export. env
// reaches the live root: { root() → the root now, apply(name, args) and query(name, args),
// synchronous, throwing a ContractError, and send(name, args) → Promise<{ error? }> once the
// message and what it started are done }.
import {
	ContractError,
	DispatchPath,
	Selector,
	scopeOf,
	specOf,
	typeText,
} from "../../../src/tutuca.js";
import { jsonTextKind } from "../lib/json.js";
import { clip, SHARED_NAMES, skillsList, skillsRead } from "./shared-tools.js";
import { encodeMessage } from "./tdata.js";
import { argsFor, handlerOf, paramsOf } from "./tool-schema.js";

const text = (v) => (typeof v === "string" ? v : (JSON.stringify(v, jsonSafe, 1) ?? "null"));
const jsonSafe = (_k, v) =>
	typeof v === "bigint" ? Number(v) : v instanceof Map ? Object.fromEntries(v) : v;
const failed = (message) => ({ value: message, isError: true });
const isErrorResult = (v) =>
	v !== null && typeof v === "object" && !Array.isArray(v) && "error" in v;

// The first t.any() argument the model sent as JSON text for an object or an array, which is
// what most failed preconditions on such arguments come down to: { name, kind } or undefined.
const jsonTextArg = (args, types = [], names = []) => {
	for (const [i, type] of types.entries()) {
		const kind = type?.constructor.kind === "any" ? jsonTextKind(args[i]) : "";
		if (kind !== "") return { name: names[i] ?? `${i}`, kind };
	}
};
// A failed precondition, in the handler's words (its why) when it has them, else naming an
// argument sent as JSON text when there is one.
const preFailure = (name, why, args, types, names) => {
	const text = why === "" ? jsonTextArg(args, types, names) : undefined;
	if (text !== undefined) {
		return failed(
			`${name} can't run with these arguments now: ${text.name} is a string holding JSON text for an ${text.kind}; send the ${text.kind} itself as the argument's value, not encoded as a string`,
		);
	}
	return failed(
		why === ""
			? `${name} can't run with these arguments now (its precondition doesn't hold): check its ids and pointers against the state`
			: `${name} can't run with these arguments now: ${why}`,
	);
};
// What the model reads for a ContractError of the operation name, whose args have types (or
// undefined) and names.
const contractFailure = (error, name, args, types, names) => {
	const [code] = error.issues;
	if (code === "args") {
		return failed(`${name} takes ${types?.length ?? "other"} arguments (${names.join(", ")})`);
	}
	if (code.startsWith("arg:")) {
		const i = Number(code.slice(4));
		return failed(
			`argument ${names[i] ?? i} is ${JSON.stringify(args[i])}, which isn't a ${typeText(types[i])}`,
		);
	}
	if (code === "pre") return preFailure(name, error.detail, args, types, names);
	if (code === "post") {
		return failed(`${name} was undone: its postcondition doesn't hold for what it made`);
	}
	if (code.startsWith("invariant:")) {
		return failed(`${name} was undone: it would break ${code.slice(10)}`);
	}
	if (code === "unknown") return failed(`the agent's root has no ${name}`);
	return failed(`${name}: ${error.message}`);
};
// The value of the root's query name for args, or what the model reads if it fails.
const runQuery = (env, name, args, names = []) => {
	try {
		return { value: env.query(name, args) };
	} catch (error) {
		if (!(error instanceof ContractError)) throw error;
		const types = specOf(env.root())?.queries?.[name]?.args;
		return contractFailure(error, name, args, types, names);
	}
};
// The tool's result: the root query it names, the summary by default.
const resultOf = (env, tool) => runQuery(env, tool.result ?? "summary", []).value;

const runMessage = async (env, tool, call) => {
	const prev = env.root();
	const spec = handlerOf(prev, tool.name);
	if (spec === undefined) return failed(`the agent's root has no handler ${tool.name}`);
	const args = argsFor(tool, call.arguments);
	const names = paramsOf(tool).map((p) => p.name);
	if (spec.pure) {
		try {
			env.apply(tool.name, args);
		} catch (error) {
			if (!(error instanceof ContractError)) throw error;
			return contractFailure(error, tool.name, args, spec.args, names);
		}
		const next = env.root();
		return { value: resultOf(env, tool), changed: next !== prev };
	}
	if (spec.args !== undefined) {
		if (spec.args.length !== args.length) {
			return failed(`${tool.name} takes ${spec.args.length} arguments (${names.join(", ")})`);
		}
		for (const [i, type] of spec.args.entries()) {
			if (!type.isValid(args[i], scopeOf(prev), prev)) {
				return failed(
					`argument ${names[i] ?? i} is ${JSON.stringify(args[i])}, which isn't a ${typeText(type)}`,
				);
			}
		}
	}
	if (spec.pre !== undefined && !holds(() => spec.pre.call(prev, prev, args, {}))) {
		return preFailure(tool.name, spec.why?.call(prev, prev, args) ?? "", args, spec.args, names);
	}
	const { error } = await env.send(tool.name, args);
	if (error !== undefined) return failed(`${tool.name} failed: ${error}`);
	const next = env.root();
	if (spec.post !== undefined && !holds(() => spec.post.call(prev, prev, next, args, {}))) {
		return {
			value: `${tool.name} ran, but its postcondition doesn't hold: the result may be wrong`,
			isError: true,
			changed: next !== prev,
		};
	}
	return { value: resultOf(env, tool), changed: next !== prev };
};
const holds = (fn) => {
	try {
		return Boolean(fn());
	} catch {
		return false;
	}
};

const runModule = async (env, agent, tool, call) => {
	const fn = agent.def.tools?.[tool.name];
	if (typeof fn !== "function")
		return failed(`the agent's module has no tool function ${tool.name}`);
	const root = env.root();
	const out = await fn(
		typeof root.toDomain === "function" ? root.toDomain() : null,
		call.arguments ?? {},
	);
	if (out?.domain === undefined) return { value: out?.result ?? null };
	const { error } = await env.send("replace_domain", [out.domain]);
	if (error !== undefined)
		return failed(`${tool.name} made new data, but replace_domain failed: ${error}`);
	return { value: out.result ?? resultOf(env, {}), changed: true };
};

const runShared = (env, agent, original, call) => {
	const args = call.arguments ?? {};
	const root = env.root();
	switch (call.name) {
		case "skills_list":
			return { value: skillsList(agent.skills, args.dir ?? "") };
		case "skills_read":
			return { value: skillsRead(agent.skills, args.path ?? "") };
		case "get_state":
			return {
				value: typeof root.toDomain === "function" ? root.toDomain() : resultOf(env, {}),
			};
		case "export_preview":
			return { value: encodeMessage(agent.def.encode(root, original)) };
	}
};

// The ToolResultMessage for call ({ id, name, arguments }) on agent, whose data came from
// original; changed says whether the root changed.
export const runToolCall = async (env, agent, original, call) => {
	let out;
	try {
		if (SHARED_NAMES.has(call.name)) out = runShared(env, agent, original, call);
		else {
			const tool = agent.tools.find((x) => x.name === call.name);
			if (tool === undefined) out = failed(`there is no tool ${call.name}`);
			else if (tool.kind === "message") out = await runMessage(env, tool, call);
			else if (tool.kind === "module") out = await runModule(env, agent, tool, call);
			else {
				const names = paramsOf(tool).map((p) => p.name);
				out = runQuery(env, tool.name, argsFor(tool, call.arguments), names);
			}
		}
	} catch (error) {
		out = failed(`${call.name} threw: ${error?.message ?? error}`);
	}
	const isError = out.isError === true || isErrorResult(out.value);
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: clip(text(out.value)) }],
		details: { changed: out.changed === true },
		isError,
		timestamp: Date.now(),
	};
};

// The env for the root at selector in host's state: apply and query run on it at once; send
// waits until the queue is empty and the asks in flight are back to as many as before it sent
// (the ask running the tool is one of them), and reports the tasks that failed meanwhile.
export const hostEnv = (host, selector, { timeout = 30000 } = {}) => {
	const pathNow = () => new DispatchPath(selector.freeze(host.root));
	return {
		root: () => pathNow().toKeyPath().getIn(host.root),
		apply: (name, args) => host.apply(name, args, { to: selector }),
		query: (name, args) => host.query(name, args, { to: selector }),
		send: async (name, args) => {
			const failures = [];
			const onNotify = host.onNotify;
			host.onNotify = (type, info) => {
				if (type === "taskFailed") failures.push(info.error);
				onNotify(type, info);
			};
			// Called from the ask that runs the tool, which the scheduler counts once its handler
			// returns: a microtask later.
			await null;
			const pending = host.scheduler.pending;
			const start = Date.now();
			try {
				host.send(name, args, { to: selector });
				do {
					await new Promise((resolve) => setTimeout(resolve, 2));
					if (Date.now() - start > timeout)
						return { error: `still running after ${timeout / 1000}s` };
				} while (host.tasks.length > 0 || host.scheduler.pending > pending);
				await new Promise((resolve) => setTimeout(resolve, 0)); // notifies come a tick later
			} finally {
				host.onNotify = onNotify;
			}
			return failures.length > 0
				? { error: failures.map((e) => e?.message ?? String(e)).join("; ") }
				: {};
		},
	};
};

// Where the app keeps the root of the open agent whose session is id.
export const sessionWorkspace = (id) => new Selector().item("sessions", id).field("workspace");

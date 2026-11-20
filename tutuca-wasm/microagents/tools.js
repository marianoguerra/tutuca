// An agent's tools, as the model sees and calls them. Message tools are the root's messages,
// view tools its queries; their parameters are the message's or query's arguments, named and
// typed as the module says (its definitions' type data, made JSON Schemas here). The shell adds
// the shared tools: the skills, the state and the export. A call runs against env, the live
// root wherever the shell keeps it:
//
//   { get(name, args?) → a query's value now, problem(name, args) → why a message can't run
//     now or null, send(name, args) → Promise<{ error? }> once the message and what it started
//     are done, hold() → the root as it is, put(held) puts one back, reports() → the runtime's
//     reports so far }
//
// A message tool is checked first (its arguments against their types, and its when); one that
// fails a check once it ran (ensures, changes, invariants) is undone.

// ---- Types as JSON Schemas ------------------------------------------------------------------

const ANY_JSON = { type: ["object", "array", "string", "number", "integer", "boolean", "null"] };
const bounds = (t, min, max) => ({
	...(t.minLength === undefined ? {} : { [min]: t.minLength }),
	...(t.maxLength === undefined ? {} : { [max]: t.maxLength }),
});

/** A type, as a module's definitions write it ({ type, ... }), as a JSON Schema. */
export function typeSchema(t) {
	switch (t?.type) {
		case "boolean":
			return { type: "boolean" };
		case "number":
			return {
				type: t.int ? "integer" : "number",
				...(t.min === undefined ? {} : { minimum: t.min }),
				...(t.max === undefined ? {} : { maximum: t.max }),
			};
		case "string":
			return {
				type: "string",
				...bounds(t, "minLength", "maxLength"),
				...(t.pattern === undefined ? {} : { pattern: t.pattern }),
			};
		case "enum":
			return { enum: [...t.values] };
		case "option":
			return { anyOf: [typeSchema(t.of), { type: "null" }] };
		case "array":
			return { type: "array", items: typeSchema(t.of), ...bounds(t, "minItems", "maxItems") };
		case "map":
			return { type: "object", additionalProperties: typeSchema(t.of) };
		case "record":
			return {
				type: "object",
				properties: Object.fromEntries(
					Object.entries(t.fields).map(([name, type]) => [name, typeSchema(type)]),
				),
				required: Object.keys(t.fields),
				additionalProperties: false,
			};
		case "oneOf":
			return { anyOf: t.of.map(typeSchema) };
		case "index":
			return { type: ["string", "number"], description: `a key of ${t.keyOf}` };
		default:
			return { ...ANY_JSON };
	}
}

const objectSchema = (args) => ({
	type: "object",
	properties: Object.fromEntries(args.map((a) => [a.name, typeSchema(a.type)])),
	required: args.map((a) => a.name),
});

// ---- The shared tools -----------------------------------------------------------------

export const SHARED_TOOLS = [
	{
		name: "skillsList",
		description: "List the files in the agent's skills folder, or under a directory of it.",
		parameters: {
			type: "object",
			properties: { dir: { type: "string", description: 'A directory, "" for all of them.' } },
			required: ["dir"],
		},
	},
	{
		name: "skillsRead",
		description: "Read a file of the agent's skills folder.",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
	{
		name: "getState",
		description: "The data being worked on, as JSON (long values are cut short).",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		name: "exportPreview",
		description: "The JSON an export would write now.",
		parameters: { type: "object", properties: {}, required: [] },
	},
];
export const SHARED_NAMES = new Set(SHARED_TOOLS.map((t) => t.name));

export const skillsList = (skills, dir = "") => {
	const prefix = dir === "" || dir.endsWith("/") ? dir : `${dir}/`;
	const paths = Object.keys(skills).filter((p) => p.startsWith(prefix));
	return paths.length > 0 ? paths : { error: `no files under "${dir}"` };
};
export const skillsRead = (skills, path) =>
	skills[path] ?? { error: `no file "${path}"; skillsList shows the files` };

// The skills as the system prompt lists them: each file's description, when
// its frontmatter has one, then every path.
export const skillsIndex = (skills) => {
	const paths = Object.keys(skills ?? {});
	if (paths.length === 0) return "";
	const lines = paths.map((p) => {
		const description = /^description:\s*(.+)$/m.exec(skills[p])?.[1];
		return description ? `- ${p}: ${description}` : `- ${p}`;
	});
	return `The skills folder (read files with skillsRead):\n${lines.join("\n")}`;
};

// Text cut to about max characters.
export const clip = (text, max = 8000) =>
	text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;

// ---- The tools of an agent ------------------------------------------------------------------

/** The arguments of a tool of an agent, [{ name, type }]: the message's or the query's. */
export function argsOf(agent, tool) {
	const root = agent.definitions[agent.meta.root];
	if (tool.kind !== "message") return root?.queryArgs?.[tool.name] ?? [];
	const on = root?.on?.[tool.name];
	return (on?.args ?? []).map((type, i) => ({ name: on.names?.[i] ?? `arg${i}`, type }));
}

/** Every tool of an agent, as pi-ai Tools. */
export const toolsFor = (agent) => [
	...agent.meta.tools.map((tool) => ({
		name: tool.name,
		description:
			`${tool.description ?? ""}${tool.kind === "view" ? " (reads, changes nothing)" : ""}`.trim(),
		parameters: objectSchema(argsOf(agent, tool)),
	})),
	...SHARED_TOOLS,
];

// ---- Running a call -------------------------------------------------------------------------

const text = (v) => (typeof v === "string" ? v : (JSON.stringify(v, null, 1) ?? "null"));
const failed = (message) => ({ value: message, isError: true });
const isErrorResult = (v) =>
	v !== null && typeof v === "object" && !Array.isArray(v) && "error" in v;

/** What of a run of reports went wrong, in words. */
export const failuresOf = (reports) =>
	reports.flatMap((r) => [
		...(r.outcome === "failed" || r.type === "renderFailed" ? [r.error ?? `${r.name} failed`] : []),
		...(r.issues ?? []).map((i) =>
			i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason,
		),
	]);

// The positional args for a call's named arguments: a missing one is null.
const argsFrom = (args, named = {}) => args.map((a) => named?.[a.name] ?? null);

const runMessage = async (env, agent, tool, call) => {
	const args = argsFrom(argsOf(agent, tool), call.arguments);
	const problem = env.problem(tool.name, args);
	if (problem !== null) {
		const why =
			problem === "pre"
				? "its condition (its when) doesn't hold now: check the ids it names against the summary"
				: problem;
		return failed(`${tool.name} can't run with these arguments now: ${why}`);
	}
	const held = env.hold();
	const before = JSON.stringify(env.get("data"));
	const seen = env.reports().length;
	const { error } = await env.send(tool.name, args);
	const bad = failuresOf(env.reports().slice(seen));
	if (error !== undefined || bad.length > 0) {
		env.put(held);
		return failed(`${tool.name} was undone: ${[error, ...bad].filter(Boolean).join("; ")}`);
	}
	return {
		value: env.get(tool.result ?? "summary"),
		changed: JSON.stringify(env.get("data")) !== before,
	};
};

const runShared = (env, agent, call) => {
	const args = call.arguments ?? {};
	switch (call.name) {
		case "skillsList":
			return { value: skillsList(agent.meta.skills ?? {}, args.dir ?? "") };
		case "skillsRead":
			return { value: skillsRead(agent.meta.skills ?? {}, args.path ?? "") };
		case "getState":
			return { value: env.get("domain") };
		case "exportPreview":
			return { value: env.get("data") };
	}
};

/** The ToolResultMessage (pi-ai's shape) for a call ({ id, name, arguments }) of an agent in env. */
export async function runToolCall(env, agent, call) {
	let out;
	try {
		if (SHARED_NAMES.has(call.name)) out = runShared(env, agent, call);
		else {
			const tool = agent.meta.tools.find((x) => x.name === call.name);
			if (tool === undefined) out = failed(`there is no tool ${call.name}`);
			else if (tool.kind === "message") out = await runMessage(env, agent, tool, call);
			else out = { value: env.get(tool.name, argsFrom(argsOf(agent, tool), call.arguments)) };
		}
	} catch (error) {
		out = failed(`${call.name} threw: ${error?.message ?? error}`);
	}
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: clip(text(out.value)) }],
		details: { changed: out.changed === true },
		isError: out.isError === true || isErrorResult(out.value),
		timestamp: Date.now(),
	};
}

/** The env for the root a path selects in a runtime ([] for the runtime's root itself). */
export function hostEnv(tutuca, to = []) {
	return {
		get: (name, args = []) => tutuca.query(name, args, { to }),
		problem: (name, args) => tutuca.messageProblem(name, args, { to }),
		reports: () => tutuca.reports(),
		send: async (name, args) => {
			try {
				tutuca.send(name, args, { to });
				await tutuca.idle();
				return {};
			} catch (error) {
				return { error: error?.message ?? String(error) };
			}
		},
		hold: () => tutuca.hold(to),
		put: (held) => tutuca.put(to, held),
	};
}

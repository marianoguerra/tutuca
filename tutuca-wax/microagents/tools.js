// An agent's tools, as the model sees and calls them. Message tools are the
// root's messages, view tools its queries or gets; their parameters are the
// message's or query's arguments, named and typed as the root's schema says
// (TCD's types, made JSON Schemas here). The shell adds the shared tools:
// the skills, the state and the export. A call runs against env, the live
// root wherever the shell keeps it:
//
//   { root() → the root component now, send(name, args) → Promise<{ error? }>
//     once the message and what it started are done, restore(root) puts a
//     root back, reports() → the host's reports so far }
//
// A message tool is checked first (runtime.messageProblem: its arguments
// against their types, and its when); one that fails a dev mode check once
// it ran (ensures, changes, invariants) is undone.

// ---- TCD types as JSON Schemas ------------------------------------------------------

// The TCD type text (runtime.schema's "type") as a tree:
// { kind, of?, members?, fields?, name? }.
export function parseType(text) {
	let at = 0;
	const skip = () => {
		while (/\s/.test(text[at] ?? "")) at++;
	};
	const word = () => {
		skip();
		const m = /^[A-Za-z_][A-Za-z0-9_]*|^\.\./.exec(text.slice(at));
		if (!m) throw new Error(`can't read the type ${text}`);
		at += m[0].length;
		return m[0];
	};
	const punct = (p) => {
		skip();
		if (text.startsWith(p, at)) {
			at += p.length;
			return true;
		}
		return false;
	};
	const expect = (p) => {
		if (!punct(p)) throw new Error(`can't read the type ${text}: expected ${p} at ${at}`);
	};
	const type = () => {
		const w = word();
		if (["bool", "s32", "f64", "string", "any", "component", "null"].includes(w)) return { kind: w };
		if (w === "option" || w === "list" || w === "map") {
			expect("<");
			const of = type();
			expect(">");
			return { kind: w, of };
		}
		if (w === "one_of" || w === "result") {
			expect("<");
			const members = [type()];
			while (punct(",")) members.push(type());
			expect(">");
			return { kind: w, members };
		}
		if (w === "enum") {
			expect("{");
			const members = [];
			while (!punct("}")) {
				members.push(word());
				punct(",");
			}
			return { kind: "enum", members };
		}
		if (w === "record") {
			expect("{");
			const fields = [];
			let open = false;
			while (!punct("}")) {
				const name = word();
				if (name === "..") open = true;
				else {
					expect(":");
					fields.push({ name, type: type() });
				}
				punct(",");
			}
			return { kind: "record", fields, open };
		}
		return { kind: "named", name: w };
	};
	const out = type();
	skip();
	if (at !== text.length) throw new Error(`can't read the type ${text}`);
	return out;
}

const ANY_JSON = { type: ["object", "array", "string", "number", "integer", "boolean", "null"] };

// A parsed TCD type as a JSON Schema.
export function typeSchema(t) {
	switch (t.kind) {
		case "bool":
			return { type: "boolean" };
		case "s32":
			return { type: "integer", minimum: -(2 ** 31), maximum: 2 ** 31 - 1 };
		case "f64":
			return { type: "number" };
		case "string":
			return { type: "string" };
		case "null":
			return { type: "null" };
		case "enum":
			return { type: "string", enum: t.members };
		case "option":
			return { anyOf: [typeSchema(t.of), { type: "null" }] };
		case "list":
			return { type: "array", items: typeSchema(t.of) };
		case "map":
			return { type: "object", additionalProperties: typeSchema(t.of) };
		case "record":
			return {
				type: "object",
				properties: Object.fromEntries(t.fields.map((f) => [f.name, typeSchema(f.type)])),
				required: t.fields.map((f) => f.name),
				...(t.open ? {} : { additionalProperties: false }),
			};
		case "one_of":
			return { anyOf: t.members.map(typeSchema) };
		default:
			return { ...ANY_JSON };
	}
}

// A constraint's text (runtime.schema's "constraints") applied to schema:
// bounds and lengths become its keywords, the rest goes in its description.
export function constrain(schema, constraints) {
	const out = { ...schema };
	const notes = [];
	const isArray = out.type === "array";
	for (const c of constraints) {
		let m = /^(>=|<=|>|<) (-?\d+(?:\.\d+)?)$/.exec(c);
		if (m) {
			const n = Number(m[2]);
			if (m[1] === ">=") out.minimum = n;
			if (m[1] === "<=") out.maximum = n;
			if (m[1] === ">") out.exclusiveMinimum = n;
			if (m[1] === "<") out.exclusiveMaximum = n;
			continue;
		}
		m = /^len (>=|<=) (\d+)$/.exec(c);
		if (m) {
			const key = `${m[1] === ">=" ? "min" : "max"}${isArray ? "Items" : "Length"}`;
			out[key] = Number(m[2]);
			continue;
		}
		m = /^in (\[.*\])$/.exec(c);
		if (m) {
			try {
				out.enum = JSON.parse(m[1]);
				continue;
			} catch {}
		}
		m = /^matches (".*")$/.exec(c);
		if (m) {
			out.pattern = JSON.parse(m[1]);
			continue;
		}
		notes.push(c);
	}
	if (notes.length > 0) out.description = [out.description, `must hold: ${notes.join(", ")}`].filter(Boolean).join("; ");
	return out;
}

// A field schema of runtime.schema ({ name, type, constraints }) as a JSON Schema.
export const argSchema = (arg) => constrain(typeSchema(parseType(arg.type)), arg.constraints ?? []);

const objectSchema = (args) => ({
	type: "object",
	properties: Object.fromEntries(args.map((a) => [a.name, argSchema(a)])),
	required: args.map((a) => a.name),
});

// ---- The shared tools -----------------------------------------------------------------

export const SHARED_TOOLS = [
	{
		name: "skills_list",
		description: "List the files in the agent's skills folder, or under a directory of it.",
		parameters: { type: "object", properties: { dir: { type: "string", description: 'A directory, "" for all of them.' } }, required: ["dir"] },
	},
	{
		name: "skills_read",
		description: "Read a file of the agent's skills folder.",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
	{
		name: "get_state",
		description: "The data being worked on, as JSON (long values are cut short).",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		name: "export_preview",
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
export const skillsRead = (skills, path) => skills[path] ?? { error: `no file "${path}"; skills_list shows the files` };

// The skills as the system prompt lists them: each file's description, when
// its frontmatter has one, then every path.
export const skillsIndex = (skills) => {
	const paths = Object.keys(skills ?? {});
	if (paths.length === 0) return "";
	const lines = paths.map((p) => {
		const description = /^description:\s*(.+)$/m.exec(skills[p])?.[1];
		return description ? `- ${p}: ${description}` : `- ${p}`;
	});
	return `The skills folder (read files with skills_read):\n${lines.join("\n")}`;
};

// Text cut to about max characters.
export const clip = (text, max = 8000) => (text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters)`);

// ---- The tools of an agent ------------------------------------------------------------

// The arguments of tool on root: the message's or query's, none for a get.
export function argsOf(runtime, root, tool) {
	const schema = runtime.schema(root);
	if (tool.kind === "message") return schema.messages.find((m) => m.name === tool.name)?.args ?? [];
	return schema.queries.find((q) => q.name === tool.name)?.args ?? [];
}

// Every tool of agent (with root one of its roots), as pi-ai Tools.
export const toolsFor = (runtime, agent, root) => [
	...agent.meta.tools.map((tool) => ({
		name: tool.name,
		description: `${tool.description ?? ""}${tool.kind === "view" ? " (reads, changes nothing)" : ""}`.trim(),
		parameters: objectSchema(argsOf(runtime, root, tool)),
	})),
	...SHARED_TOOLS,
];

// ---- Running a call -------------------------------------------------------------------

const text = (v) => (typeof v === "string" ? v : (JSON.stringify(v, null, 1) ?? "null"));
const failed = (message) => ({ value: message, isError: true });
const isErrorResult = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && "error" in v;
const FAILURES = new Set(["taskFailed", "renderFailed", "eventFailed", "messageInvalid", "stateInvalid"]);

// What a report says, in words.
const reportText = (r) => r.error?.message ?? r.message ?? (r.problem ? `${r.problem}` : JSON.stringify(r, (k, v) => (k === "type" ? undefined : v)));

// The positional args for a call's named arguments: a missing one is null.
const argsFrom = (args, named = {}) => args.map((a) => named?.[a.name] ?? null);

// The value of the root's get or query name with args, or what the model
// reads if it fails.
const read = (runtime, root, name, args, isQuery) => {
	if (!isQuery) return { value: runtime.get(root, name) };
	const out = runtime.query(root, name, args);
	return "ok" in out ? { value: out.ok } : failed(`${name} can't run with these arguments: ${out.err}`);
};

const runMessage = async (runtime, env, tool, call) => {
	const prev = env.root();
	const args = argsFrom(argsOf(runtime, prev, tool), call.arguments);
	const problem = runtime.messageProblem(prev, tool.name, args);
	if (problem !== null) {
		const why = problem === "pre" ? "its condition (its when) doesn't hold now: check the ids it names against the summary" : problem;
		return failed(`${tool.name} can't run with these arguments now: ${why}`);
	}
	const seen = env.reports().length;
	const { error } = await env.send(tool.name, args);
	const bad = env
		.reports()
		.slice(seen)
		.filter((r) => FAILURES.has(r.type));
	if (error !== undefined || bad.length > 0) {
		env.restore(prev);
		const why = [error, ...bad.map(reportText)].filter(Boolean).join("; ");
		return failed(`${tool.name} was undone: ${why}`);
	}
	const next = env.root();
	return { value: runtime.get(next, tool.result ?? "summary"), changed: next !== prev };
};

const runShared = (runtime, env, agent, call) => {
	const args = call.arguments ?? {};
	switch (call.name) {
		case "skills_list":
			return { value: skillsList(agent.meta.skills ?? {}, args.dir ?? "") };
		case "skills_read":
			return { value: skillsRead(agent.meta.skills ?? {}, args.path ?? "") };
		case "get_state":
			return { value: runtime.get(env.root(), "domain") };
		case "export_preview":
			return { value: runtime.get(env.root(), "data") };
	}
};

// The ToolResultMessage (pi-ai's shape) for call ({ id, name, arguments })
// on agent's root in env.
export async function runToolCall(runtime, env, agent, call) {
	let out;
	try {
		if (SHARED_NAMES.has(call.name)) out = runShared(runtime, env, agent, call);
		else {
			const tool = agent.meta.tools.find((x) => x.name === call.name);
			if (tool === undefined) out = failed(`there is no tool ${call.name}`);
			else if (tool.kind === "message") out = await runMessage(runtime, env, tool, call);
			else {
				const root = env.root();
				const query = runtime.schema(root).queries.find((q) => q.name === tool.name);
				out = read(runtime, root, tool.name, query ? argsFrom(query.args, call.arguments) : [], query !== undefined);
			}
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

// The env for the root steps reach in host (steps as host.sendAt takes
// them; [] for the root itself). restore(prev) puts prev back: by default
// with the message set_workspace at the steps' parent, as the shell's
// Session takes it.
export function hostEnv(runtime, host, steps, { restore } = {}) {
	const at = () => {
		let c = host.root();
		for (const s of steps) {
			c = Array.isArray(s) ? runtime.get(c, s[0])[s[1]] : runtime.get(c, s);
		}
		return c;
	};
	return {
		root: at,
		reports: () => host.reports,
		send: async (name, args) => {
			try {
				if (steps.length === 0) host.send(name, args);
				else host.sendAt(steps, name, args);
				await host.settled();
				return {};
			} catch (error) {
				return { error: error?.message ?? String(error) };
			}
		},
		restore: restore ?? ((prev) => host.sendAt(steps.slice(0, -1), "set_workspace", [prev])),
	};
}

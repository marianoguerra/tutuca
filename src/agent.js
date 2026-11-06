// The agent meta convention: what a component says to an LLM agent that drives it. Its tools,
// each one of its own messages or queries, named and described for the model; a prompt on its
// domain; the query the agent reads (summary, in every system prompt); and skills, a read-only fs
// of texts the model can read. What its whole content is as data (DATA_META, src/data.js) gives
// the agent get_state, set_state and samples. A generic agent takes any component that says
// this and drives it, knowing nothing of its domain.
//
// A component declares it with component({ meta: { [AGENT_META]: { tools, ... } } }); a scope
// that registers agentMetaSchemas checks it, and agentProblems checks what the shape can't: that
// each tool names a message or query the component has, with as many params as it takes args.
//
// This module is the agent's pure core, for any host: the tools in pi-ai's shape ({ name,
// description, parameters }, JSON Schema derived from the args' types), the system prompt, the
// next step of the loop, and running a tool call against a component. Running a message that
// needs a context is the host's: planToolCall says what to send and what answers it.
import { apply, query } from "./contract.js";
import {
	contractErrorText,
	dataOf,
	dataSchema,
	deepFreeze,
	hasDataMeta,
	isZeroArgQuery,
	loadData,
	typeSchema,
	withSample,
} from "./data.js";
import { DISPLAY_META } from "./display.js";
import { t } from "./schema.js";
import {
	argIssues,
	ContractError,
	HandlerSpec,
	metaOf,
	metaProblems,
	preHolds,
	QuerySpec,
	scopeOf,
	specOf,
} from "./spec.js";
import { SCOPE_OUTCOMES } from "./tree/index.js";

export { typeSchema };

export const AGENT_META = "https://tutuca.dev/meta/agent";
const toolType = t.record({
	name: t.string(), // The tool's name, as the model calls it.
	kind: t.enum("message", "query"),
	target: t.option(t.string()), // The message or query it runs; its name when null.
	description: t.option(t.string()),
	params: t.array(t.string()), // The args' names, in order.
	result: t.option(t.string()), // A zero-arg query whose value answers a message; summary when null.
});
export const agentMetaSchemas = {
	[AGENT_META]: {
		// What the domain is and how to work in it, for the system prompt.
		prompt: t.option(t.string()),
		// A zero-arg query, a short text with ids the model can name things by, in every prompt.
		summary: t.string("summary"),
		tools: t.array(toolType),
		skills: t.map(t.string()), // path -> text.
		// The most model turns for one prompt; MAX_STEPS when null. One that drives other agents
		// takes more.
		maxSteps: t.option(t.number().int().min(1).max(200)),
	},
};
const DEFAULTS = { prompt: null, summary: "summary", tools: [], maxSteps: null };
// A tool for an agent meta's tools: name runs the message or query of that name (or target),
// with params naming its args in order; a message answers with its result query (summary when
// null).
export const agentTool = (
	name,
	kind,
	params,
	description,
	{ target = null, result = null } = {},
) => ({
	name,
	kind,
	target,
	description,
	params,
	result,
});
// What c (a component or, with scope, its spec) says to an agent, with every key filled.
export const agentOf = (c, scope = undefined) => {
	const meta = metaOf(c, AGENT_META, scope);
	return deepFreeze({ ...DEFAULTS, skills: {}, ...structuredClone({ ...meta }) });
};
// Whether c (a component or its spec) says anything to an agent.
export const hasAgentMeta = (c) => Object.hasOwn((specOf(c) ?? c)?.meta ?? {}, AGENT_META);

// The handler or query a tool of spec runs, or undefined.
const operationOf = (spec, tool) => {
	const name = tool.target ?? tool.name;
	return tool.kind === "message" ? spec.on[name] : spec.queries?.[name];
};
const isOperation = (op, kind) =>
	kind === "message" ? op instanceof HandlerSpec : op instanceof QuerySpec;

// What c (a component or its spec, with scope) says to an agent that it can't do, as messages:
// a tool naming no message or query of its kind, a count of params that isn't its args', two
// tools of one name, a summary or result that isn't a zero-arg query. What its data meta says is
// dataProblems'.
export const agentProblems = (c, scope = undefined) => {
	const spec = specOf(c) ?? c;
	if (!hasAgentMeta(spec)) return [];
	// Its shape first, as a scope with agentMetaSchemas checks it: the rest reads it.
	const shape = metaProblems(AGENT_META, spec.meta[AGENT_META], agentMetaSchemas[AGENT_META]);
	if (shape.length > 0) return shape;
	const meta = agentOf(c, scope);
	const problems = [];
	const seen = new Set();
	for (const tool of meta.tools) {
		const target = tool.target ?? tool.name;
		if (seen.has(tool.name)) problems.push(`tool ${tool.name} is given twice`);
		seen.add(tool.name);
		if (SHARED_NAMES.has(tool.name)) problems.push(`tool ${tool.name} is a shared tool's name`);
		const op = operationOf(spec, tool);
		if (!isOperation(op, tool.kind)) {
			problems.push(`tool ${tool.name} runs ${tool.kind} ${target}, which it doesn't have`);
			continue;
		}
		if (op.args !== undefined && op.args.length !== tool.params.length) {
			problems.push(
				`tool ${tool.name} names ${tool.params.length} params, but ${target} takes ${op.args.length} args`,
			);
		}
		if (tool.kind === "message" && op.args === undefined) {
			problems.push(
				`tool ${tool.name}: message ${target} has no args types to make its schema from`,
			);
		}
		if (tool.result !== null && !isZeroArgQuery(spec, tool.result)) {
			problems.push(`tool ${tool.name}'s result ${tool.result} isn't a zero-arg query`);
		}
	}
	if (!isZeroArgQuery(spec, meta.summary)) {
		problems.push(`its summary ${meta.summary} isn't a zero-arg query`);
	}
	return problems;
};

// The tools every agent gets, besides the component's own, by what the meta says.
const SHARED = {
	get_state: {
		description: "The whole state, as JSON. Prefer the summary and the tools' results.",
		params: () => ({}),
		when: (data) => data?.data != null,
	},
	set_state: {
		description:
			"Replace the whole state with value, in the shape get_state answers. Prefer the other tools for small changes.",
		params: (c) => ({ value: dataSchema(c) }),
		when: (data) => data !== null,
	},
	skills_list: {
		description: "The paths of the skills, texts on how to work in this domain.",
		params: () => ({}),
		when: (_data, meta) => Object.keys(meta.skills).length > 0,
	},
	skills_read: {
		description: "A skill's text, by its path.",
		params: () => ({ path: { type: "string" } }),
		when: (_data, meta) => Object.keys(meta.skills).length > 0,
	},
	samples_list: {
		description: "The names of the samples the state can start from.",
		params: () => ({}),
		when: (data) => data !== null && Object.keys(data.samples).length > 0,
	},
	load_sample: {
		description: "Replace the whole state with a sample, by its name.",
		params: () => ({ name: { type: "string" } }),
		when: (data) => data !== null && Object.keys(data.samples).length > 0,
	},
};
const SHARED_NAMES = new Set(Object.keys(SHARED));
const objectSchema = (properties) => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
});

// What c says about its data, or null when it says nothing.
const dataMetaOf = (c) => (hasDataMeta(c) ? dataOf(c) : null);

// c's tools, as pi-ai Tools ({ name, description, parameters }): its own, their parameters'
// schemas from their args' types, and the shared ones its meta calls for.
export const toolsFor = (c) => {
	const spec = specOf(c);
	const meta = agentOf(c);
	const own = meta.tools.map((tool) => {
		const op = operationOf(spec, tool);
		const types = op?.args ?? [];
		const properties = Object.fromEntries(
			tool.params.map((name, i) => [name, typeSchema(types[i])]),
		);
		const reads = tool.kind === "query" ? " (reads, changes nothing)" : "";
		return {
			name: tool.name,
			description: `${tool.description ?? ""}${reads}`.trim(),
			parameters: objectSchema(properties),
		};
	});
	const data = dataMetaOf(c);
	const shared = Object.entries(SHARED)
		.filter(([, s]) => s.when(data, meta))
		.map(([name, s]) => ({
			name,
			description: s.description,
			parameters: objectSchema(s.params(c)),
		}));
	return [...own, ...shared];
};

const PREAMBLE = `You are an agent working in one component of a web application, through its tools only.
Every tool that changes something answers with what it looks like after. Use ids from the summary
to name things. When a tool fails, read why and try something else; don't repeat the same call.
Keep your answers short.`;
// What c's agent is told before the conversation: the preamble, what c is (its display meta),
// its domain prompt and its summary now.
export const systemPrompt = (c) => {
	const meta = agentOf(c);
	const display = metaOf(c, DISPLAY_META);
	const what = [display.title, display.description].filter(Boolean).join(": ");
	const parts = [PREAMBLE];
	if (what) parts.push(`The component: ${what}`);
	if (meta.prompt) parts.push(meta.prompt);
	parts.push(`Now: ${summaryOf(c)}`);
	return parts.join("\n\n");
};
// c's summary query's value, as text.
export const summaryOf = (c) => {
	try {
		return asText(query(c, agentOf(c).summary));
	} catch (error) {
		return `(no summary: ${errorText(c, null, error)})`;
	}
};
const asText = (v) => (typeof v === "string" ? v : JSON.stringify(v));

// The most steps (model turns) an agent takes for one prompt, unless its target's meta says.
export const MAX_STEPS = 12;
export const maxStepsOf = (c) => agentOf(c).maxSteps ?? MAX_STEPS;
// The tool calls of a pi-ai assistant message.
export const toolCallsOf = (message) =>
	message?.role === "assistant" && Array.isArray(message.content)
		? message.content.filter((b) => b?.type === "toolCall")
		: [];
// What an agent does next with transcript (pi-ai messages): infer (ask the model), tools (run
// calls, the last assistant message's calls without a result yet), or complete (the model
// answered without calling a tool, or nothing was asked).
export const nextAction = (transcript) => {
	let i = transcript.length - 1;
	const answered = new Set();
	while (i >= 0 && transcript[i].role === "toolResult") answered.add(transcript[i--].toolCallId);
	const last = transcript[i];
	if (last === undefined) return { action: "complete", calls: [] };
	if (last.role === "user") return { action: "infer", calls: [] };
	const calls = toolCallsOf(last);
	if (calls.length === 0) return { action: "complete", calls: [] };
	const pending = calls.filter((call) => !answered.has(call.id));
	return pending.length > 0 ? { action: "tools", calls: pending } : { action: "infer", calls: [] };
};
// A pi-ai tool result message.
export const toolResultMessage = (call, text, isError = false) => ({
	role: "toolResult",
	toolCallId: call.id,
	toolName: call.name,
	content: [{ type: "text", text }],
	isError,
});

// Why calling a tool on c failed, in words the model reads.
const errorText = (c, tool, error) => contractErrorText(c, error, tool?.params ?? []);

// The positional args for a tool call's named arguments; one left out is null.
export const callArgs = (tool, argsObject) => tool.params.map((name) => argsObject?.[name] ?? null);

// What running call (a pi-ai tool call) on c takes, as one of:
// - { done: { text, isError }, next }: it ran, a query, a shared tool or a pure message; next is
//   c after it (c itself when nothing changed).
// - { send: { name, args }, result }: a message that needs a context, checked (args, pre) but
//   not run: the host sends it to c and answers the call with resultText(c', result) once it ran.
export const planToolCall = (c, call) => {
	const spec = specOf(c);
	const meta = agentOf(c);
	const done = (text, isError = false, next = c) => ({ done: { text, isError }, next });
	const data = dataMetaOf(c);
	if (SHARED_NAMES.has(call.name) && SHARED[call.name].when(data, meta)) {
		return runShared(c, meta, data, call, done);
	}
	const tool = meta.tools.find((tl) => tl.name === call.name);
	if (tool === undefined) return done(`There's no tool ${call.name}.`, true);
	const target = tool.target ?? tool.name;
	const args = callArgs(tool, call.arguments);
	try {
		if (tool.kind === "query") return done(asText(query(c, target, ...args)));
		const message = spec.on[target];
		if (message?.pure) {
			const next = apply(c, target, ...args);
			return done(resultText(next, tool.result ?? meta.summary), false, next);
		}
		const scope = scopeOf(c);
		const issues = argIssues(message.args, args, scope, c);
		if (issues.length > 0) throw new ContractError(spec.name, target, issues);
		if (!preHolds(message, c, args, {})) {
			throw new ContractError(spec.name, target, ["pre"], message.why?.call(c, c, args) ?? "");
		}
		return { send: { name: target, args }, result: tool.result ?? meta.summary };
	} catch (error) {
		return done(errorText(c, tool, error), true);
	}
};
const runShared = (c, meta, data, call, done) => {
	const { name, arguments: args = {} } = call;
	try {
		if (name === "get_state") return done(asText(query(c, data.data)));
		if (name === "set_state") {
			const { next, error } = loadData(c, args.value ?? null, "value");
			if (error !== undefined) return done(error, true);
			return done(resultText(next, meta.summary), false, next);
		}
		if (name === "skills_list") return done(JSON.stringify(Object.keys(meta.skills)));
		if (name === "skills_read") {
			const text = meta.skills[args.path];
			return text === undefined ? done(`There's no skill ${args.path}.`, true) : done(text);
		}
		if (name === "samples_list") return done(JSON.stringify(Object.keys(data.samples)));
		if (name === "load_sample") {
			if (!Object.hasOwn(data.samples, args.name)) {
				return done(`There's no sample ${args.name}.`, true);
			}
			const next = withSample(c, args.name);
			return done(resultText(next, meta.summary), false, next);
		}
	} catch (error) {
		return done(errorText(c, null, error), true);
	}
	return done(`There's no tool ${name}.`, true);
};
// What a settle scope (src/tree/scope.js) tells its watcher: a tool's message and everything it
// caused ran (ok), some of it threw (failed), or it was stopped (cancelled, timeout).
export const reportType = t.record({
	id: t.number(),
	outcome: t.enum(...SCOPE_OUTCOMES),
	tasks: t.number().int().min(0),
	failed: t.number().int().min(0),
});
// What answers a message tool's call once its settle scope settled with report: what c looks
// like after (its result query) and, when it didn't go well, why; and whether it's an error.
export const settledText = (c, result, report) => {
	const now = resultText(c, result);
	if (report.outcome === "ok") return { text: now, isError: false };
	const why =
		report.outcome === "failed"
			? `It ran, but ${report.failed} of the ${report.tasks} steps it took failed.`
			: report.outcome === "timeout"
				? "It took too long and was stopped."
				: "It was stopped before it finished.";
	return { text: `${why} Now: ${now}`, isError: true };
};
// Results for the tool calls of transcript's last assistant message that have none, saying
// text: a transcript a stopped loop left is one a model can be asked about again.
export const pendingResults = (transcript, text) => {
	const { action, calls } = nextAction(transcript);
	return action === "tools" ? calls.map((call) => toolResultMessage(call, text, true)) : [];
};
// What answers a message tool's call once it ran: c's zero-arg query result, as text.
export const resultText = (c, result) => {
	try {
		return asText(query(c, result));
	} catch (error) {
		return `It ran, but ${result} couldn't be read: ${errorText(c, null, error)}`;
	}
};

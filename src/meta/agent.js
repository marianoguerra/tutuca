// The agent meta convention: what a component says to an LLM agent that drives it. Its tools,
// each one of its own messages or queries, named and described for the model; a prompt on its
// domain; the query the agent reads (summary, in every system prompt); and skills, a read-only fs
// of texts the model can read. What its whole content is as data (DATA_META, meta/data.js) gives
// the agent get_state, set_state and samples. A generic agent takes any component that says
// this and drives it, knowing nothing of its domain.
//
// A component declares it with component({ meta: { [AGENT_META]: { tools, ... } } }); a scope
// that registers agentMetaSchemas checks it, and agentProblems checks what the shape can't: that
// each tool names a message or query the component has, with as many params as it takes args.
//
// This module is the agent's pure core, for any host: the tools in pi-ai's shape ({ name,
// description, parameters }, JSON Schema derived from the args' types), the system prompt and
// running a tool call against a component. Running a message that needs a context is the
// host's: planToolCall says what to send and what answers it. The loop over a transcript that
// calls them is agent-loop.js.
import {
	apply,
	checkCall,
	filledMeta,
	HandlerSpec,
	hasMeta,
	metaShapeProblems,
	plainOf,
	QuerySpec,
	query,
	specOf,
	specOrSelf,
	t,
} from "../tutuca.js";
import { dataOf, dataSchema, hasDataMeta, isZeroArgQuery, loadData, withSample } from "./data.js";
import { displayOf } from "./display.js";
import { contractErrorText } from "./errors.js";
import { typeSchema } from "./json-schema.js";

export const AGENT_META = "https://tutuca.dev/meta/agent";
const toolType = t.record({
	name: t.string(), // The tool's name, as the model calls it.
	kind: t.enum(["message", "query"]),
	target: t.option(t.string()), // The message or query it runs; its name when null.
	description: t.option(t.string()),
	params: t.array(t.string()), // The args' names, in order.
	paramDocs: t.map(t.string()), // What each arg is, by name, for its schema's description.
	// A zero-arg query whose value answers a message; the summary when null.
	result: t.option(t.string()),
});
export const agentMetaSchemas = {
	[AGENT_META]: {
		// What the domain is and how to work in it, for the system prompt.
		prompt: t.option(t.string()),
		// A zero-arg query, a short text with ids the model can name things by, in every prompt;
		// null for the component's state as JSON (what a derived meta says without a summary).
		summary: t.option(t.string(), { default: "summary" }),
		// A zero-arg query, what this instance in particular is told to do (a role it was given),
		// in every prompt after the domain's; null when it has none.
		instructions: t.option(t.string()),
		tools: t.array(toolType),
		skills: t.map(t.string()), // path -> text.
		// The most model turns for one prompt; MAX_STEPS when null. One that drives other agents
		// takes more.
		maxSteps: t.option(t.int({ min: 1, max: 200 })),
	},
};
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
export const agentOf = (c, scope = undefined) =>
	filledMeta(c, AGENT_META, agentMetaSchemas[AGENT_META], scope);
// Whether c (a component or its spec) says anything to an agent.
export const hasAgentMeta = (c) => hasMeta(c, AGENT_META);

// The handler or query a tool of spec runs, or undefined.
const operationOf = (spec, tool) => {
	const name = tool.target ?? tool.name;
	return tool.kind === "message" ? spec.on[name] : spec.queries[name];
};
const isOperation = (op, kind) =>
	kind === "message" ? op instanceof HandlerSpec : op instanceof QuerySpec;

// What c (a component or its spec, with scope) says to an agent that it can't do, as messages:
// a tool naming no message or query of its kind, a count of params that isn't its args', two
// tools of one name, a summary or result that isn't a zero-arg query. What its data meta says is
// dataProblems'.
export const agentProblems = (c, scope = undefined) => {
	const spec = specOrSelf(c);
	if (!hasAgentMeta(spec)) return [];
	// Its shape first, as a scope with agentMetaSchemas checks it: the rest reads it.
	const shape = metaShapeProblems(spec, AGENT_META, agentMetaSchemas[AGENT_META]);
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
	if (meta.summary !== null && !isZeroArgQuery(spec, meta.summary)) {
		problems.push(`its summary ${meta.summary} isn't a zero-arg query`);
	}
	if (meta.instructions !== null && !isZeroArgQuery(spec, meta.instructions)) {
		problems.push(`its instructions ${meta.instructions} isn't a zero-arg query`);
	}
	return problems;
};

const hasSkills = (_data, meta) => Object.keys(meta.skills).length > 0;
const hasSamples = (data) => data !== null && Object.keys(data.samples).length > 0;
// The tools every agent gets, besides the component's own: each one's description, the schema
// of its params, when the component gets it, by what its data and agent metas say, and
// run(c, meta, data, args, done), which answers a call with done(text, isError, next).
const SHARED = {
	get_state: {
		description: "The whole state, as JSON. Prefer the summary and the tools' results.",
		params: () => ({}),
		when: (data) => data?.data != null,
		run: (c, _meta, data, _args, done) => done(asText(query(c, data.data))),
	},
	set_state: {
		description:
			"Replace the whole state with value, in the shape get_state answers. Prefer the other tools for small changes.",
		params: (c) => ({ value: dataSchema(c) }),
		when: (data) => data !== null,
		run(c, meta, _data, args, done) {
			const { next, error } = loadData(c, args.value ?? null, "value");
			if (error !== undefined) return done(error, true);
			return done(resultText(next, meta.summary), false, next);
		},
	},
	skills_list: {
		description: "The paths of the skills, texts on how to work in this domain.",
		params: () => ({}),
		when: hasSkills,
		run: (_c, meta, _data, _args, done) => done(JSON.stringify(Object.keys(meta.skills))),
	},
	skills_read: {
		description: "A skill's text, by its path.",
		params: () => ({ path: { type: "string" } }),
		when: hasSkills,
		run(_c, meta, _data, args, done) {
			const text = meta.skills[args.path];
			return text === undefined ? done(`There's no skill ${args.path}.`, true) : done(text);
		},
	},
	samples_list: {
		description: "The names of the samples the state can start from.",
		params: () => ({}),
		when: hasSamples,
		run: (_c, _meta, data, _args, done) => done(JSON.stringify(Object.keys(data.samples))),
	},
	load_sample: {
		description: "Replace the whole state with a sample, by its name.",
		params: () => ({ name: { type: "string" } }),
		when: hasSamples,
		run(c, meta, data, args, done) {
			if (!Object.hasOwn(data.samples, args.name)) {
				return done(`There's no sample ${args.name}.`, true);
			}
			const next = withSample(c, args.name);
			return done(resultText(next, meta.summary), false, next);
		},
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
		const describe = (name, schema) =>
			tool.paramDocs?.[name] ? { ...schema, description: tool.paramDocs[name] } : schema;
		const properties = Object.fromEntries(
			tool.params.map((name, i) => [name, describe(name, typeSchema(types[i]))]),
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
// its domain prompt, what this one was told to do (its instructions query) and its summary now.
export const systemPrompt = (c) => {
	const meta = agentOf(c);
	const display = displayOf(c);
	const what = [display.title, display.description].filter(Boolean).join(": ");
	const parts = [PREAMBLE];
	if (what) parts.push(`The component: ${what}`);
	if (meta.prompt) parts.push(meta.prompt);
	const instructions = meta.instructions === null ? "" : readText(c, meta.instructions);
	if (instructions) parts.push(instructions);
	parts.push(`Now: ${summaryOf(c)}`);
	return parts.join("\n\n");
};
// The most of a component's state a summary or a result that's the state says.
const MAX_STATE = 4000;
// c's state as JSON, cut at MAX_STATE: the summary and the results of a meta that names none.
const stateText = (c) => {
	const text = JSON.stringify(plainOf(c)) ?? "null";
	return text.length <= MAX_STATE ? text : `${text.slice(0, MAX_STATE)}… (cut)`;
};
// c's summary query's value, as text; its state when it names none.
export const summaryOf = (c) => {
	const { summary } = agentOf(c);
	if (summary === null) return stateText(c);
	try {
		return asText(query(c, summary));
	} catch (error) {
		return `(no summary: ${contractErrorText(c, error)})`;
	}
};
// c's zero-arg query's value as text; "" when it can't be read.
const readText = (c, name) => {
	try {
		return asText(query(c, name));
	} catch {
		return "";
	}
};
const asText = (v) => (typeof v === "string" ? v : JSON.stringify(v));

// The positional args for a tool call's named arguments; one left out is null.
const callArgs = (tool, argsObject) => tool.params.map((name) => argsObject?.[name] ?? null);

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
		try {
			return SHARED[call.name].run(c, meta, data, call.arguments ?? {}, done);
		} catch (error) {
			return done(contractErrorText(c, error), true);
		}
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
		checkCall(spec, target, message, c, args);
		return { send: { name: target, args }, result: tool.result ?? meta.summary };
	} catch (error) {
		return done(contractErrorText(c, error, tool.params), true);
	}
};
// What answers a message tool's call once it ran: c's zero-arg query result, as text; its state
// when result is null.
export const resultText = (c, result) => {
	if (result === null || result === undefined) return stateText(c);
	try {
		return asText(query(c, result));
	} catch (error) {
		return `It ran, but ${result} couldn't be read: ${contractErrorText(c, error)}`;
	}
};

// An agent meta made from spec's definition, over said (what it says under AGENT_META, or null):
// a message tool per message it has (those a child notifies it, with a sourceKey, left out),
// whose args it types, named as its run names them (arg1, arg2… where it doesn't); a query
// tool per query whose args it knows; its summary query when it has one, else its state; its
// display description, or its name and fields, as the prompt. docs, what its doc comments say
// ({ text, fields, on, queries }, componentModule's), describe the tools and their params, leave
// out the @hidden ones, pick the @summary query and make the prompt. What said gives wins: its
// tools by name, and its other keys.
export const deriveAgentMeta = (spec, said = null, docs = null) => {
	const paramsOf = (op) => op.params ?? op.args.map((_, i) => `arg${i + 1}`);
	const toolOf = (name, kind, op, doc) => ({
		name,
		kind,
		target: null,
		description: doc?.text || null,
		params: paramsOf(op),
		paramDocs: doc?.params ?? {},
		result: null,
	});
	const docSummary = Object.entries(docs?.queries ?? {}).find(([, d]) => d.summary)?.[0];
	const summary =
		docSummary !== undefined && isZeroArgQuery(spec, docSummary)
			? docSummary
			: isZeroArgQuery(spec, "summary")
				? "summary"
				: null;
	const tools = [];
	for (const [name, h] of Object.entries(spec.on ?? {})) {
		if (!(h instanceof HandlerSpec) || h.sourceKey !== undefined || h.args === undefined) continue;
		const doc = docs?.on?.[name];
		if (!doc?.hidden) tools.push(toolOf(name, "message", h, doc));
	}
	for (const [name, q] of Object.entries(spec.queries ?? {})) {
		// The summary is in every prompt: no tool reads it again.
		if (!(q instanceof QuerySpec) || q.args === undefined || name === summary) continue;
		const doc = docs?.queries?.[name];
		if (!doc?.hidden) tools.push(toolOf(name, "query", q, doc));
	}
	const fieldText = ([k, type]) => {
		const doc = docs?.fields?.[k];
		return `${k} (${type.constructor.kind ?? "value"})${doc ? `: ${doc.replace(/\.$/, "")}` : ""}`;
	};
	const fields = Object.entries(spec.fields ?? {}).map(fieldText);
	const description = displayOf(spec).description;
	const about =
		docs?.text || (typeof description === "string" && description !== "" ? description : "");
	const derived = {
		prompt: `${about || `A ${spec.name} component.`} Its fields: ${fields.join("; ") || "none"}.`,
		summary,
		tools,
	};
	if (said === null) return derived;
	const own = new Map((said.tools ?? []).map((tool) => [tool.name, tool]));
	return {
		...derived,
		...said,
		tools: [...derived.tools.filter((tool) => !own.has(tool.name)), ...(said.tools ?? [])],
	};
};
// What componentModule's meta option takes for AGENT_META: its schema, agentProblems' checks,
// and with mode "derive", deriveAgentMeta for a component that says none, or over what it says.
export const agentMetaOption = (mode = "check") => ({
	schema: agentMetaSchemas[AGENT_META],
	mode,
	problems: (spec) => agentProblems(spec),
	derive: deriveAgentMeta,
});

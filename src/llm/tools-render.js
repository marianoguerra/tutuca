// Rendering a component's renders.llmTools: the tool definitions a model is given (Anthropic's
// shape: name, description, input_schema, a JSON Schema), and calling one of them: its input
// checked against its schema, then its send, to the component it was rendered in.
import { pathOfMarkers } from "../core/host/events.js";
import { Address, RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";
import { attrsIssues, childIssue, flatten, LlmError, textIssue } from "./build.js";
import { llmToolsTarget } from "./target.js";
import { PARAMS, TOOLS } from "./tools.js";

// A call a model made that can't be: there's no such tool now, or its input doesn't fit. Its
// issues are written to be sent back to the model as the tool's error result.
export class ToolCallError extends LlmError {
	constructor(issues) {
		super(issues);
		this.name = "ToolCallError";
	}
}

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
// What's said in text among children, as one description.
const textOf = (entries) =>
	entries
		.filter((e) => e.text !== undefined)
		.map((e) => e.text.trim())
		.filter((t) => t !== "")
		.join(" ");
const withDescription = (schema, description) =>
	description === "" ? schema : { ...schema, description };
const kept = (attrs, names) => {
	const out = {};
	for (const [from, to] of names) if (attrs[from] != null) out[to] = attrs[from];
	return out;
};
const typeOfValues = (values) => {
	if (values.every(Number.isInteger)) return { type: "integer" };
	if (values.every((v) => typeof v === "number")) return { type: "number" };
	if (values.every((v) => typeof v === "string")) return { type: "string" };
	if (values.every((v) => typeof v === "boolean")) return { type: "boolean" };
	return {};
};

// The JSON Schema of a param; named says whether it has a name (a Tool's) or not (a List's item).
const lowerParam = ({ node, markers }, where, named, issues) => {
	const tag = node.tag;
	const spec = TOOLS[tag];
	const { attrs } = node;
	attrsIssues(tag, spec, attrs, where, issues);
	if (named && attrs.name == null) issues.push(`${where}: ${tag} needs a name`);
	if (!named && attrs.name != null) issues.push(`${where}: a List's item has no name`);
	const children = flatten(node.children, markers);
	const description = textOf(children);
	const nodes = children.filter((e) => e.node !== undefined);
	const childAt = (i, e) => `${where} > ${e.node.tag}[${i}]`;
	for (const [i, e] of nodes.entries()) {
		const issue = childIssue(tag, spec, e.node.tag);
		if (issue !== null) issues.push(`${childAt(i, e)}: ${issue}`);
	}
	let schema;
	switch (tag) {
		case "Str":
			schema = {
				type: "string",
				...kept(attrs, [
					["minLength", "minLength"],
					["maxLength", "maxLength"],
					["pattern", "pattern"],
				]),
			};
			break;
		case "Num":
		case "Int":
			schema = {
				type: tag === "Int" ? "integer" : "number",
				...kept(attrs, [
					["min", "minimum"],
					["max", "maximum"],
				]),
			};
			break;
		case "Bool":
			schema = { type: "boolean" };
			break;
		case "Enum": {
			const options = nodes
				.filter((e) => e.node.tag === "Option")
				.map(({ node: option, markers: m }, i) => {
					attrsIssues("Option", TOOLS.Option, option.attrs, `${where} > Option[${i}]`, issues);
					return { value: option.attrs.value, text: textOf(flatten(option.children, m)) };
				});
			const values = [
				...(Array.isArray(attrs.values) ? attrs.values : []),
				...options.map((o) => o.value),
			];
			if (attrs.values != null && !Array.isArray(attrs.values)) {
				issues.push(`${where}: Enum.values is an array, not ${JSON.stringify(attrs.values)}`);
			}
			if (values.length === 0) {
				// The tool can't be called as it is: say When it's offered.
				issues.push(
					`${where}: Enum ${attrs.name ?? ""} has no values; offer its tool When there are`,
				);
			}
			const lines = options
				.filter((o) => o.text !== "")
				.map((o) => `- ${JSON.stringify(o.value)}: ${o.text}`);
			const text = [description, ...lines].filter((t) => t !== "").join("\n");
			return {
				name: attrs.name,
				required: attrs.optional !== true,
				schema: withDescription({ ...typeOfValues(values), enum: values }, text),
			};
		}
		case "List": {
			const items = nodes.filter((e) => PARAMS.includes(e.node.tag));
			if (items.length !== 1)
				issues.push(`${where}: List takes one param, its items', not ${items.length}`);
			schema = {
				type: "array",
				...(items.length === 1
					? { items: lowerParam(items[0], `${where} > item`, false, issues).schema }
					: {}),
				...kept(attrs, [
					["minItems", "minItems"],
					["maxItems", "maxItems"],
				]),
			};
			break;
		}
	}
	return {
		name: attrs.name,
		required: attrs.optional !== true,
		schema: withDescription(schema, description),
	};
};

const lowerTool = ({ node, markers }, where, issues) => {
	const { attrs } = node;
	attrsIssues("Tool", TOOLS.Tool, attrs, where, issues);
	const { name } = attrs;
	if (typeof name === "string" && !NAME.test(name)) {
		issues.push(
			`${where}: a tool's name is 1 to 64 letters, digits, _ or -, not ${JSON.stringify(name)}`,
		);
	}
	const children = flatten(node.children, markers);
	const properties = {};
	const required = [];
	for (const [i, e] of children.filter((c) => c.node !== undefined).entries()) {
		const at = `${where} > ${e.node.tag}[${i}]`;
		const issue = childIssue("Tool", TOOLS.Tool, e.node.tag);
		if (issue !== null) {
			issues.push(`${at}: ${issue}`);
			continue;
		}
		const p = lowerParam(e, at, true, issues);
		if (p.name == null) continue;
		if (p.name in properties) issues.push(`${at}: Tool ${name} has two params ${p.name}`);
		properties[p.name] = p.schema;
		if (p.required) required.push(p.name);
	}
	const input_schema = { type: "object", properties, additionalProperties: false };
	if (required.length > 0) input_schema.required = required;
	const description = textOf(children);
	const tool = description === "" ? { name, input_schema } : { name, description, input_schema };
	return { tool, call: { eid: attrs["data-eid"], markers, schema: input_schema } };
};

// The tools, and how to call each, that the vnodes a renders.llmTools rendered say. Tools nest:
// a child component's are among its parent's.
export const lowerTools = (vnodes) => {
	const issues = [];
	const tools = [];
	const calls = new Map();
	const visit = (entries, where) => {
		entries.forEach((e, i) => {
			if (e.text !== undefined) {
				const issue = textIssue("Tools", TOOLS.Tools, e.text.trim());
				if (e.text.trim() !== "") issues.push(`${where}: ${issue}`);
				return;
			}
			const tag = e.node.tag;
			if (tag === "Tools") {
				// Tools only group: what's in them is said as if it were here.
				attrsIssues(tag, TOOLS.Tools, e.node.attrs, `${where}Tools`, issues);
				visit(flatten(e.node.children, e.markers), where);
			} else if (tag === "Tool") {
				const at = `${where}Tool ${e.node.attrs.name ?? `[${i}]`}`;
				const { tool, call } = lowerTool(e, at, issues);
				if (calls.has(tool.name)) issues.push(`${at}: there are two tools ${tool.name}`);
				tools.push(tool);
				calls.set(tool.name, call);
			} else issues.push(`${where}${tag}: a llmTools render renders Tools and Tool, not ${tag}`);
		});
	};
	visit(flatten(vnodes), "");
	if (issues.length > 0) throw new LlmError(issues);
	return { tools, calls };
};

const renderedTools = (instance, view) => {
	const ctx = RenderContext.root(instance, { target: llmToolsTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return lowerTools(toVChildren(node.eval(ctx.with({ component: instance }))));
};
// The tool definitions instance's renders.llmTools (view, or main) says: what to give a model
// as its tools. Throws an LlmError listing what isn't valid.
export const renderLlmTools = (instance, { view } = {}) => renderedTools(instance, view).tools;

// What's wrong with value as schema says, each issue a sentence a model reads.
const valueIssues = (value, schema, where, issues) => {
	const is = (ok, expected) => {
		if (!ok) issues.push(`${where} is ${expected}, not ${JSON.stringify(value)}`);
		return ok;
	};
	if (schema.enum !== undefined) {
		is(
			schema.enum.includes(value),
			`one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
		);
		return;
	}
	switch (schema.type) {
		case "string":
			if (!is(typeof value === "string", "a string")) return;
			if (schema.minLength !== undefined)
				is(value.length >= schema.minLength, `at least ${schema.minLength} characters`);
			if (schema.maxLength !== undefined)
				is(value.length <= schema.maxLength, `at most ${schema.maxLength} characters`);
			if (schema.pattern !== undefined)
				is(new RegExp(schema.pattern, "u").test(value), `text matching ${schema.pattern}`);
			return;
		case "number":
		case "integer":
			if (schema.type === "integer") {
				if (!is(Number.isInteger(value), "an integer")) return;
			} else if (!is(typeof value === "number" && Number.isFinite(value), "a number")) return;
			if (schema.minimum !== undefined) is(value >= schema.minimum, `at least ${schema.minimum}`);
			if (schema.maximum !== undefined) is(value <= schema.maximum, `at most ${schema.maximum}`);
			return;
		case "boolean":
			is(typeof value === "boolean", "true or false");
			return;
		case "array":
			if (!is(Array.isArray(value), "an array")) return;
			if (schema.minItems !== undefined)
				is(value.length >= schema.minItems, `at least ${schema.minItems} items`);
			if (schema.maxItems !== undefined)
				is(value.length <= schema.maxItems, `at most ${schema.maxItems} items`);
			if (schema.items !== undefined) {
				for (const [i, item] of value.entries()) {
					valueIssues(item, schema.items, `${where}[${i}]`, issues);
				}
			}
			return;
		case "object": {
			if (!is(value !== null && typeof value === "object" && !Array.isArray(value), "an object"))
				return;
			const names = Object.keys(schema.properties);
			for (const name of schema.required ?? []) {
				if (value[name] === undefined)
					issues.push(`${where === "input" ? "" : `${where}.`}${name} is required`);
			}
			for (const [name, v] of Object.entries(value)) {
				if (schema.properties[name] === undefined) {
					const takes = names.length === 0 ? "nothing" : names.join(", ");
					issues.push(`there's no ${name} (it takes ${takes})`);
				} else if (v !== undefined) valueIssues(v, schema.properties[name], name, issues);
			}
		}
	}
};
export const inputIssues = (schema, input) => {
	const issues = [];
	valueIssues(input, schema, "input", issues);
	return issues;
};

// Calls the tool name of what host's root renders now with input, as a model's tool use does:
// its input is checked against the tool's schema, then its on:call send goes to the component it
// was rendered in, now, as a click's does. Throws a ToolCallError when there's no such tool or
// the input doesn't fit. Returns the send: { name, args, to, task }.
export const callLlmTool = (host, { name, input = {} }, { view } = {}) => {
	const root = host.root;
	const { calls } = renderedTools(root, view);
	const call = calls.get(name);
	if (call === undefined) {
		const names = [...calls.keys()];
		throw new ToolCallError([
			`there's no tool ${name} now (the tools are ${names.length === 0 ? "none" : names.join(", ")})`,
		]);
	}
	const issues = inputIssues(call.schema, input);
	if (issues.length > 0) throw new ToolCallError(issues);
	const to = Address.at(pathOfMarkers([...call.markers].reverse()), root);
	const handlers = specOf(to.keyPath.getIn(root)).eventHandlers.get(call.eid) ?? [];
	const { action } = handlers.find((h) => h.type === "call");
	// What a handler shared with the page reads of the event is there: ctx.event.preventDefault().
	const event = { type: "call", tool: name, input, preventDefault() {} };
	const path = to.path.toNodePath();
	const ctx = { event, node: null, drag: null, path, sourceKey: to.path.sourceKeyIn(path) };
	const args = action.args.map((arg) => arg.eval(ctx));
	const task = host.send(action.name, args, { to, now: true, event });
	return { name: action.name, args, to, task };
};

// A micro-agent is one component module (a .wasm tcd built) with a custom
// section named "microagent" holding its metadata as JSON:
//
//   { format: 1, id, title, description, needs, icon, version, root,
//     hostFns?: [engines/ modules], prompt, skills: { path: text }, tools: [{ name, kind, description?,
//     result? }], toolViews?: { tool: type }, samples: { name: json } }
//
// Its root type implements kit.tcd's MicroAgent (summary, domain, data). A
// JSON document opens with an agent when the root makes from it with no
// issue but missing fields that have defaults: the root's fields are the
// document's keys, so its types and where clauses say what it opens. A
// message tool is a message of the root, a view tool a query or a get; their
// arguments' names and types come from the root's schema.

import { customSection, withCustomSection } from "../js/tutuca-rt.js";
import { defineHostFns, HOST_FN_MODULES } from "./engines/index.js";

export const AGENT_SECTION = "microagent";
export const AGENT_FORMAT = 1;
export const TOOL_KINDS = new Set(["message", "view"]);

// The agent's metadata, or null when the bytes aren't an agent.
export function agentMeta(bytes) {
	const text = customSection(bytes, AGENT_SECTION);
	return text === null ? null : JSON.parse(text);
}

// The module's bytes as an agent with meta.
export const packAgent = (wasm, meta) => withCustomSection(wasm, AGENT_SECTION, JSON.stringify({ format: AGENT_FORMAT, ...meta }));

// What's wrong with meta itself, in words.
export function metaProblems(meta) {
	const out = [];
	if (meta?.format !== AGENT_FORMAT) out.push(`format ${meta?.format} isn't ${AGENT_FORMAT}`);
	for (const key of ["id", "title", "root", "prompt"]) {
		if (typeof meta?.[key] !== "string" || meta[key] === "") out.push(`${key} is missing`);
	}
	if (typeof meta?.id === "string" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.id)) out.push(`id ${meta.id} isn't kebab-case`);
	if (!Array.isArray(meta?.tools)) out.push("tools is missing");
	for (const tool of meta?.tools ?? []) {
		if (!TOOL_KINDS.has(tool.kind)) out.push(`tool ${tool.name} has kind ${tool.kind}, not message or view`);
	}
	if (meta?.samples?.empty === undefined) out.push('there is no "empty" sample');
	for (const name of meta?.hostFns ?? []) {
		if (!(name in HOST_FN_MODULES)) out.push(`there are no host functions ${name}`);
	}
	return out;
}

// What's missing for a field: those with a default only say "missing".
const blocking = (issues) => issues.filter((i) => i.problem !== "missing");

// Whether the agent's root makes from json: { ok, issues, error }.
export function fits(tw, agent, json) {
	if (json === null || typeof json !== "object" || Array.isArray(json)) {
		return { ok: false, issues: [], error: "the document isn't a JSON object" };
	}
	const issues = tw.runtime.issues(agent.scope, agent.meta.root, json);
	try {
		tw.runtime.make(agent.scope, agent.meta.root, json);
	} catch (error) {
		return { ok: false, issues, error: error.message };
	}
	const bad = blocking(issues);
	return { ok: bad.length === 0, issues: bad, error: "" };
}

// Why json doesn't open with agent, in words ("" when it does).
export function mismatchText(fit) {
	if (fit.ok) return "";
	const parts = fit.issues.map((i) => `${i.field}: ${i.problem}`);
	if (fit.error !== "") parts.unshift(fit.error);
	return parts.join("; ");
}

// The root made from json, in the agent's scope.
export const openWith = (tw, agent, json) => tw.runtime.make(agent.scope, agent.meta.root, json);

// The tools of agent that its root has, and what's wrong with the rest:
// { problems } checking root (one made from a sample) against meta.
export function contractProblems(tw, agent, root) {
	const { runtime } = tw;
	const out = [];
	const schema = runtime.schema(root);
	if (schema === null) return ["the root has no schema"];
	if (!schema.interfaces.includes("MicroAgent")) out.push(`${agent.meta.root} doesn't implement MicroAgent`);
	const messages = new Set(schema.messages.map((m) => m.name));
	const queries = new Set(schema.queries.map((q) => q.name));
	const gets = new Set([...schema.gets, ...schema.fields].map((g) => g.name));
	for (const tool of agent.meta.tools) {
		if (tool.kind === "message" && !messages.has(tool.name)) out.push(`message tool ${tool.name} isn't a message of ${agent.meta.root}`);
		if (tool.kind === "view" && !queries.has(tool.name) && !gets.has(tool.name)) {
			out.push(`view tool ${tool.name} isn't a query or get of ${agent.meta.root}`);
		}
		if (tool.result !== undefined && !gets.has(tool.result)) out.push(`tool ${tool.name}'s result ${tool.result} isn't a get of ${agent.meta.root}`);
	}
	for (const [tool, type] of Object.entries(agent.meta.toolViews ?? {})) {
		try {
			runtime.make(agent.scope, type, { call: null, result: null, kind: "" });
		} catch (error) {
			out.push(`tool view ${type} (for ${tool}) can't be made: ${error.message}`);
		}
	}
	for (const [name, sample] of Object.entries(agent.meta.samples)) {
		const fit = fits(tw, agent, sample);
		if (!fit.ok) out.push(`sample ${name} doesn't open: ${mismatchText(fit)}`);
	}
	return out;
}

// Loads the agent in bytes into a child scope of parent named after its id:
// { meta, scope, problems, classes } (problems empty when it's usable;
// classes the ones its views use, for the CSS). The kit's
// types (MicroAgent) must be visible from parent.
export async function loadAgent(tw, bytes, parent) {
	const meta = agentMeta(bytes);
	if (meta === null) return { meta: null, scope: null, problems: ["it has no microagent section"] };
	const problems = metaProblems(meta);
	if (problems.length > 0) return { meta, scope: null, problems };
	const scope = tw.runtime.enter(parent, `agent:${meta.id}`);
	const agent = { meta, scope, problems, classes: [] };
	try {
		await defineHostFns(tw.runtime, meta.hostFns ?? []);
	} catch (error) {
		problems.push(`its host functions don't load: ${error.message}`);
		return agent;
	}
	try {
		agent.classes = (await tw.loadComponent(bytes, scope)).classes;
	} catch (error) {
		problems.push(error.message);
		return agent;
	}
	try {
		problems.push(...contractProblems(tw, agent, openWith(tw, agent, meta.samples.empty)));
	} catch (error) {
		problems.push(`the empty sample doesn't open: ${error.message}`);
	}
	return agent;
}

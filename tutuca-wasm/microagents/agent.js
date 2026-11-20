// A micro-agent is a package, a JSON document: one pure-tutuca component module, as text, with
// what the shell needs to offer it:
//
//   { format: 2, id, title, description, needs, icon, version, root, source,
//     hostModules?: [engines/ modules], prompt, skills: { path: text },
//     tools: [{ name, kind, description?, result? }], toolViews?: { tool: type },
//     samples: { name: json } }
//
// The shell checks and compiles source as it loads the agent, into a scope of its own. Its root
// type implements kit.tutuca.ts's MicroAgent (summary, domain, data). A JSON document opens
// with an agent when the root makes from it as it is: the root's fields are the document's
// keys, so its types and constraints say what it opens. A message tool is a message of the
// root, a view tool a query; their arguments' names and types are the module's.
import { HOST_MODULES, hostModulesFor } from "./engines/index.js";

export const AGENT_FORMAT = 2;
export const TOOL_KINDS = new Set(["message", "view"]);

/** The scope an agent's components are registered in. */
export const scopeOf = (id) => [`agent:${id}`];

/** A package from text, or null when it isn't one. */
export function parsePackage(text) {
	try {
		const pkg = JSON.parse(text);
		return pkg !== null &&
			typeof pkg === "object" &&
			typeof pkg.source === "string" &&
			"root" in pkg
			? pkg
			: null;
	} catch {
		return null;
	}
}

/** What's wrong with a package itself, in words. */
export function metaProblems(meta) {
	const out = [];
	if (meta?.format !== AGENT_FORMAT) out.push(`format ${meta?.format} isn't ${AGENT_FORMAT}`);
	for (const key of ["id", "title", "root", "prompt", "source"]) {
		if (typeof meta?.[key] !== "string" || meta[key] === "") out.push(`${key} is missing`);
	}
	if (typeof meta?.id === "string" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.id)) {
		out.push(`id ${meta.id} isn't kebab-case`);
	}
	if (!Array.isArray(meta?.tools)) out.push("tools is missing");
	for (const tool of meta?.tools ?? []) {
		if (!TOOL_KINDS.has(tool.kind)) {
			out.push(`tool ${tool.name} has kind ${tool.kind}, not message or view`);
		}
	}
	if (meta?.samples?.empty === undefined) out.push('there is no "empty" sample');
	for (const name of meta?.hostModules ?? []) {
		if (!(name in HOST_MODULES)) out.push(`there is no host module ${name}`);
	}
	return out;
}

/** Whether the agent's root makes from json: { ok, issues, error }. */
export function fits(tutuca, agent, json) {
	if (json === null || typeof json !== "object" || Array.isArray(json)) {
		return { ok: false, issues: [], error: "the document isn't a JSON object" };
	}
	return tutuca.fits(agent.meta.root, json, { scope: agent.scope });
}

/** Why json doesn't open with an agent, in words ("" when it does). */
export function mismatchText(fit) {
	if (fit.ok) return "";
	const parts = fit.issues.map((i) => (i.field === "" ? i.problem : `${i.field}: ${i.problem}`));
	if (fit.error !== "") parts.unshift(fit.error);
	return parts.join("; ");
}

/** The agent's root made from json, as what a runtime makes: in the agent's scope. */
export const rootFrom = (agent, json) => ({
	$make: agent.meta.root,
	scope: agent.scope,
	fields: json,
});

/** What of the agent's package its module doesn't hold up, in words. */
export function contractProblems(tutuca, agent) {
	const out = [];
	const root = agent.definitions[agent.meta.root];
	if (root === undefined) return [`its module has no component ${agent.meta.root}`];
	if (!root.implements.includes("MicroAgent")) {
		out.push(`${agent.meta.root} doesn't implement MicroAgent`);
	}
	for (const tool of agent.meta.tools) {
		if (tool.kind === "message" && root.on[tool.name] === undefined) {
			out.push(`message tool ${tool.name} isn't a message of ${agent.meta.root}`);
		}
		if (tool.kind === "view" && root.queries[tool.name] === undefined) {
			out.push(`view tool ${tool.name} isn't a query of ${agent.meta.root}`);
		}
		if (tool.result !== undefined && root.queries[tool.result] === undefined) {
			out.push(`tool ${tool.name}'s result ${tool.result} isn't a query of ${agent.meta.root}`);
		}
	}
	for (const [tool, type] of Object.entries(agent.meta.toolViews ?? {})) {
		const fit = tutuca.fits(type, { call: null, result: null, kind: "" }, { scope: agent.scope });
		if (fit.error !== "") out.push(`tool view ${type} (for ${tool}) can't be made: ${fit.error}`);
	}
	for (const [name, sample] of Object.entries(agent.meta.samples)) {
		const fit = fits(tutuca, agent, sample);
		if (!fit.ok) out.push(`sample ${name} doesn't open: ${mismatchText(fit)}`);
	}
	return out;
}

/**
 * Loads a package's module into its scope of a runtime: { meta, scope, definitions, problems }
 * (problems empty when it's usable). kit is the kit module's text, which agents import the
 * MicroAgent interface from; the kit itself must be loaded in a scope above.
 */
export async function loadAgent(tutuca, meta, kit) {
	const problems = metaProblems(meta);
	const agent = { meta, scope: null, definitions: {}, problems };
	if (problems.length > 0) return agent;
	agent.scope = scopeOf(meta.id);
	// Loaded again, it replaces what its scope had.
	tutuca.leave(agent.scope);
	let hostModules;
	try {
		hostModules = await hostModulesFor(meta.hostModules ?? []);
	} catch (error) {
		problems.push(`its host functions don't load: ${error.message}`);
		return agent;
	}
	try {
		const loaded = await tutuca.load(meta.source, {
			scope: agent.scope,
			hostModules,
			resolve: (spec) => (/(^|\/)kit\.tutuca(\.ts)?$/.test(spec) ? kit : null),
		});
		if (!loaded.ok) {
			problems.push(...loaded.diagnostics.map((d) => `${d.code}: ${d.message}`));
			return agent;
		}
		agent.definitions = loaded.definitions;
	} catch (error) {
		problems.push(error.message);
		return agent;
	}
	problems.push(...contractProblems(tutuca, agent));
	return agent;
}

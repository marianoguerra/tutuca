// Packs a micro-agent's folder (microagents/agents/<id>/) into the
// microagent section of its built module (microagents/agent.js has the
// format):
//
//   manifest.json   { id, title, description, needs, icon, version, root,
//                     skills: [paths], tools: [{ name, kind, description?,
//                     result? }], toolViews? }
//   prompt.md       the system prompt
//   skills/<path>   the read-only skills folder
//   samples/*.json  JSON documents it opens; empty.json is the one "New" opens
//
// A tool without a description takes its message's or query's /// doc from
// the package's model (tcd model), so the .tcd says it once.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { metaProblems, packAgent } from "../microagents/agent.js";

// The doc of root's message, query or get name, from model (tcd model's JSON).
const docOf = (model, root, name) => {
	const c = model?.components?.find((x) => x.name === root);
	const member = [...(c?.messages ?? []), ...(c?.queries ?? []), ...(c?.gets ?? []), ...(c?.fields ?? [])].find((m) => m.name === name);
	return member?.doc ?? undefined;
};

// The agent's metadata, from its folder dir and its package's model.
export function agentMetaOf(dir, model) {
	const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
	const { skills: skillPaths = [], tools = [], ...rest } = manifest;
	const skills = Object.fromEntries(skillPaths.map((p) => [p, readFileSync(join(dir, "skills", p), "utf8")]));
	const samples = Object.fromEntries(
		readdirSync(join(dir, "samples"))
			.filter((f) => f.endsWith(".json"))
			.sort()
			.map((f) => [f.slice(0, -".json".length), JSON.parse(readFileSync(join(dir, "samples", f), "utf8"))]),
	);
	return {
		...rest,
		prompt: readFileSync(join(dir, "prompt.md"), "utf8"),
		skills,
		tools: tools.map((t) => {
			const description = t.description ?? docOf(model, manifest.root, t.name);
			return description === undefined ? t : { ...t, description };
		}),
		samples,
	};
}

// The built module wasm (bytes) packed as the agent in dir.
export function packAgentDir(dir, wasm, model) {
	const meta = agentMetaOf(dir, model);
	const problems = metaProblems({ format: 1, ...meta });
	if (problems.length > 0) throw new Error(`${dir}: ${problems.join("; ")}`);
	return packAgent(wasm, meta);
}

// Packs each micro-agent's folder (agents/<id>/) into its package, dist/agents/<id>.json
// (agent.js has the format), and lists them in dist/agents/index.json:
//
//   agent.tutuca.ts the module
//   manifest.json   { id, title, description, needs, icon, version, root, hostModules?,
//                     skills: [paths], tools: [{ name, kind, description?, result? }], toolViews? }
//   prompt.md       the system prompt
//   skills/<path>   the read-only skills folder
//   samples/*.json  JSON documents it opens; empty.json is the one "New" opens
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_FORMAT, metaProblems } from "./agent.js";

const here = fileURLToPath(new URL("./", import.meta.url));
const read = (path) => readFileSync(path, "utf8");

/** The package of the agent in a folder. */
export function packAgentDir(dir) {
	const { skills = [], ...manifest } = JSON.parse(read(join(dir, "manifest.json")));
	const samples = readdirSync(join(dir, "samples"))
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => [f.slice(0, -".json".length), JSON.parse(read(join(dir, "samples", f)))]);
	const meta = {
		format: AGENT_FORMAT,
		...manifest,
		prompt: read(join(dir, "prompt.md")),
		skills: Object.fromEntries(skills.map((p) => [p, read(join(dir, "skills", p))])),
		samples: Object.fromEntries(samples),
		source: read(join(dir, "agent.tutuca.ts")),
	};
	const problems = metaProblems(meta);
	if (problems.length > 0) throw new Error(`${dir}: ${problems.join("; ")}`);
	return meta;
}

export const agentIds = () => readdirSync(join(here, "agents")).sort();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const out = process.argv[2] ?? join(here, "../dist/agents");
	mkdirSync(out, { recursive: true });
	for (const id of agentIds()) {
		writeFileSync(join(out, `${id}.json`), JSON.stringify(packAgentDir(join(here, "agents", id))));
	}
	writeFileSync(join(out, "index.json"), JSON.stringify(agentIds()));
	console.log(`${agentIds().length} agents packed in ${out}`);
}

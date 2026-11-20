// Writes spec/pure-tutuca/golden/<dir>-<case>.json: what tutuca JS's loader (componentModule)
// gives for each module of the shared corpus, spec/pure-tutuca/conformance/<accept|reject>/:
// its diagnostics' codes and, when it loads, its model (format 2): what another loader of
// the same modules is held to. It also writes the host modules' declarations
// (src/pure/data.js) where one reads them: spec/pure-tutuca/host/data.json.
// Run it after changing a case, the conventions or a host module:
// node scripts/pure-tutuca-goldens.js

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDeclaration } from "../src/pure/data.js";
import { componentModule } from "../src/pure/module.js";

const root = fileURLToPath(new URL("../spec/pure-tutuca/", import.meta.url));
export const corpus = () =>
	["accept", "reject"].flatMap((dir) =>
		readdirSync(join(root, "conformance", dir))
			.filter((f) => f.endsWith(".tutuca.ts"))
			.sort()
			.map((f) => ({
				dir,
				name: f.replace(/\.tutuca\.ts$/, ""),
				source: readFileSync(join(root, "conformance", dir, f), "utf8"),
			})),
	);
// The page modules the corpus's cases may import (spec/pure-tutuca/host/*.json but data.json,
// which is tutuca/data's): declarations only, no implementations, as checking needs.
const pageModules = () =>
	readdirSync(join(root, "host"))
		.filter((f) => f.endsWith(".json") && f !== "data.json")
		.sort()
		.map((f) => JSON.parse(readFileSync(join(root, "host", f), "utf8")));
export const evaluateCorpusCase = (c) => {
	const r = componentModule(c.source, { hostModules: pageModules() });
	return { codes: r.diagnostics.map((d) => d.code), model: r.model };
};
export const goldenPath = (c) => join(root, "golden", `${c.dir}-${c.name}.json`);

// The generated copies of the host modules' declarations: { path: text }.
export const hostFiles = () => {
	const json = `${JSON.stringify(dataDeclaration, null, 1)}\n`;
	return {
		[join(root, "host", "data.json")]: json,
	};
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	mkdirSync(join(root, "golden"), { recursive: true });
	let n = 0;
	for (const c of corpus()) {
		writeFileSync(goldenPath(c), `${JSON.stringify(evaluateCorpusCase(c), null, 1)}\n`);
		n++;
	}
	mkdirSync(join(root, "host"), { recursive: true });
	for (const [path, text] of Object.entries(hostFiles())) writeFileSync(path, text);
	console.log(`wrote ${n} goldens and the host modules' declarations`);
}

// Writes test/golden/<outcome>/<name>.json: what the suite knows of each conformance case,
// its verdict, its tree without positions, its inferred return type and how its run went. The
// tests hold the implementation to these files, and so is the MoonBit port. Run it after
// changing a case or the language on purpose: node tools/goldens.js

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, GOLDEN, loadCases, OUTCOMES } from "../test/cases.js";
import { evaluateModule, loadModuleCases, MODULE_GOLDEN } from "../test/modules.js";

for (const dir of OUTCOMES) mkdirSync(join(GOLDEN, dir), { recursive: true });
let n = 0;
for (const c of loadCases()) {
	const { result } = evaluate(c);
	writeFileSync(join(GOLDEN, c.dir, `${c.name}.json`), `${JSON.stringify(result, null, 1)}\n`);
	n++;
}
for (const dir of OUTCOMES) mkdirSync(join(MODULE_GOLDEN, dir), { recursive: true });
for (const c of loadModuleCases()) {
	const { result } = evaluateModule(c);
	writeFileSync(
		join(MODULE_GOLDEN, c.dir, `${c.name}.json`),
		`${JSON.stringify(result, null, 1)}\n`,
	);
	n++;
}
console.log(`wrote ${n} goldens`);

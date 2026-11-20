// The conformance suite (cases.js): every case's verdict is the one its directory says, its
// first diagnostic is the one it @expects, what the suite knows of it is its golden, the
// compiled and interpreted runs agree, and nothing a run does reaches past its arguments.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { evaluate, GOLDEN, loadCases, OUTCOMES } from "./cases.js";

const EXITS = {
	accept: [0],
	"reject-syntax": [1, 2, 4],
	"reject-static": [3],
	undefined: [0],
	escapes: [0, 1, 2, 3, 4],
};
const ratchet = JSON.parse(readFileSync(new URL("./ratchet.json", import.meta.url), "utf8"));

const canaries = () => ({
	global: Object.getOwnPropertyNames(globalThis).length,
	objectProto: Object.getOwnPropertyNames(Object.prototype).join(),
	arrayProto: Object.getOwnPropertyNames(Array.prototype).join(),
	functionProto: Object.getOwnPropertyNames(Function.prototype).join(),
	polluted: {}.polluted,
});

const cases = loadCases();
describe("conformance", () => {
	test("no outcome has fewer cases than the ratchet holds", () => {
		for (const dir of OUTCOMES) {
			const n = cases.filter((c) => c.dir === dir).length;
			assert.ok(
				n >= ratchet.conformance[dir],
				`${dir}: ${n} cases, the ratchet holds ${ratchet.conformance[dir]}`,
			);
		}
	});
	for (const c of cases) {
		test(c.file, () => {
			const before = canaries();
			const { result, runs } = evaluate(c);
			assert.deepEqual(canaries(), before, "a run reached past its arguments");
			assert.ok(
				EXITS[c.dir].includes(result.exit),
				`exit ${result.exit} (${result.codes.join(", ")})`,
			);
			if (c.directives.expect !== undefined) assert.equal(result.codes[0], c.directives.expect);
			if (c.dir === "undefined") assert.equal(result.outcome?.kind, "undefined");
			if (c.dir === "accept" && c.directives.run !== undefined)
				assert.equal(result.outcome?.kind, "finished");
			if (runs !== null)
				assert.deepEqual(
					runs.interpreted,
					runs.compiled,
					"the interpreter and the compiled function disagree",
				);
			const golden = join(GOLDEN, c.dir, `${c.name}.json`);
			assert.ok(existsSync(golden), "no golden: run node tools/goldens.js");
			assert.deepEqual(result, JSON.parse(readFileSync(golden, "utf8")));
		});
	}
});

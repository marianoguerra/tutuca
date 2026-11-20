// The pure-tutuca corpus (spec/pure-tutuca/): every module gives its golden, accepted ones load
// with no diagnostics, rejected ones with the code they @expect.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	corpus,
	evaluateCorpusCase,
	goldenPath,
	hostFiles,
} from "../../scripts/pure-tutuca-goldens.js";

describe("pure-tutuca corpus", () => {
	for (const c of corpus()) {
		test(`${c.dir}/${c.name}`, () => {
			const result = evaluateCorpusCase(c);
			if (c.dir === "accept") assert.deepEqual(result.codes, []);
			else {
				const expect = /\/\/\s*@expect\s+(\S+)/.exec(c.source)?.[1];
				assert.equal(result.codes[0], expect);
			}
			assert.ok(existsSync(goldenPath(c)), "no golden: node scripts/pure-tutuca-goldens.js");
			assert.deepEqual(result, JSON.parse(readFileSync(goldenPath(c), "utf8")));
		});
	}
	test("the host modules' generated declarations are current", () => {
		for (const [path, text] of Object.entries(hostFiles())) {
			assert.equal(
				readFileSync(path, "utf8"),
				text,
				`${path}: node scripts/pure-tutuca-goldens.js`,
			);
		}
	});
});

// The shared conformance vectors (tdata/vectors), run against the Wax implementation: the same
// files tdata/js/test/vectors.test.ts runs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, test } from "node:test";
import { load } from "./tdata.mjs";

const vectors = (name) =>
	JSON.parse(readFileSync(new URL(`../../vectors/${name}`, import.meta.url), "utf8"));
const hex = (u8) => Buffer.from(u8).toString("hex");
const unhex = (s) => new Uint8Array(Buffer.from(s, "hex"));

const td = await load();

for (const [file, message] of [
	["values.json", false],
	["messages.json", true],
]) {
	describe(file, () => {
		for (const v of vectors(file)) {
			test(v.name, () => {
				assert.equal(td.jsonCanon(v.json, message), v.json);
				assert.equal(hex(td.jsonToCbor(v.json, message)), v.cbor);
				assert.equal(td.cborToJson(unhex(v.cbor), message), v.json);
			});
		}
	});
}

describe("invalid.json", () => {
	for (const v of vectors("invalid.json")) {
		test(v.name, () => {
			if (v.json !== undefined) assert.throws(() => td.jsonCanon(v.json, Boolean(v.message)));
			else assert.throws(() => td.cborToJson(unhex(v.cbor), Boolean(v.message)));
		});
	}
});

describe("specs.json", () => {
	const { registry, cases } = vectors("specs.json");
	before(() => {
		td.resetSpecs();
		td.loadSpecs(registry);
	});
	for (const c of cases) {
		test(c.name, () => {
			const r = td.check(c.spec, c.message ?? c.value, c.message !== undefined);
			// The result is tdata JSON: arrays come escaped, [[…]].
			const paths = (list) => list[0].map((p) => p.path[0]);
			if (c.ok) {
				assert.equal(r.ok, true, `expected a match, got ${JSON.stringify(r.problems)}`);
				if (c.picks)
					assert.deepEqual(
						r.picks[0].map((p) => ({ path: p.path[0], alt: p.alt })),
						c.picks,
					);
			} else {
				assert.equal(r.ok, false, "expected no match");
				if (c.problems) assert.deepEqual(paths(r.problems), c.problems);
			}
		});
	}
});

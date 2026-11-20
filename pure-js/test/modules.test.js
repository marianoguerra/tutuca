// The module conformance suite (modules.js) and its oracles: every case's verdict is the one
// its directory says, its first diagnostic the one it @expects, what the suite knows of it its
// golden, the compiled and interpreted runs agree; acorn parses each module as its erased
// tree, the printer's output parses back to the same tree, and tsc accepts every module
// pure-js accepts (and rejects the controls whose errors are TypeScript's too).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import * as acorn from "acorn";
import { eraseModule, parseModule, print } from "../lib/index.js";
import { stripTree } from "./cases.js";
import { moduleHost } from "./host.js";
import { evaluateModule, loadModuleCases, MODULE_GOLDEN, signaturesOf } from "./modules.js";
import { typecheckModules } from "./tsc.js";

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
});

const cases = loadModuleCases();
describe("module conformance", () => {
	test("no outcome has fewer cases than the ratchet holds", () => {
		for (const [dir, n] of Object.entries(ratchet.modules)) {
			const have = cases.filter((c) => c.dir === dir).length;
			assert.ok(have >= n, `${dir}: ${have} cases, the ratchet holds ${n}`);
		}
	});
	for (const c of cases) {
		test(c.file, () => {
			const before = canaries();
			const { result, runs } = evaluateModule(c);
			assert.deepEqual(canaries(), before, "a run reached past its arguments");
			assert.ok(
				EXITS[c.dir].includes(result.exit),
				`exit ${result.exit} (${result.codes.join(", ")})`,
			);
			if (c.directives.expect !== undefined) assert.equal(result.codes[0], c.directives.expect);
			if (c.dir === "undefined") assert.equal(result.outcome?.kind, "undefined");
			if (c.dir === "accept" && c.directives.run !== undefined)
				assert.equal(result.outcome?.kind, "finished", JSON.stringify(result.outcome));
			if (runs !== null)
				assert.deepEqual(
					runs.interpreted,
					runs.compiled,
					"the interpreter and the compiled module disagree",
				);
			const golden = join(MODULE_GOLDEN, c.dir, `${c.name}.json`);
			assert.ok(existsSync(golden), "no golden: run node tools/goldens.js");
			assert.deepEqual(result, JSON.parse(readFileSync(golden, "utf8")));
		});
	}
});

const parsed = cases
	.map((c) => ({ c, module: parseModule(c.source).module }))
	.filter((x) => x.module !== null);
const unspelled = (tree) =>
	JSON.parse(
		JSON.stringify(stripTree(tree), (_k, v) =>
			v?.type === "Literal" && typeof v.value === "string" ? { ...v, raw: undefined } : v,
		),
	);
describe("module oracles", () => {
	for (const { c, module } of parsed) {
		test(`acorn parses ${c.file} as its erased tree`, () => {
			const js = print(module);
			const theirs = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module" });
			const ours = eraseModule(parseModule(js).module);
			assert.deepEqual(stripTree(theirs.body), stripTree(ours.items));
		});
		test(`the printer round-trips ${c.file}`, () => {
			for (const types of [true, false]) {
				const text = print(module, { types });
				const again = parseModule(text).module;
				assert.notEqual(again, null, text);
				const [got, want] = types ? [again, module] : [eraseModule(again), eraseModule(module)];
				assert.deepEqual(unspelled(got.items), unspelled(want.items));
			}
		});
	}
	const accepted = cases.filter((c) => evaluateModule(c).result.exit === 0);
	const asCase = (c) => ({
		id: c.file,
		module: parseModule(c.source).module,
		files: c.files,
		signatureOf: signaturesOf(c.directives),
	});
	const { rejected } = typecheckModules(accepted.map(asCase), moduleHost);
	for (const c of accepted)
		test(`tsc accepts ${c.file}`, () => assert.deepEqual(rejected.get(c.file) ?? [], []));
	const SHARED = new Set(["not-assignable", "immutable-target", "unknown-name"]);
	// Not the cases whose types the embedder gives by @data: nothing says them in TypeScript.
	const controls = cases.filter(
		(c) => c.dir !== "accept" && SHARED.has(c.directives.expect) && c.directives.data === undefined,
	);
	const control = typecheckModules(controls.map(asCase), moduleHost).rejected;
	for (const c of controls)
		test(`tsc rejects ${c.file}`, () => assert.ok(control.has(c.file), "tsc accepts it"));
});

// The oracles: the parser makes acorn's trees, the printer's output parses back to the same
// tree, and TypeScript (tsc --strict, noUncheckedIndexedAccess) accepts every program pure-js
// accepts, as PurePy's well-formed programs are well typed under mypy. As a control, tsc also
// rejects the ill-typed programs whose errors are TypeScript's too.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import * as acorn from "acorn";
import { erase, parse, print, printFunction, walk } from "../lib/index.js";
import { evaluate, loadCases, signatureOf, stripTree } from "./cases.js";
import { host } from "./host.js";
import { typecheck } from "./tsc.js";

const ratchet = JSON.parse(readFileSync(new URL("./ratchet.json", import.meta.url), "utf8"));
const cases = loadCases();
const parsed = cases
	.map((c) => ({ c, program: parse(c.source).program }))
	.filter((x) => x.program !== null);
const typed = (program) => {
	let found = false;
	walk(program, (n) => {
		if (n.typeAnnotation || n.returnType) found = true;
	});
	return found;
};
const shift = (tree, by) =>
	JSON.parse(
		JSON.stringify(tree, (k, v) =>
			(k === "start" || k === "end") && typeof v === "number" ? v + by : v,
		),
	);
const plain = (tree) => JSON.parse(JSON.stringify(tree));

describe("acorn", () => {
	for (const { c, program } of parsed) {
		test(c.file, () => {
			const ours = plain(erase(program.function));
			if (typed(program)) {
				// Erased, printed and parsed again by acorn: the same program without its types.
				const text = printFunction(program);
				const theirs = acorn.parseExpressionAt(text, 0, { ecmaVersion: "latest" });
				assert.deepEqual(stripTree(theirs), stripTree(ours));
				return;
			}
			const src = c.source;
			if (program.form === "method" || program.form === "getter") {
				const wrapped = `${src.slice(0, program.start)}({${src.slice(program.start)}})`;
				const obj = acorn.parseExpressionAt(wrapped, program.start, { ecmaVersion: "latest" });
				assert.deepEqual(plain(shift(obj.properties[0].value, -2)), ours);
				return;
			}
			const theirs = acorn.parseExpressionAt(src, program.start, { ecmaVersion: "latest" });
			assert.deepEqual(plain(theirs), ours);
		});
	}
});

// The printer writes strings its own way ("\u005f" as "_", single quotes as double): the
// round trip compares their values, not their spelling.
const unspelled = (tree) =>
	JSON.parse(
		JSON.stringify(stripTree(tree), (_k, v) =>
			v?.type === "Literal" && typeof v.value === "string" ? { ...v, raw: undefined } : v,
		),
	);
describe("printer round trip", () => {
	for (const { c, program } of parsed) {
		test(c.file, () => {
			for (const types of [true, false]) {
				const again = parse(print(program, { types })).program;
				assert.notEqual(again, null, print(program, { types }));
				const want = types ? program : { ...program, function: erase(program.function) };
				assert.deepEqual(unspelled(again), unspelled(want));
			}
		});
	}
});

describe("tsc", () => {
	const accepted = cases.filter((c) => evaluate(c).result.exit === 0);
	const { rejected } = typecheck(
		accepted.map((c) => ({
			id: c.file,
			program: parse(c.source).program,
			signature: signatureOf(c.directives),
		})),
		host,
	);
	test("the declarations type check", () => {
		assert.deepEqual(
			[...rejected.keys()].filter((k) => k.startsWith("/") || k === "(global)"),
			[],
		);
	});
	for (const c of accepted) {
		test(`accepts ${c.file}`, () => assert.deepEqual(rejected.get(c.file) ?? [], []));
	}
	test("accepts at least as many programs as the ratchet holds", () => {
		const agreed = accepted.filter((c) => !rejected.has(c.file)).length;
		assert.ok(agreed >= ratchet.tsc, `${agreed} < ${ratchet.tsc}`);
	});
	// Errors that are TypeScript's too: tsc must reject these programs as well. (Not
	// return-value: a function typed as returning void may return a value in TypeScript.)
	const SHARED = new Set([
		"unknown-name",
		"possibly-null",
		"unknown-property",
		"not-assignable",
		"immutable-target",
		"readonly-property",
		"missing-property",
		"excess-property",
		"wrong-arity",
		"argument-type",
		"comparison-type",
		"missing-return",
	]);
	const controls = cases.filter(
		(c) => c.dir === "reject-static" && SHARED.has(c.directives.expect),
	);
	const control = typecheck(
		controls.map((c) => ({
			id: c.file,
			program: parse(c.source).program,
			signature: signatureOf(c.directives),
		})),
		host,
	).rejected;
	for (const c of controls)
		test(`rejects ${c.file}`, () => assert.ok(control.has(c.file), "tsc accepts it"));
});

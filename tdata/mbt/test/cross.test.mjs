// Cross-implementation properties for tq: on arbitrary messages the JS and wasm-gc builds read
// and write JSON exactly as the JS implementation does and give the same query results, and a
// path query and its pattern find what getIn finds.

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import {
	decodeMessage,
	encodeMessage,
	encodeValue,
	getIn,
	hasMessages,
	Node,
	Typed,
} from "../../js/src/index.ts";
import { message } from "../../test/arbitraries.mjs";
import { loadJs, loadWasm } from "../load.mjs";

const js = await loadJs();
const wasm = await loadWasm();

const QUERIES = [
	"..",
	"[.. | type]",
	"[.. | length]",
	"[.. | keys]",
	".data[]",
	".messages[] | .id",
	".meta[] | keys",
	".. ~ {id: $id, kind: $k}",
	".. ~ [$first, ..$rest]",
	".. ~ <$t {} _>",
	'.. ~ #"app/point" $p',
	"[..] | length",
	'.. | select(. == 0 or . == "")',
	"[.. | . > 0]",
];

test("both builds canonicalize messages exactly as JS encodes them", () => {
	fc.assert(
		fc.property(message, (m) => {
			const json = encodeMessage(m);
			const want = `{"ok":true,"json":${JSON.stringify(json)}}`;
			assert.equal(js.tq_canon(json), want);
			assert.equal(wasm.tq_canon(json), want);
		}),
		{ numRuns: 300 },
	);
});

test("both builds give the same results", () => {
	fc.assert(
		fc.property(message, fc.constantFrom(...QUERIES), (m, q) => {
			const json = encodeMessage(m);
			for (const f of ["tq_run", "tq_match", "tq_match_all"])
				assert.equal(js[f](q, json), wasm[f](q, json), `${f} ${q}`);
		}),
		{ numRuns: 300 },
	);
});

// Every path into a value, as getIn segments, with tq's spelling of the query and the pattern.
const paths = (v, segs = [], query = "", wrap = (p) => p, out = []) => {
	out.push({ segs, query, pattern: wrap("$x") });
	const step = (seg, q, w, child) =>
		paths(child, [...segs, seg], query + q, (p) => wrap(w(p)), out);
	if (Array.isArray(v))
		for (const [i, e] of v.entries()) step(i, `[${i}]`, (p) => `[${"_, ".repeat(i)}${p}, ..]`, e);
	else if (v instanceof Map)
		for (const [k, e] of v)
			step(k, `.${JSON.stringify(k)}`, (p) => `{${JSON.stringify(k)}: ${p}}`, e);
	else if (v instanceof Typed)
		step("value", ".value", (p) => `#${JSON.stringify(v.typeId)} ${p}`, v.value);
	else if (v instanceof Node) {
		step("tag", ".tag", (p) => `<${p} _ _>`, v.tag);
		step("attrs", ".attrs", (p) => `<_ ${p} _>`, v.attributes);
		step("children", ".children", (p) => `<_ _ ${p}>`, v.children);
	}
	return out;
};

test("a path query and its pattern find what getIn finds", () => {
	fc.assert(
		fc.property(message, (generated) => {
			// A decoded message: fast-check's records have no prototype, which getIn doesn't take.
			const json = encodeMessage(generated);
			const m = decodeMessage(json);
			if (hasMessages(m)) return;
			for (const { segs, query, pattern } of paths(m.data).slice(0, 30)) {
				const want = encodeValue(getIn(m, ["data", ...segs]));
				const run = `{"ok":true,"solutions":[[{"value":${want},"bindings":{}}]]}`;
				const bound = `{"ok":true,"solutions":[[{"value":${want},"bindings":{"x":${want}}}]]}`;
				for (const e of [js, wasm]) {
					assert.equal(e.tq_run(`.data${query}`, json), run, query);
					assert.equal(e.tq_run(`.data ~ ${pattern} | $x`, json), bound, pattern);
				}
			}
		}),
		{ numRuns: 300 },
	);
});

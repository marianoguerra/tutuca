// The shared vectors against both MoonBit builds (dist/tq.js and dist/tq.wasm): the JSON
// encoding through tq_canon, and the queries through tq_run, tq_match and tq_match_all.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { loadJs, loadWasm } from "../load.mjs";

const vectors = (name) =>
	JSON.parse(readFileSync(new URL(`../../vectors/${name}`, import.meta.url), "utf8"));

// A value goes through tq_canon as the data of a message.
const wrap = (json) => `{"id":"v","kind":"v","data":${json}}`;
const canon = (json) => `{"ok":true,"json":${JSON.stringify(json)}}`;

const solution = (value, bindings = "{}") => `{"value":${value},"bindings":${bindings}}`;
const solutions = (list) => `{"ok":true,"solutions":[[${list.join(",")}]]}`;
const truthy = (text) => text !== "null" && text !== "false";

for (const [name, engine] of [
	["js", await loadJs()],
	["wasm-gc", await loadWasm()],
]) {
	describe(`${name}: values.json and messages.json`, () => {
		for (const v of vectors("values.json"))
			test(v.name, () => assert.equal(engine.tq_canon(wrap(v.json)), canon(wrap(v.json))));
		for (const v of vectors("messages.json"))
			test(v.name, () => assert.equal(engine.tq_canon(v.json), canon(v.json)));
	});

	describe(`${name}: invalid.json`, () => {
		for (const v of vectors("invalid.json")) {
			if (v.json === undefined) continue;
			test(v.name, () => {
				const r = JSON.parse(engine.tq_canon(v.message ? v.json : wrap(v.json)));
				assert.equal(r.ok, false);
				assert.match(r.error, /at line \d+, col \d+/);
			});
		}
	});

	describe(`${name}: queries.json`, () => {
		const { messages, cases } = vectors("queries.json");
		for (const c of cases) {
			test(c.name, () => {
				if (c.error) {
					const r = JSON.parse(engine.tq_parse(c.query));
					assert.equal(r.ok, false, "expected a parse error");
					assert.match(r.error, /^the query: .* at line \d+, col \d+$/);
					return;
				}
				assert.equal(engine.tq_parse(c.query), '{"ok":true}');
				const msg = messages[c.message];
				const all = c.out.map((v, i) => solution(v, c.bindings?.[i]));
				assert.equal(engine.tq_run(c.query, msg), solutions(all));
				const matching = all.filter((_, i) => truthy(c.out[i]));
				assert.equal(engine.tq_match_all(c.query, msg), solutions(matching));
				const first = matching[0];
				assert.equal(
					engine.tq_match(c.query, msg),
					first ? `{"ok":true,${first.slice(1)}` : '{"ok":false}',
				);
			});
		}
	});

	describe(`${name}: errors`, () => {
		test("a message that doesn't decode", () => {
			const r = JSON.parse(engine.tq_match(".id", '{"id":"x"}'));
			assert.equal(r.ok, false);
			assert.match(r.error, /^the message: a message without "kind"/);
		});
		test("a query that doesn't parse", () => {
			const r = JSON.parse(engine.tq_match(".id |", '{"id":"x","kind":"k","data":1}'));
			assert.match(r.error, /^the query: /);
		});
	});
}

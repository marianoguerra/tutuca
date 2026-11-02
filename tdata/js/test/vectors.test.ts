// The shared conformance vectors (tdata/vectors), which the Wax implementation also runs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	decodeMessage,
	decodeMessageCbor,
	decodeValue,
	decodeValueCbor,
	encodeMessage,
	encodeMessageCbor,
	encodeValue,
	encodeValueCbor,
	equal,
	equalMessages,
	fromHex,
	type Message,
	Registry,
	toHex,
	type Value,
} from "../src/index.ts";

const load = (name: string) =>
	JSON.parse(readFileSync(new URL(`../../vectors/${name}`, import.meta.url), "utf8"));

describe("values.json", () => {
	for (const v of load("values.json")) {
		test(v.name, () => {
			const fromJson = decodeValue(v.json);
			const fromCbor = decodeValueCbor(fromHex(v.cbor));
			assert.ok(equal(fromJson, fromCbor), "the JSON and CBOR decode to equal values");
			assert.equal(encodeValue(fromJson), v.json);
			assert.equal(encodeValue(fromCbor), v.json);
			assert.equal(toHex(encodeValueCbor(fromJson)), v.cbor);
			assert.equal(toHex(encodeValueCbor(fromCbor)), v.cbor);
		});
	}
});

describe("messages.json", () => {
	for (const v of load("messages.json")) {
		test(v.name, () => {
			const fromJson = decodeMessage(v.json);
			const fromCbor = decodeMessageCbor(fromHex(v.cbor));
			assert.ok(equalMessages(fromJson, fromCbor));
			assert.equal(encodeMessage(fromJson), v.json);
			assert.equal(encodeMessage(fromCbor), v.json);
			assert.equal(toHex(encodeMessageCbor(fromJson)), v.cbor);
		});
	}
});

describe("invalid.json", () => {
	for (const v of load("invalid.json")) {
		test(v.name, () => {
			if (v.json !== undefined) {
				assert.throws(() => (v.message ? decodeMessage(v.json) : decodeValue(v.json)), {
					name: "TdataError",
				});
			} else {
				const b = fromHex(v.cbor);
				assert.throws(() => (v.message ? decodeMessageCbor(b) : decodeValueCbor(b)), {
					name: "TdataError",
				});
			}
		});
	}
});

const toJsonPath = (p: (string | bigint)[]) =>
	p.map((s) => (typeof s === "bigint" ? Number(s) : s));

describe("specs.json", () => {
	const { registry, cases } = load("specs.json");
	const reg = new Registry().load(decodeValue(registry) as Map<string, Value>);
	for (const c of cases) {
		test(c.name, () => {
			const x: Value | Message =
				c.message !== undefined ? decodeMessage(c.message) : decodeValue(c.value);
			const r = reg.check(decodeValue(c.spec), x);
			if (c.ok) {
				assert.ok(
					r.ok,
					`expected a match, got ${JSON.stringify(!r.ok && r.problems, (_k, v) => (typeof v === "bigint" ? Number(v) : v))}`,
				);
				if (c.picks)
					assert.deepEqual(
						r.picks.map((p) => ({ path: toJsonPath(p.path), alt: p.alt })),
						c.picks,
					);
			} else {
				assert.ok(!r.ok, "expected no match");
				if (c.problems)
					assert.deepEqual(
						r.problems.map((p) => toJsonPath(p.path)),
						c.problems,
					);
			}
		});
	}
});

test("self-describe tag is accepted and emitted on request", () => {
	const b = encodeValueCbor(1n, { selfDescribe: true });
	assert.equal(toHex(b), "d9d9f701");
	assert.equal(decodeValueCbor(b), 1n);
});

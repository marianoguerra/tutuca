// Cross-implementation properties: for arbitrary values and messages, the Wax implementation
// reads what the JS one writes and writes exactly what it would, in both encodings.

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import {
	decodeMessage,
	decodeValue,
	encodeMessage,
	encodeMessageCbor,
	encodeValue,
	encodeValueCbor,
	equal,
} from "../../js/src/index.ts";
import { message, value } from "../../test/arbitraries.mjs";
import { load } from "./tdata.mjs";

const td = await load();

const hex = (u8) => Buffer.from(u8).toString("hex");

test("values: Wax canonicalizes and transcodes exactly as JS encodes", () => {
	fc.assert(
		fc.property(value, (v) => {
			const json = encodeValue(v);
			const cbor = encodeValueCbor(v);
			assert.equal(td.jsonCanon(json), json);
			assert.equal(hex(td.jsonToCbor(json)), hex(cbor));
			const back = td.cborToJson(cbor);
			assert.equal(back, json);
			assert.ok(equal(decodeValue(back), v));
		}),
		{ numRuns: 400 },
	);
});

test("messages: Wax canonicalizes and transcodes exactly as JS encodes", () => {
	fc.assert(
		fc.property(message, (m) => {
			const json = encodeMessage(m);
			const cbor = encodeMessageCbor(m);
			assert.equal(td.jsonCanon(json, true), json);
			assert.equal(hex(td.jsonToCbor(json, true)), hex(cbor));
			assert.equal(td.cborToJson(cbor, true), json);
			assert.equal(encodeMessage(decodeMessage(json)), json);
		}),
		{ numRuns: 200 },
	);
});

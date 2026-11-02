// Codecs and the opaque round trip (docs/spec.md §1.3): what a component doesn't know passes
// through it unchanged, byte for byte, in both encodings.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type Codec,
	Codecs,
	decodeMessage,
	decodeMessageCbor,
	decodeValue,
	encodeMessage,
	encodeMessageCbor,
	encodeValue,
	equal,
	getIn,
	type Message,
	setIn,
	Typed,
	updateIn,
	type Value,
} from "../src/index.ts";

class Point {
	x: number;
	y: number;
	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
}

const pointCodec: Codec<Point> = {
	typeId: "app/point",
	is: (x): x is Point => x instanceof Point,
	encode: (p) =>
		new Map<string, Value>([
			["x", p.x],
			["y", p.y],
		]),
	decode: (v) => {
		if (!(v instanceof Map)) return undefined;
		const x = v.get("x");
		const y = v.get("y");
		return typeof x === "number" && typeof y === "number" ? new Point(x, y) : undefined;
	},
};

const text =
	'{"id":"m1","kind":"note","data":{"title":"Hi","p":["#","app/point",{"x":1.5,"y":2.0}],"bad":["#","app/point",{"x":"no"}],"u":["#","x/unknown",[[["#","x/deeper",{"9":1,"1":2}]]]],"n":["node","x-widget",{"data-z":1},[[]]]},"meta":{"urn:mine":{"seen":false},"urn:theirs":{"opaque":["bytes","3q2+7w=="]}}}';

test("a registered type decodes to its native; others stay Typed", () => {
	const codecs = new Codecs([pointCodec]);
	const m = decodeMessage(text, { codecs });
	const data = m.data as Map<string, unknown>;
	assert.ok(data.get("p") instanceof Point);
	assert.deepEqual(data.get("p"), new Point(1.5, 2));
	// rejected by the codec: kept as the envelope
	assert.ok(data.get("bad") instanceof Typed);
	assert.ok(data.get("u") instanceof Typed);
	assert.equal((data.get("u") as Typed).typeId, "x/unknown");
});

test("decode → encode is the identity, with and without codecs", () => {
	for (const codecs of [new Codecs(), new Codecs([pointCodec])]) {
		const m = decodeMessage(text, { codecs });
		assert.equal(encodeMessage(m, { codecs }), text);
		const cbor = encodeMessageCbor(m, { codecs });
		assert.equal(encodeMessage(decodeMessageCbor(cbor, { codecs }), { codecs }), text);
		// a component without the codec reads the same bytes the same way
		assert.equal(encodeMessage(decodeMessageCbor(cbor)), text);
	}
});

test("editing the known part leaves every other byte alone", () => {
	const codecs = new Codecs([pointCodec]);
	const m = decodeMessage(text, { codecs });
	const moved = updateIn(m, ["data", "p"], (p) => new Point((p as Point).x + 1, (p as Point).y));
	const seen = setIn(moved, ["meta", "urn:mine", "seen"], true) as Message;
	const out = encodeMessage(seen, { codecs });
	assert.equal(
		out,
		text.replace('"x":1.5,"y":2.0', '"x":2.5,"y":2.0').replace('"seen":false', '"seen":true'),
	);
	// structural sharing: untouched parts are the same objects
	assert.equal(getIn(seen, ["data", "u"]), getIn(m, ["data", "u"]));
	assert.equal(getIn(seen, ["meta", "urn:theirs"]), getIn(m, ["meta", "urn:theirs"]));
	assert.notEqual(seen, m);
	assert.equal(encodeMessage(m, { codecs }), text, "the original is unchanged");
});

test("equality sees natives through their wire view", () => {
	const codecs = new Codecs([pointCodec]);
	assert.ok(
		equal(new Point(1, 2), new Typed("app/point", decodeValue('{"y":2.0,"x":1.0}')), codecs),
	);
	assert.ok(!equal(new Point(1, 2), new Point(1, 3), codecs));
});

test("encoding a value no codec knows is an error", () => {
	assert.throws(() => encodeValue(new Point(1, 2)), { name: "TdataError" });
	assert.throws(() => encodeValue(2n ** 63n), { name: "TdataError" });
	assert.throws(() => encodeValue("\ud800"), { name: "TdataError" });
});

test("a codec that throws keeps the Typed", () => {
	const codecs = new Codecs([
		{
			typeId: "x/boom",
			is: (_x): _x is never => false,
			encode: () => null,
			decode: () => {
				throw new Error("boom");
			},
		},
	]);
	const v = decodeValue('["#","x/boom",1]', { codecs });
	assert.ok(v instanceof Typed);
	assert.equal(encodeValue(v, { codecs }), '["#","x/boom",1]');
});

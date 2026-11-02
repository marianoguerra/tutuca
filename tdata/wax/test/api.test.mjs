// The Wax router and codecs, beyond the shared vectors.

import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./tdata.mjs";

const td = await load();

test("dispatch returns every matching route in registration order", () => {
	td.resetSpecs();
	td.loadSpecs(
		'{"app/note":["#","tdata.spec/message",{"kind":["#","tdata.spec/const",{"value":"note"}]}],"app/traced":["#","tdata.spec/message",{"meta":{"urn:trace":"any"}}]}',
	);
	td.route('"app/traced"', 1);
	td.route('"app/note"', 2);
	td.route('["#","tdata.spec/message",{"kind":["#","tdata.spec/const",{"value":"todo"}]}]', 3);
	const ids = (msg) => td.dispatch(msg)[0].map(Number);
	assert.deepEqual(
		ids('{"id":"1","kind":"note","data":null,"meta":{"urn:trace":{},"urn:x":{"a":1}}}'),
		[1, 2],
	);
	assert.deepEqual(ids('{"id":"2","kind":"todo","data":1}'), [3]);
	assert.deepEqual(ids('{"id":"3","kind":"other","data":1}'), []);
});

const text =
	'{"id":"m1","kind":"note","data":{"p":["#","app/point",{"x":1.5,"y":2.0}],"bad":["#","app/point",{"x":"no"}],"u":["#","x/unknown",[[["#","x/deeper",{"9":1,"1":2}]]]]},"meta":{"urn:theirs":{"opaque":["bytes","3q2+7w=="]}}}';

test("a registered type decodes to a native, a rejected or unknown one stays Typed", () => {
	td.usePointCodec(true);
	assert.equal(
		td.countNatives('{"p":["#","app/point",{"x":1.5,"y":2.0}],"bad":["#","app/point",{"x":"no"}]}'),
		1,
	);
	td.usePointCodec(false);
	assert.equal(td.countNatives('{"p":["#","app/point",{"x":1.5,"y":2.0}]}'), 0);
});

test("the opaque round trip holds with and without the codec, in both encodings", () => {
	for (const on of [false, true]) {
		td.usePointCodec(on);
		assert.equal(td.jsonCanon(text, true), text);
		assert.equal(td.cborToJson(td.jsonToCbor(text, true), true), text);
	}
	td.usePointCodec(false);
});

test("specs see a native through its wire view", () => {
	td.usePointCodec(true);
	td.resetSpecs();
	const spec =
		'["#","tdata.spec/typed",{"type_id":"app/point","value":["#","tdata.spec/keys",{"req":{"x":"double"}}]}]';
	assert.equal(td.check(spec, '["#","app/point",{"x":1.5,"y":2.0}]').ok, true);
	td.usePointCodec(false);
});

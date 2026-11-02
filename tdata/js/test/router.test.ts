import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeMessage, decodeValue, Registry, Router, spec, type Value } from "../src/index.ts";

const reg = new Registry().loadJson(
	'{"id":"s","kind":"tdata/specs","data":{"app/note":["#","tdata.spec/message",{"kind":["#","tdata.spec/const",{"value":"note"}]}],"app/traced":["#","tdata.spec/message",{"meta":{"urn:trace":"any"}}]}}',
);

test("dispatch returns every matching route in order; first returns the first", () => {
	const r = new Router<string>(reg)
		.on("app/traced", () => "traced")
		.on("app/note", () => "note")
		.on(spec("message", { kind: spec("const", { value: "todo" }) }), () => "todo");
	const m = decodeMessage(
		'{"id":"1","kind":"note","data":null,"meta":{"urn:trace":{},"urn:x":{"a":1}}}',
	);
	assert.deepEqual(r.handle(m), ["traced", "note"]);
	assert.equal(r.first(m)?.handler(m, [], new Map()), "traced");
	assert.deepEqual(r.handle(decodeMessage('{"id":"2","kind":"todo","data":1}')), ["todo"]);
	assert.equal(r.first(decodeMessage('{"id":"3","kind":"other","data":1}')), undefined);
});

test("handlers get the original message object", () => {
	const m = decodeMessage('{"id":"1","kind":"note","data":null}');
	let got: unknown;
	new Router(reg).on("app/note", (msg) => (got = msg)).handle(m);
	assert.equal(got, m);
});

test("specs built in code equal the same specs decoded from JSON", () => {
	const fromCode: Value = spec("keys", { req: new Map([["x", "int"]]) });
	const fromJson = decodeValue('["#","tdata.spec/keys",{"req":{"x":"int"}}]');
	assert.ok(reg.valid(fromCode, decodeValue('{"x":1}')));
	assert.ok(reg.valid(fromJson, decodeValue('{"x":1,"y":2}')));
});

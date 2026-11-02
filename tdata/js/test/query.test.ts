import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJs, loadWasm } from "../../mbt/load.mjs";
import {
	type Codec,
	Codecs,
	decodeMessage,
	encodeValue,
	hasMessages,
	type Message,
	obj,
	Query,
	Registry,
	Router,
	Typed,
	type Value,
} from "../src/index.ts";

// Written as text: JSON.stringify would turn the Double 2.0 into the Int 2.
const batch = decodeMessage(
	'{"id":"b","kind":"batch","messages":[' +
		'{"id":"n1","kind":"note","data":{"title":"TD-12: fix it","author":{"name":"ana"},' +
		'"p":["#","app/point",{"x":1.5,"y":2.0}]},' +
		'"meta":{"https://tutuca.dev/d/trace":{"at":["inst","1730540000000000000"]}}},' +
		'{"id":"n2","kind":"note","data":{"title":"hi","author":{"name":"bot"}}},' +
		'{"id":"p","kind":"ping","data":null}]}',
);

const ROUTE =
	'.messages[] ~ {kind: "note", data: {title: $title, author: {name: $who}}} | select($who != "bot")';

class Point {
	x: number;
	y: number;
	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
}

const point: Codec<Point> = {
	typeId: "app/point",
	is: (x): x is Point => x instanceof Point,
	encode: (p) => obj({ x: p.x, y: p.y }),
	decode: (v) => {
		if (!(v instanceof Map)) return undefined;
		const x = v.get("x");
		const y = v.get("y");
		return typeof x === "number" && typeof y === "number" ? new Point(x, y) : undefined;
	},
};

for (const [name, engine] of [
	["js", await loadJs()],
	["wasm-gc", await loadWasm()],
] as const) {
	const q = new Query(engine);

	test(`${name}: match gives the first matching output and its bindings`, () => {
		const s = q.match(ROUTE, batch);
		assert.ok(s);
		assert.equal((s.value as Message).id, "n1");
		assert.deepEqual([...s.bindings.keys()], ["title", "who"]);
		assert.equal(s.bindings.get("who"), "ana");
		assert.equal(q.match('.kind == "nope"', batch), undefined);
		assert.ok(q.test(".messages | length > 2", batch));
	});

	test(`${name}: outputs come back as tdata values, Ints as bigint`, () => {
		const out = q.run("[.messages[].kind], (.messages | length), .messages[0].data.p", batch);
		assert.deepEqual(out[0]?.value, ["note", "note", "ping"]);
		assert.equal(out[1]?.value, 3n);
		assert.equal(encodeValue(out[2]?.value as Value), '["#","app/point",{"x":1.5,"y":2.0}]');
		assert.deepEqual(
			q.matchAll('.messages[].kind == "note"', batch).map((s) => s.value),
			[true, true],
		);
	});

	test(`${name}: messages in outputs and bindings come back as Messages`, () => {
		const s = q.match(".messages ~ [$first, ..$rest]", batch);
		assert.ok(s);
		// `.messages` outputs the list of child messages.
		assert.deepEqual(
			(s.value as Message[]).map((m) => m.id),
			["n1", "n2", "p"],
		);
		assert.ok(hasMessages(q.match(".", batch)?.value as Message));
		const first = s.bindings.get("first") as Message;
		assert.equal(first.id, "n1");
		assert.equal(first.meta.get("https://tutuca.dev/d/trace")?.size, 1);
		assert.deepEqual(
			(s.bindings.get("rest") as Message[]).map((m) => m.id),
			["n2", "p"],
		);
	});

	test(`${name}: a query that doesn't parse throws, saying where`, () => {
		assert.throws(() => q.parse(".a | "), /line 1, col 6/);
		assert.throws(() => q.match("foo", batch), /unknown function "foo"/);
	});

	test(`${name}: registered natives go through their wire view`, () => {
		const text = '{"id":"1","kind":"k","data":{"p":["#","app/point",{"x":1.5,"y":2.0}]}}';
		const codecs = new Codecs([point]);
		const s = new Query(engine, { codecs }).match(
			'.data.p ~ #"app/point" {x: $x}',
			decodeMessage(text, { codecs }),
		);
		assert.ok(s?.value instanceof Point);
		assert.equal(s?.bindings.get("x"), 1.5);
		assert.ok(new Query(engine).run(".data.p", decodeMessage(text))[0]?.value instanceof Typed);
	});

	test(`${name}: Router.when routes by query and hands over the bindings`, () => {
		const r = new Router<string>(new Registry(), q)
			.when(ROUTE, (_msg, _picks, b) => `note by ${b.get("who")}`)
			.when('.messages[] ~ {kind: "ping"}', () => "ping")
			.when('.kind == "other"', () => "other");
		assert.deepEqual(r.handle(batch), ["note by ana", "ping"]);
		assert.equal(r.first(batch)?.query, ROUTE);
		assert.throws(() => r.when(".a |", () => "x"), /line 1/);
		assert.throws(() => new Router(new Registry()).when(".a", () => "x"), /needs a Query/);
	});
}

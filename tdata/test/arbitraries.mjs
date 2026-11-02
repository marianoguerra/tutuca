// fast-check generators for arbitrary tdata values and messages, shared by the
// cross-implementation tests (wax/test/cross.test.mjs, mbt/test/cross.test.mjs).

import fc from "fast-check";
import { equal, Instant, Node, Ref, Typed } from "../js/src/index.ts";

const INT = { min: -(2n ** 63n), max: 2n ** 63n - 1n };
const key = fc.oneof(
	fc.string({ maxLength: 4 }),
	fc.constantFrom("id", "#", "node", "__proto__", "10", "2"),
);
const typeId = fc.constantFrom("app/point", "x/unknown", "tdata.spec/keys", "a/b/c");

const uniqueBy = (xs) => {
	const out = [];
	for (const x of xs) if (!out.some((y) => equal(x, y))) out.push(x);
	return out;
};

export const { value } = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		fc.constant(null),
		fc.boolean(),
		fc.bigInt(INT),
		fc.double(),
		fc.string({ unit: "binary", maxLength: 8 }),
		fc.uint8Array({ maxLength: 8 }),
		fc.bigInt(INT).map((ns) => new Instant(ns)),
		fc.string({ maxLength: 8 }).map((u) => new Ref(u)),
		fc.array(tie("value"), { maxLength: 4 }),
		fc
			.uniqueArray(fc.tuple(key, tie("value")), { maxLength: 4, selector: ([k]) => k })
			.map((es) => new Map(es)),
		fc.array(tie("value"), { maxLength: 4 }).map((xs) => new Set(uniqueBy(xs))),
		fc.tuple(typeId, tie("value")).map(([t, v]) => new Typed(t, v)),
		fc
			.tuple(
				fc.constantFrom("p", "div", "x-widget"),
				fc.uniqueArray(fc.tuple(key, tie("value")), { maxLength: 3, selector: ([k]) => k }),
				fc.array(tie("value"), { maxLength: 3 }),
			)
			.map(([t, attrs, children]) => new Node(t, new Map(attrs), children)),
	),
}));

const scalar = fc.oneof(
	fc.constant(null),
	fc.boolean(),
	fc.bigInt(INT),
	fc.double(),
	fc.string({ maxLength: 4 }),
	fc.bigInt(INT).map((ns) => new Instant(ns)),
);
const meta = fc
	.uniqueArray(
		fc.tuple(
			fc.constantFrom("urn:a", "urn:b", "https://tutuca.dev/d/trace"),
			fc.uniqueArray(fc.tuple(key, scalar), { maxLength: 3, selector: ([k]) => k }),
		),
		{ maxLength: 2, selector: ([u]) => u },
	)
	.map((ds) => new Map(ds.map(([u, hs]) => [u, new Map(hs)])));

export const { message } = fc.letrec((tie) => ({
	message: fc.oneof(
		{ depthSize: "small" },
		fc.record({
			id: fc.string({ maxLength: 4 }),
			kind: fc.string({ maxLength: 4 }),
			data: value,
			meta,
		}),
		fc.record({
			id: fc.string({ maxLength: 4 }),
			kind: fc.string({ maxLength: 4 }),
			messages: fc.array(tie("message"), { maxLength: 3 }),
			meta,
		}),
	),
}));

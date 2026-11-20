// Doc comments, read from the source by a node's offset (lib/doc.js).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { docAt, parseModule } from "../lib/index.js";

const SOURCE = `// A line comment isn't a doc.
const a = 1;
/**
 * Adds n to the count,
 * once.
 * @param n how many, may be negative
 * @param {number} m - a typed one
 * @hidden
 */
export const add = 2;
/** One line. */ const b = 3;
/* not a doc */
const c = 4;
/** Far away. */
const d = 5; /** Before e, after d's semicolon. */ const e = 6;
`;
const startOf = (name) => {
	const items = parseModule(SOURCE).module.items;
	const item = items.find((it) => (it.declaration ?? it).declarations?.[0].id.name === name);
	return item.start;
};

describe("doc comments", () => {
	test("text and tags: a @param's name, a tag's text over lines", () => {
		assert.deepEqual(docAt(SOURCE, startOf("add")), {
			text: "Adds n to the count, once.",
			tags: [
				{ tag: "param", name: "n", text: "how many, may be negative" },
				{ tag: "param", name: "m", text: "a typed one" },
				{ tag: "hidden", name: null, text: "" },
			],
		});
		assert.deepEqual(docAt(SOURCE, startOf("b")), { text: "One line.", tags: [] });
	});

	test("only a /** */ right before it is its doc", () => {
		assert.equal(docAt(SOURCE, startOf("a")), null);
		assert.equal(docAt(SOURCE, startOf("c")), null);
		assert.equal(docAt(SOURCE, startOf("d")).text, "Far away.");
		assert.equal(docAt(SOURCE, startOf("e")).text, "Before e, after d's semicolon.");
	});
});

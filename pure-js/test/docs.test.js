// The docs' examples run, and the spec's feature table is the one tables.js makes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { featuresMarkdown } from "../tools/spec-tables.js";

const lib = new URL("../lib/index.js", import.meta.url).href;
const blocks = (file) =>
	[...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/```js\n([\s\S]*?)```/g)].map(
		(m) => m[1],
	);

describe("docs/embedding.md", () => {
	blocks("../docs/embedding.md").forEach((code, i) => {
		test(`example ${i + 1}`, async () => {
			const module = code.replaceAll('from "pure-js"', `from ${JSON.stringify(lib)}`);
			await import(`data:text/javascript,${encodeURIComponent(module)}`);
		});
	});
});
test("spec/features.md is current: node tools/spec-tables.js", () => {
	assert.equal(
		readFileSync(new URL("../spec/features.md", import.meta.url), "utf8"),
		featuresMarkdown(),
	);
});

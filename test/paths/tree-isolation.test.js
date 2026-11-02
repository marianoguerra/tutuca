// src/tree is a package of its own: its modules import only each other.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../../src/tree/", import.meta.url);

test("src/tree imports nothing from outside itself", () => {
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
		const source = readFileSync(new URL(file, dir), "utf8");
		for (const [, spec] of source.matchAll(/\bfrom\s+"([^"]+)"/g)) {
			assert.match(spec, /^\.\/[\w-]+\.js$/, `${file} imports ${spec}`);
		}
	}
});

// src/core's layers: the model (specs, types, contracts, scopes) knows nothing of the views or
// of the host that runs it, and the views know nothing of the host. component.js, where a
// spec's model and views meet, is above both.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const importsOf = (layer) => {
	const dir = new URL(`../../src/core/${layer}/`, import.meta.url);
	return readdirSync(dir)
		.filter((f) => f.endsWith(".js"))
		.flatMap((file) =>
			[...readFileSync(new URL(file, dir), "utf8").matchAll(/\bfrom\s+"([^"]+)"/g)].map(
				([, spec]) => ({ file, spec }),
			),
		);
};
const from = (imports, layer) =>
	imports
		.filter(({ spec }) => spec.startsWith(`../${layer}/`))
		.map(({ file, spec }) => `${file} ${spec}`);

test("the model imports nothing from the host or the views", () => {
	const imports = importsOf("model");
	assert.deepEqual(from(imports, "host"), []);
	assert.deepEqual(from(imports, "view"), []);
});

test("the views import nothing from the host", () => {
	assert.deepEqual(from(importsOf("view"), "host"), []);
});

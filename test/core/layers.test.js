// src/core's layers: the model (specs, types, contracts, scopes) knows nothing of the host that
// runs it, and of the views only what component() needs to build a spec's; the views know
// nothing of the host.
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

test("the model imports nothing from the host, and from the views only to build them", () => {
	const imports = importsOf("model");
	assert.deepEqual(from(imports, "host"), []);
	assert.deepEqual(from(imports, "view"), [
		"component.js ../view/view.js",
		"component.js ../view/walk.js",
	]);
});

test("the views import nothing from the host", () => {
	assert.deepEqual(from(importsOf("view"), "host"), []);
});

// Writes examples/playground/deps/editor.js: the playground's editor (examples/playground/
// editor.js) bundled with its CodeMirror packages, from the parent repo's node_modules, so the
// page runs without a bundler and with one copy of @codemirror/state.
// Usage: node scripts/vendor-codemirror.mjs   (after `npm install` in the parent repo)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "../../node_modules/esbuild/lib/main.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES = join(ROOT, "../node_modules");
const packages = [
	"@codemirror/state",
	"@codemirror/view",
	"@codemirror/commands",
	"@codemirror/language",
	"@codemirror/lint",
	"@lezer/highlight",
];
const versionOf = (name) =>
	JSON.parse(readFileSync(join(MODULES, name, "package.json"), "utf8")).version;

const { outputFiles } = await esbuild.build({
	entryPoints: [join(ROOT, "examples/playground/editor.js")],
	nodePaths: [MODULES],
	bundle: true,
	format: "esm",
	platform: "browser",
	minify: true,
	charset: "utf8",
	legalComments: "none",
	logLevel: "warning",
	write: false,
});
const license = readFileSync(join(MODULES, "@codemirror/state/LICENSE"), "utf8").trim();
const header = [
	`/*! ${packages.map((n) => `${n} ${versionOf(n)}`).join(", ")}, bundled with examples/playground/editor.js by scripts/vendor-codemirror.mjs.`,
	" *",
	...license.split("\n").map((line) => ` * ${line}`.trimEnd()),
	" */",
].join("\n");
const out = join(ROOT, "examples/playground/deps/editor.js");
writeFileSync(out, `${header}\n${outputFiles[0].text}`);
console.log(`examples/playground/deps/editor.js: ${(outputFiles[0].text.length / 1024).toFixed(0)} KB`);

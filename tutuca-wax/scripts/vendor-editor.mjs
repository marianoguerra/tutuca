// Writes playground/deps/editor.js: the playground's editor
// (playground/editor.src.js) bundled with its CodeMirror packages, from the
// parent repo's node_modules, so the page runs without a bundler. The bundle
// is committed, like vendor/margaui; run this after changing the editor.
// Usage: node scripts/vendor-editor.mjs   (after `npm install` in the parent repo)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES = join(ROOT, "../node_modules");
const esbuild = await import(join(MODULES, "esbuild/lib/main.js"));
const packages = [
	"@codemirror/state",
	"@codemirror/view",
	"@codemirror/commands",
	"@codemirror/language",
	"@codemirror/lint",
	"@lezer/highlight",
];
const versionOf = (name) => JSON.parse(readFileSync(join(MODULES, name, "package.json"), "utf8")).version;

const { outputFiles } = await esbuild.build({
	entryPoints: [join(ROOT, "playground/editor.src.js")],
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
	`/*! ${packages.map((n) => `${n} ${versionOf(n)}`).join(", ")}, bundled with playground/editor.src.js by scripts/vendor-editor.mjs.`,
	" *",
	...license.split("\n").map((line) => ` * ${line}`.trimEnd()),
	" */",
].join("\n");
mkdirSync(join(ROOT, "playground/deps"), { recursive: true });
writeFileSync(join(ROOT, "playground/deps/editor.js"), `${header}\n${outputFiles[0].text}`);
console.log(`wrote playground/deps/editor.js (${outputFiles[0].text.length} bytes)`);

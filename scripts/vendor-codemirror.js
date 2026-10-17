// Writes site/deps/codemirror.js from the codemirror devDependencies: the playground runs in a
// browser without a bundler and needs a single copy of @codemirror/state. Bump the packages in
// package.json, then run `just vendor-codemirror`.
import { readFileSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const packages = ["codemirror", "@codemirror/lang-javascript", "@codemirror/theme-one-dark"];
const versionOf = (name) =>
	JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;

const { outputFiles } = await esbuild.build({
	stdin: {
		contents: [
			'export { basicSetup } from "codemirror";',
			'export { Compartment, EditorState } from "@codemirror/state";',
			'export { EditorView, keymap } from "@codemirror/view";',
			'export { javascript } from "@codemirror/lang-javascript";',
			'export { oneDark } from "@codemirror/theme-one-dark";',
		].join("\n"),
		resolveDir: ".",
		loader: "js",
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	minify: true,
	charset: "utf8",
	legalComments: "none",
	logLevel: "warning",
	write: false,
});

// Every CodeMirror package is MIT licensed by Marijn Haverbeke and others.
const license = readFileSync("node_modules/codemirror/LICENSE", "utf8").trim();
const header = [
	`/*! ${packages.map((name) => `${name} ${versionOf(name)}`).join(", ")}, vendored by scripts/vendor-codemirror.js.`,
	" *",
	...license.split("\n").map((line) => ` * ${line}`.trimEnd()),
	" */",
].join("\n");
writeFileSync("site/deps/codemirror.js", `${header}\n${outputFiles[0].text}`);
console.log(
	`site/deps/codemirror.js: ${packages.map((name) => `${name} ${versionOf(name)}`).join(", ")}`,
);

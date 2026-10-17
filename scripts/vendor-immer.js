// Writes deps/immer.js from the immer devDependency: src/ imports it by path, so the repo and
// the npm package run in a browser without a bundler. Bump immer in package.json, then run
// `just vendor-immer` and the tests.
import { readFileSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const pkg = JSON.parse(readFileSync("node_modules/immer/package.json", "utf8"));
const license = readFileSync("node_modules/immer/LICENSE", "utf8").trim();

// The development build keeps immer's readable errors and checks; esbuild drops the branches
// for production and the process.env reads a browser doesn't have.
const { outputFiles } = await esbuild.build({
	entryPoints: ["node_modules/immer/dist/immer.mjs"],
	bundle: true,
	format: "esm",
	platform: "browser",
	charset: "utf8",
	define: { "process.env.NODE_ENV": '"development"' },
	legalComments: "none",
	logLevel: "warning",
	write: false,
});

// dist.js reads the version back from the first line for its banner.
const header = [
	`/*! immer ${pkg.version} (${pkg.homepage?.replace(/#.*$/, "") ?? "https://github.com/immerjs/immer"}), vendored by scripts/vendor-immer.js.`,
	" *",
	...license.split("\n").map((line) => ` * ${line}`.trimEnd()),
	" */",
].join("\n");
writeFileSync("deps/immer.js", `${header}\n${outputFiles[0].text}`);
console.log(`deps/immer.js: immer ${pkg.version}`);

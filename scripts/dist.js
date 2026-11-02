// Builds the core and dev mode as ES modules for CDN use: dist/tutuca.js and dist/tutuca.dev.js,
// and their .min.js. npm consumers import src/ directly, so this is the only build step. Both
// import one shared chunk, so dev mode's checks see the core's components and applies (one copy
// of each module) while dist/tutuca.js doesn't carry them.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import * as esbuild from "esbuild";

// The bundles carry one compact notice for tutuca and the immer they include, instead of
// immer's whole license block (legalComments: "none" drops it).
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const vendored = readFileSync("deps/immer.js", "utf8");
const immer = /^\/\*! immer (\S+)/.exec(vendored)?.[1];
if (immer === undefined)
	throw new Error("deps/immer.js has no version header: run just vendor immer");
const copyright = (text) => /Copyright \(c\) [^\n]+/.exec(text)[0];
const banner = [
	`/*! tutuca ${version} | MIT License | ${copyright(readFileSync("LICENSE", "utf8"))}`,
	` * immer ${immer} | MIT License | ${copyright(vendored)} */`,
].join("\n");

// Without charset the § render markers get \u-escaped.
const common = {
	banner: { js: banner },
	entryPoints: ["src/tutuca.js", "src/tutuca.dev.js"],
	bundle: true,
	splitting: true,
	outdir: "dist",
	format: "esm",
	platform: "browser",
	charset: "utf8",
	legalComments: "none",
	logLevel: "warning",
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
await esbuild.build({ ...common, chunkNames: "chunks/[name]-[hash]" });
// Identifiers stay unmangled so component and class names survive into stack traces.
await esbuild.build({
	...common,
	entryNames: "[name].min",
	chunkNames: "chunks/[name]-[hash].min",
	minifyWhitespace: true,
	minifySyntax: true,
	minifyIdentifiers: false,
});

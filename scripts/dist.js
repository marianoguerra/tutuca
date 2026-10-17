// Builds the core as one ES module for CDN use: dist/tutuca.js and dist/tutuca.min.js.
// npm consumers import src/ directly, so this is the only build step.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import * as esbuild from "esbuild";

// The bundles carry one compact notice for tutuca and the immer they include, instead of
// immer's whole license block (legalComments: "none" drops it).
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const vendored = readFileSync("deps/immer.js", "utf8");
const immer = /^\/\*! immer (\S+)/.exec(vendored)?.[1];
if (immer === undefined)
	throw new Error("deps/immer.js has no version header: run just vendor-immer");
const copyright = (text) => /Copyright \(c\) [^\n]+/.exec(text)[0];
const banner = [
	`/*! tutuca ${version} | MIT License | ${copyright(readFileSync("LICENSE", "utf8"))}`,
	` * immer ${immer} | MIT License | ${copyright(vendored)} */`,
].join("\n");

// Without charset the § render markers get \u-escaped.
const common = {
	banner: { js: banner },
	entryPoints: ["src/tutuca.js"],
	bundle: true,
	format: "esm",
	platform: "browser",
	charset: "utf8",
	legalComments: "none",
	logLevel: "warning",
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
await esbuild.build({ ...common, outfile: "dist/tutuca.js" });
// Identifiers stay unmangled so component and class names survive into stack traces.
await esbuild.build({
	...common,
	outfile: "dist/tutuca.min.js",
	minifyWhitespace: true,
	minifySyntax: true,
	minifyIdentifiers: false,
});

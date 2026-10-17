// Builds the core as one ES module for CDN use: dist/tutuca.js and dist/tutuca.min.js.
// npm consumers import src/ directly, so this is the only build step.
import { mkdirSync, rmSync } from "node:fs";
import * as esbuild from "esbuild";

// Without charset the § render markers get \u-escaped; without legalComments immer's
// license block lands in the output.
const common = {
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

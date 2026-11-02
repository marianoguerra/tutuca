// Builds the core and dev mode as ES modules for CDN use: dist/tutuca.js and dist/tutuca.dev.js,
// and their .min.js. npm consumers import src/ directly, so this is the only build step. Each is
// one self-contained file: dist/tutuca.dev.js is the whole core plus dev mode (load it instead of
// dist/tutuca.js, not next to it, or the checks see a second copy of the core), and
// dist/tutuca.js doesn't carry the checks.
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
	bundle: true,
	format: "esm",
	platform: "browser",
	charset: "utf8",
	legalComments: "none",
	logLevel: "warning",
};

// The dev bundle's entry re-exports the core and dev mode, so one file has both.
const entries = {
	tutuca: { entryPoints: ["src/tutuca.js"] },
	"tutuca.dev": {
		stdin: {
			contents: 'export * from "./src/tutuca.js";\nexport * from "./src/tutuca.dev.js";\n',
			resolveDir: ".",
			sourcefile: "tutuca.dev.js",
		},
	},
};
// Identifiers stay unmangled so component and class names survive into stack traces.
const minify = { minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false };

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const [name, entry] of Object.entries(entries)) {
	await esbuild.build({ ...common, ...entry, outfile: `dist/${name}.js` });
	await esbuild.build({ ...common, ...entry, ...minify, outfile: `dist/${name}.min.js` });
}

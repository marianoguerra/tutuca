// Assembles the static site in _site/: the landing page, the storybook, the demos and the spec
// PDF, with their pages pointing at pinned CDN copies of their dependencies instead of node_modules.
import { cpSync, existsSync, globSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { siteList } from "../demos/demos.js";
import { vendor } from "./vendor.js";

const out = "_site";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const version = (name) => lock.packages[`node_modules/${name}`].version;
const cdn = (name, path) => `https://cdn.jsdelivr.net/npm/${name}@${version(name)}/${path}`;

// The playground and the Automerge demo load bundles too big to keep in git; build them when
// they're missing.
if (!existsSync("site/deps/codemirror.js")) await vendor("codemirror");
if (!existsSync("demos/deps/automerge.js")) await vendor("automerge");
rmSync(out, { recursive: true, force: true });
cpSync("site", out, { recursive: true });
// What the storybook and demo pages load; storybook.html is written below, pointed at the CDN.
const pages = ["src", "deps", "components", "demos", ...globSync("storybook*.js")];
for (const path of pages) {
	cpSync(path, `${out}/${path}`, { recursive: true });
}

// Built by `racket spec/render.rkt` (`just spec`), which needs Racket; CI builds it first.
const spec = "spec/semantics.pdf";
if (existsSync(spec)) {
	cpSync(spec, `${out}/${spec}`);
} else if (process.env.CI) {
	throw new Error(`${spec} is missing: run racket spec/render.rkt first`);
} else {
	console.warn(`warning: ${spec} is missing, the site links to it: run just spec`);
}

// The tutuca-wax demos, playground and studio, in wax/: their pages with the files they load, at the same
// relative paths. dist/ is built by tutuca-wax's build (wax-mb, moon and wasm-opt); CI builds it
// first. Only the optimized modules: not the .debug.wasm copies, the assembled .wax or the
// generated prelude. The playground compiles in the browser with dist/tcd/tcd.wasm, from the
// runtime's prelude, collections and ABI and the components' .tcd and .wax sources.
const wax = "tutuca-wax";
if (existsSync(`${wax}/dist/tutuca-rt.wasm`)) {
	for (const path of [
		"demos",
		"playground",
		"studio",
		"js",
		"prelude",
		"src/abi.wax",
		"vendor/wax-mb",
		"vendor/margaui/margaui-css.wasm",
		"vendor/margaui/themes",
		"dist/tutuca-rt.wasm",
		"dist/tcd/tcd.wasm",
		"dist/examples.json",
	]) {
		cpSync(`${wax}/${path}`, `${out}/wax/${path}`, {
			recursive: true,
			// The editor's source: the page loads its bundle, deps/editor.js.
			filter: (src) => !src.endsWith("editor.src.js"),
		});
	}
	for (const file of [
		...globSync(`${wax}/dist/components/*.wasm`),
		// The sources the playground and the studio compile and use, and the
		// scripts components need (media's rating.js).
		...globSync(`${wax}/components/*/*.{tcd,wax,js}`),
	]) {
		if (!file.endsWith(".debug.wasm")) cpSync(file, `${out}/wax/${file.slice(wax.length + 1)}`);
	}
} else if (process.env.CI) {
	throw new Error(`${wax}/dist is missing: build tutuca-wax first (its scripts/build.mjs)`);
} else {
	console.warn(
		`warning: ${wax}/dist is missing, the site links to its demos: run just build in ${wax}`,
	);
}

// Site pages import tutuca by name, from the copy of src/ next to them.
const siteImportMap = (base) => ({
	imports: {
		tutuca: `${base}src/tutuca.js`,
		"tutuca/storybook": `${base}src/storybook/index.js`,
		"tutuca/playground": `${base}src/playground/index.js`,
		"tutuca/lint": `${base}src/lint/index.js`,
		margaui: cdn("margaui", "dist/margaui.min.js"),
		"fast-check": cdn("fast-check", "+esm"),
	},
});
const importMapScript = (map) =>
	`<script type="importmap">\n${JSON.stringify(map, null, 2)}\n</script>`;

const toCdn = (html, file) => {
	const result = html.replace(/(?:\.\.?\/)+node_modules\/margaui\//g, cdn("margaui", ""));
	if (result.includes("node_modules")) throw new Error(`${file} still points at node_modules`);
	return result;
};
for (const file of globSync(`${out}/demos/**/*.html`)) {
	writeFileSync(file, toCdn(readFileSync(file, "utf8"), file));
}

const importMap = {
	imports: {
		margaui: cdn("margaui", "dist/margaui.min.js"),
		"fast-check": cdn("fast-check", "+esm"),
	},
};
// Pages with an importmap marker get one, pointing at their depth.
for (const file of globSync(`${out}/**/*.html`)) {
	const page = readFileSync(file, "utf8");
	const marker = /<!-- importmap:[^>]*-->/;
	if (!marker.test(page)) continue;
	const depth = file.slice(out.length + 1).split("/").length - 1;
	const map = siteImportMap(depth === 0 ? "./" : "../".repeat(depth));
	writeFileSync(file, toCdn(page.replace(marker, importMapScript(map)), file));
}

// The landing page lists the demos from demos/demos.js.
const landing = `${out}/index.html`;
const marker = /<!-- demos:[^>]*-->/;
const page = readFileSync(landing, "utf8");
if (!marker.test(page)) throw new Error(`${landing} has no demos marker`);
writeFileSync(landing, page.replace(marker, siteList()));

const html = readFileSync("storybook.html", "utf8").replace(
	/<script type="importmap">[\s\S]*?<\/script>/,
	importMapScript(importMap),
);
writeFileSync(`${out}/storybook.html`, toCdn(html, "storybook.html"));
console.log(`site written to ${out}/`);

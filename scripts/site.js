// Assembles the static site in _site/: the landing page, the storybook, the demos and the spec
// PDF, with their pages pointing at pinned CDN copies of their dependencies instead of node_modules.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, globSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { siteList } from "../demos/demos.js";
import { vendorIfMissing } from "./vendor.js";

const out = "_site";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const version = (name) => lock.packages[`node_modules/${name}`].version;
const cdn = (name, path) => `https://cdn.jsdelivr.net/npm/${name}@${version(name)}/${path}`;

// The playground and the Automerge demo load bundles too big to keep in git; build them when
// they're missing.
// tutuca-wasm's micro-agents copy the engines (ajv to echarts) into their dist/ (its build makes
// them when they're missing too).
const BUNDLES = [
	"codemirror",
	"automerge",
	"ajv",
	"jq",
	"jsonpath",
	"picomatch",
	"vega",
	"echarts",
	"pdfkit",
	"docx",
];
for (const name of BUNDLES) await vendorIfMissing(name);
rmSync(out, { recursive: true, force: true });
cpSync("site", out, { recursive: true });
// What the storybook and demo pages load; storybook.html is written below, pointed at the CDN.
// pure-js's lib is what src/pure (the workshop and canvas demos, the storybook's pure-todo book)
// imports as "pure-js".
const pages = ["src", "deps", "components", "demos", "pure-js/lib", ...globSync("storybook*.js")];
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

// tutuca-wasm's pages (the playground, the demos, the micro-agents and the studio), in wasm/:
// the site its own site.sh assembles (MoonBit builds the runtime; the rest is copied), with
// only what a page reads.
const wasm = "tutuca-wasm";
const built = spawnSync("sh", [`${wasm}/site.sh`, resolve(`${out}/wasm`)], { encoding: "utf8" });
if (built.status !== 0) {
	const why = `${built.stdout ?? ""}${built.stderr ?? ""}`.trim();
	if (process.env.CI) throw new Error(`${wasm}/site.sh failed:\n${why}`);
	console.warn(`warning: ${wasm}'s pages weren't built, the site links to them:\n${why}`);
}

// What every page gets from the CDN instead of node_modules.
const cdnImports = {
	margaui: cdn("margaui", "dist/margaui.min.js"),
	"fast-check": cdn("fast-check", "+esm"),
};
// Site pages import tutuca by name, from the copy of src/ next to them: package.json's exports,
// at the page's depth.
const tutucaImports = (base) =>
	Object.fromEntries(
		Object.entries(pkg.exports)
			.filter(([, file]) => file.startsWith("./src/"))
			.map(([name, file]) => [`tutuca${name.slice(1)}`, base + file.slice(2)]),
	);
const siteImportMap = (base) => ({ imports: { ...tutucaImports(base), ...cdnImports } });
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

// The storybook imports src/ by path; its pure-todo book needs pure-js, copied above.
const importMap = { imports: { ...cdnImports, "pure-js": "./pure-js/lib/index.js" } };
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

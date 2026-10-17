// Assembles the static site in _site/: the landing page, the storybook, the demos and the spec
// PDF, with their pages pointing at pinned CDN copies of their dependencies instead of node_modules.
import { cpSync, existsSync, globSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { siteList } from "../demos/demos.js";

const out = "_site";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const version = (name) => lock.packages[`node_modules/${name}`].version;
const cdn = (name, path) => `https://cdn.jsdelivr.net/npm/${name}@${version(name)}/${path}`;

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

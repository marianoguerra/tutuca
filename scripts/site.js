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
// The landing page lists the demos from demos/demos.js.
const landing = `${out}/index.html`;
const marker = /<!-- demos:[^>]*-->/;
const page = readFileSync(landing, "utf8");
if (!marker.test(page)) throw new Error(`${landing} has no demos marker`);
writeFileSync(landing, page.replace(marker, siteList()));

const html = readFileSync("storybook.html", "utf8").replace(
	/<script type="importmap">[\s\S]*?<\/script>/,
	`<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>`,
);
writeFileSync(`${out}/storybook.html`, toCdn(html, "storybook.html"));
console.log(`site written to ${out}/`);

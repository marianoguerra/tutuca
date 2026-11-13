// Bundles devDependencies into single browser files, so pages run without a bundler:
//   immer       deps/immer.js: src/ imports it by path, in the repo and the npm package.
//   astring     deps/astring.js: src/jsast prints the ESTrees components render with it.
//   mdast       deps/mdast.js: mdast-util-to-markdown and the GFM extensions for what src/mdast's
//               schema has (strikethrough, tables, task list items); it prints the mdast trees
//               components render with them.
//   pdfkit      deps/pdfkit.js: PDFKit's browser build, its 14 standard fonts registered and its
//               toBytes; src/pdf prints the drawings components render with it.
//   docx        deps/docx.js: docx, which src/docx makes the Word documents components render with.
//               It and pdfkit are gitignored: CI builds them, as do `just vendor-printers`,
//               npm test (pretest, when missing) and the site build.
//   codemirror  site/deps/codemirror.js: the playground needs one copy of @codemirror/state.
//   automerge   demos/deps/automerge.js: automerge-repo needs one initialized copy of automerge;
//               the sync demo's importmap maps every @automerge package to it.
//   engines     demos/deps/{ajv,jq,jsonpath,picomatch,vega,echarts}.js: the micro-agents' engines,
//               which tutuca-wax's build copies into its dist/engines/.
//   markdownrswasm  components/markdown/vendor/: the <md-view> element and its wasm, copied from
//               a markdownrswasm checkout beside this one (built with `just dist` there); it
//               isn't on npm, so the copy is committed.
// Bump the packages in package.json, then run `just vendor <name>` (and the tests).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as esbuild from "esbuild";

const versionOf = (name) =>
	JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
const versions = (packages) => packages.map((name) => `${name} ${versionOf(name)}`).join(", ");
const reexports = (lines) => ({
	stdin: { contents: lines.join("\n"), resolveDir: ".", loader: "js" },
});

const MDAST_PACKAGES = [
	"mdast-util-to-markdown",
	"mdast-util-gfm-strikethrough",
	"mdast-util-gfm-table",
	"mdast-util-gfm-task-list-item",
];

// PDFKit's standard fonts, by module name: the 14 every PDF reader has.
const PDF_FONTS = [
	"Courier",
	"CourierBold",
	"CourierBoldOblique",
	"CourierOblique",
	"Helvetica",
	"HelveticaBold",
	"HelveticaBoldOblique",
	"HelveticaOblique",
	"Symbol",
	"TimesBold",
	"TimesBoldItalic",
	"TimesItalic",
	"TimesRoman",
	"ZapfDingbats",
];

const TARGETS = {
	immer: {
		out: "deps/immer.js",
		// dist.js reads the version back from the first line for its banner.
		title: () => {
			const pkg = JSON.parse(readFileSync("node_modules/immer/package.json", "utf8"));
			return `immer ${pkg.version} (${pkg.homepage?.replace(/#.*$/, "") ?? "https://github.com/immerjs/immer"})`;
		},
		license: "node_modules/immer/LICENSE",
		// The development build keeps immer's readable errors and checks; esbuild drops the
		// branches for production and the process.env reads a browser doesn't have.
		build: {
			entryPoints: ["node_modules/immer/dist/immer.mjs"],
			define: { "process.env.NODE_ENV": '"development"' },
		},
	},
	astring: {
		out: "deps/astring.js",
		title: () => `astring ${versionOf("astring")} (https://github.com/davidbonnet/astring)`,
		license: "node_modules/astring/LICENSE",
		build: { entryPoints: ["node_modules/astring/dist/astring.mjs"] },
	},
	mdast: {
		out: "deps/mdast.js",
		title: () => `${versions(MDAST_PACKAGES)} (https://github.com/syntax-tree)`,
		license: "node_modules/mdast-util-to-markdown/license",
		build: {
			...reexports([
				'export { toMarkdown } from "mdast-util-to-markdown";',
				'export { gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough";',
				'export { gfmTableToMarkdown } from "mdast-util-gfm-table";',
				'export { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";',
			]),
			// Not the browser builds: decode-named-character-reference's reads document when it
			// loads, and src/mdast runs in node too.
			platform: "neutral",
			mainFields: ["module", "main"],
		},
	},
	pdfkit: {
		out: "deps/pdfkit.js",
		title: () => `pdfkit ${versionOf("pdfkit")} (https://github.com/foliojs/pdfkit)`,
		license: "node_modules/pdfkit/LICENSE",
		build: {
			...reexports([
				'import { registerStdFonts } from "pdfkit";',
				...PDF_FONTS.map((f) => `import ${f} from "pdfkit/standard-fonts/${f}";`),
				`registerStdFonts(${PDF_FONTS.join(", ")});`,
				'export { PDFDocument } from "pdfkit";',
				'export { toBytes } from "pdfkit/output";',
			]),
			// The browser build in node too: it reads no files, the fonts are registered.
			conditions: ["browser"],
			minify: true,
		},
	},
	docx: {
		out: "deps/docx.js",
		title: () => `docx ${versionOf("docx")} (https://github.com/dolanmiu/docx)`,
		license: "node_modules/docx/LICENSE",
		build: { ...reexports(['export * from "docx";']), minify: true },
	},
	codemirror: {
		out: "site/deps/codemirror.js",
		title: () =>
			versions(["codemirror", "@codemirror/lang-javascript", "@codemirror/theme-one-dark"]),
		// Every CodeMirror package is MIT licensed by Marijn Haverbeke and others.
		license: "node_modules/codemirror/LICENSE",
		build: {
			...reexports([
				'export { basicSetup } from "codemirror";',
				'export { Compartment, EditorState } from "@codemirror/state";',
				'export { EditorView, keymap } from "@codemirror/view";',
				'export { javascript } from "@codemirror/lang-javascript";',
				'export { oneDark } from "@codemirror/theme-one-dark";',
			]),
			minify: true,
		},
	},
	automerge: {
		out: "demos/deps/automerge.js",
		title: () =>
			versions([
				"@automerge/automerge",
				"@automerge/automerge-repo",
				"@automerge/automerge-repo-network-broadcastchannel",
				"@automerge/automerge-repo-network-websocket",
				"@automerge/automerge-repo-storage-indexeddb",
			]),
		// Automerge and automerge-repo are MIT licensed by the Automerge contributors.
		license: "node_modules/@automerge/automerge/LICENSE",
		build: {
			...reexports([
				'export * from "@automerge/automerge";',
				'export { isValidAutomergeUrl, Repo } from "@automerge/automerge-repo";',
				'export { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";',
				'export { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";',
				'export { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";',
			]),
			// The browser entry expects a bundler that loads .wasm; the base64 one inlines the
			// wasm and initializes itself, so the page needs no loader.
			plugins: [
				{
					name: "automerge-base64",
					setup(build) {
						build.onResolve({ filter: /^@automerge\/automerge$/ }, () => ({
							path: resolve(
								"node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
							),
						}));
					},
				},
			],
			minify: true,
		},
	},
	// The micro-agents' engines: tutuca-wax's build copies them into its dist/engines/, where
	// its microagents/engines/ modules load them.
	ajv: {
		out: "demos/deps/ajv.js",
		title: () => versions(["ajv", "ajv-formats"]),
		license: "node_modules/ajv/LICENSE",
		build: {
			...reexports([
				'export { default as Ajv2020 } from "ajv/dist/2020.js";',
				'export { default as addFormats } from "ajv-formats";',
			]),
			minify: true,
		},
	},
	jq: {
		out: "demos/deps/jq.js",
		title: () => versions(["jq-wasm"]),
		license: "node_modules/jq-wasm/LICENSE",
		// The inline build carries jq.wasm as base64: one file, in Node and browsers alike.
		build: { ...reexports(['export * from "jq-wasm/inline";']), minify: true },
	},
	jsonpath: {
		out: "demos/deps/jsonpath.js",
		title: () => versions(["jsonpath-plus"]),
		license: "node_modules/jsonpath-plus/LICENSE",
		build: { ...reexports(['export { JSONPath } from "jsonpath-plus";']), minify: true },
	},
	picomatch: {
		out: "demos/deps/picomatch.js",
		title: () => versions(["picomatch"]),
		license: "node_modules/picomatch/LICENSE",
		build: { ...reexports(['export { default } from "picomatch/posix";']), minify: true },
	},
	vega: {
		out: "demos/deps/vega.js",
		title: () => versions(["vega", "vega-lite", "vega-embed"]),
		license: "node_modules/vega/LICENSE",
		build: {
			...reexports([
				'export * as vega from "vega";',
				'export { compile } from "vega-lite";',
				'export { default as embed } from "vega-embed";',
			]),
			minify: true,
		},
	},
	echarts: {
		out: "demos/deps/echarts.js",
		title: () => versions(["echarts"]),
		license: "node_modules/echarts/LICENSE",
		build: { ...reexports(['export * from "echarts";']), minify: true },
	},
	// Copied, not bundled: the element loads its wasm glue by path, and the glue its wasm.
	markdownrswasm: {
		out: "components/markdown/vendor/markdownrswasmwc.js",
		copy: {
			from: "../markdownrswasm",
			to: "components/markdown/vendor",
			files: ["markdownrswasm.js", "markdownrswasm_bg.wasm", "markdown.js", "markdownrswasmwc.js"],
		},
	},
};

// Copies a checkout's built pkg/ files, saying where they came from in a VERSION file.
const copyBuilt = ({ from, to, files }) => {
	const pkg = `${from}/pkg`;
	const missing = files.filter((f) => !existsSync(`${pkg}/${f}`));
	if (missing.length > 0)
		throw new Error(`${pkg} lacks ${missing.join(", ")}: run \`just dist\` in ${from}`);
	mkdirSync(to, { recursive: true });
	for (const f of files) copyFileSync(`${pkg}/${f}`, `${to}/${f}`);
	const sha = execFileSync("git", ["-C", from, "rev-parse", "--short", "HEAD"], {
		encoding: "utf8",
	}).trim();
	const version = JSON.parse(readFileSync(`${pkg}/package.json`, "utf8")).version;
	const title = `markdownrswasm ${version} (https://github.com/marianoguerra/markdownrswasm @ ${sha})`;
	writeFileSync(`${to}/VERSION`, `${title}, copied by scripts/vendor.js from ${pkg}.\n`);
	console.log(`${to}: ${title}`);
};

export const vendor = async (name) => {
	const target = TARGETS[name];
	if (!target) throw new Error(`unknown vendor target ${name}: one of ${Object.keys(TARGETS)}`);
	if (target.copy) return copyBuilt(target.copy);
	const { outputFiles } = await esbuild.build({
		bundle: true,
		format: "esm",
		platform: "browser",
		charset: "utf8",
		legalComments: "none",
		logLevel: "warning",
		write: false,
		...target.build,
	});
	const title = target.title();
	const license = readFileSync(target.license, "utf8").trim();
	const header = [
		`/*! ${title}, vendored by scripts/vendor.js.`,
		" *",
		...license.split("\n").map((line) => ` * ${line}`.trimEnd()),
		" */",
	].join("\n");
	mkdirSync(dirname(target.out), { recursive: true });
	writeFileSync(target.out, `${header}\n${outputFiles[0].text}`);
	console.log(`${target.out}: ${title}`);
};

// Builds the bundle name unless it's there already.
export const vendorIfMissing = async (name) => {
	if (!existsSync(TARGETS[name]?.out ?? "")) await vendor(name);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	// --if-missing builds only the bundles that aren't there yet (npm run lint's prelint,
	// tutuca-wax's build).
	const ifMissing = process.argv.includes("--if-missing");
	const names = process.argv.slice(2).filter((a) => a !== "--if-missing");
	if (!names.length)
		throw new Error(
			`usage: node scripts/vendor.js [--if-missing] ${Object.keys(TARGETS).join("|")}...`,
		);
	for (const name of names) await (ifMissing ? vendorIfMissing(name) : vendor(name));
}

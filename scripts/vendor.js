// Bundles devDependencies into single browser files, so pages run without a bundler:
//   immer       deps/immer.js: src/ imports it by path, in the repo and the npm package.
//   codemirror  site/deps/codemirror.js: the playground needs one copy of @codemirror/state.
//   automerge   demos/deps/automerge.js: automerge-repo needs one initialized copy of automerge;
//               the sync demo's importmap maps every @automerge package to it.
// Bump the packages in package.json, then run `just vendor <name>` (and the tests).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as esbuild from "esbuild";

const versionOf = (name) =>
	JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
const versions = (packages) => packages.map((name) => `${name} ${versionOf(name)}`).join(", ");
const reexports = (lines) => ({
	stdin: { contents: lines.join("\n"), resolveDir: ".", loader: "js" },
});

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
};

export const vendor = async (name) => {
	const target = TARGETS[name];
	if (!target) throw new Error(`unknown vendor target ${name}: one of ${Object.keys(TARGETS)}`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
	const names = process.argv.slice(2);
	if (!names.length)
		throw new Error(`usage: node scripts/vendor.js ${Object.keys(TARGETS).join("|")}...`);
	for (const name of names) await vendor(name);
}

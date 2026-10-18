// Writes demos/deps/automerge.js from the automerge devDependencies: the sync demo runs in a
// browser without a bundler, and automerge-repo needs a single, initialized copy of automerge.
// The wasm is inlined as base64 so the page needs no loader. Its importmap maps both
// "@automerge/automerge" and "@automerge/automerge-repo" to this file. Bump the packages in
// package.json, then run `just vendor-automerge`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const packages = [
	"@automerge/automerge",
	"@automerge/automerge-repo",
	"@automerge/automerge-repo-network-broadcastchannel",
	"@automerge/automerge-repo-network-websocket",
	"@automerge/automerge-repo-storage-indexeddb",
];
const versionOf = (name) =>
	JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
// The browser entry expects a bundler that loads .wasm; the base64 one initializes itself.
const base64Entry = {
	name: "automerge-base64",
	setup(build) {
		build.onResolve({ filter: /^@automerge\/automerge$/ }, () => ({
			path: resolve("node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js"),
		}));
	},
};

const { outputFiles } = await esbuild.build({
	stdin: {
		contents: [
			'export * from "@automerge/automerge";',
			'export { isValidAutomergeUrl, Repo } from "@automerge/automerge-repo";',
			'export { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";',
			'export { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";',
			'export { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";',
		].join("\n"),
		resolveDir: ".",
		loader: "js",
	},
	plugins: [base64Entry],
	bundle: true,
	format: "esm",
	platform: "browser",
	minify: true,
	charset: "utf8",
	legalComments: "none",
	logLevel: "warning",
	write: false,
});

// Automerge and automerge-repo are MIT licensed by the Automerge contributors.
const license = readFileSync("node_modules/@automerge/automerge/LICENSE", "utf8").trim();
const header = [
	`/*! ${packages.map((name) => `${name} ${versionOf(name)}`).join(", ")}, vendored by scripts/vendor-automerge.js.`,
	" *",
	...license.split("\n").map((line) => ` * ${line}`.trimEnd()),
	" */",
].join("\n");
mkdirSync("demos/deps", { recursive: true });
writeFileSync("demos/deps/automerge.js", `${header}\n${outputFiles[0].text}`);
console.log(`demos/deps/automerge.js: ${packages.map((n) => `${n} ${versionOf(n)}`).join(", ")}`);

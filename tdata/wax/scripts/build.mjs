// Assembles tdata's Wax sources into dist/tdata.wax and compiles it to dist/tdata.wasm (wasm-gc,
// js-string builtins, imported string constants "'"). Wax has no source imports, so the sources
// are concatenated in the order below, each after the ones it uses. When wax-mb rejects the
// module, the locations it reports are mapped back to the source files.
//
// The compiler: WAX_MB if set, else the pinned build tutuca-wax's `just setup` makes.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SOURCES = [
	"src/prelude.wax", // js-string builtins, host imports, the failure tag
	"src/strings.wax", // string constants
	"src/model.wax", // the data model
	"src/buf.wax", // text and byte builders, base64
	"src/codecs.wax", // the codec registry, wire views
	"src/equal.wax", // structural equality
	"src/json_write.wax", // JSON encoding
	"src/json_read.wax", // JSON decoding
	"src/cbor_write.wax", // CBOR encoding
	"src/cbor_read.wax", // CBOR decoding
	"src/spec.wax", // specs, the registry, the router
	"src/api.wax", // exports for the JS side
];

const WAX_MB =
	process.env.WAX_MB ??
	join(
		root,
		"../../tutuca-wax/.tools/wax-mb/_build/native/debug/build/marianoguerra/wax-cli/wax-mb/wax-mb.exe",
	);

export const build = () => {
	if (!existsSync(WAX_MB))
		throw new Error(
			`wax-mb not found at ${WAX_MB}: run \`just setup\` in tutuca-wax, or set WAX_MB`,
		);
	const parts = [];
	const map = []; // [first line in the assembled file, source, line count]
	let line = 1;
	for (const src of SOURCES) {
		const text = readFileSync(join(root, src), "utf8");
		const body = text.endsWith("\n") ? text : `${text}\n`;
		const n = body.split("\n").length - 1;
		map.push([line, src, n]);
		parts.push(body);
		line += n;
	}
	mkdirSync(join(root, "dist"), { recursive: true });
	const assembled = join(root, "dist/tdata.wax");
	writeFileSync(assembled, parts.join(""));
	const out = join(root, "dist/tdata.wasm");
	const r = spawnSync(WAX_MB, [assembled, "-f", "wasm", "-o", out, "--color", "never"], {
		encoding: "utf8",
	});
	if (r.status !== 0) {
		const where = (n) => {
			for (const [first, src, count] of map)
				if (n >= first && n < first + count) return `${src}:${n - first + 1}`;
			return `dist/tdata.wax:${n}`;
		};
		const msg = `${r.stdout}${r.stderr}`.replace(/\S*tdata\.wax:(\d+)/g, (_m, n) =>
			where(Number(n)),
		);
		throw new Error(`wax-mb rejected the module:\n${msg}`);
	}
	return out;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		console.log(`wrote ${build()}`);
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}

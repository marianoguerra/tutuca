// Assembles the Wax sources into modules and compiles them to wasm-gc: the
// runtime (dist/tutuca-rt.wasm), and each component module
// (dist/components/<name>.wasm), which the runtime loads at run time. wax-mb
// writes <name>.debug.wasm, with its name section, for readable stack traces;
// binaryen's wasm-opt optimizes it into <name>.wasm, what the tests, the demos
// and a page load.
//
// Wax has no source imports: a program is one module, so its sources are
// concatenated in the order below, where every file comes after the ones it
// uses (types must be declared before they are used, outside a rec group).
// The assembled modules are kept in dist/ for reading the emitted code; when
// the compiler rejects one, the locations it reports are mapped back to the
// source files.
//
// The runtime and the component modules share the prelude (prelude/*.wax):
// types and i32 consts, no code. wasm-gc types are the same across modules
// when their declarations are, so a component built with the prelude passes
// the runtime the runtime's own types. Two prelude files are generated:
// - the vendored collections' types, taken from vendor/wax-mb (the runtime
//   has the vendored files whole, functions and all; components only the
//   types, since the functions are the runtime's);
// - the import block of the component ABI, read from src/abi.wax.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SOURCES = [
	"prelude/js_string.wax", // shared: the js-string builtins
	"src/imports.wax", // host imports: string constants, the DOM
	"vendor/wax-mb/persistent_hash_map.wax", // wax-mb's HAMT, unmodified
	"vendor/wax-mb/persistent_vector.wax", // wax-mb's persistent vector, unmodified
	"prelude/value.wax", // shared: the Value types
	"prelude/path.wax", // shared: path keys, frames, dispatch paths, selectors
	"prelude/sem.wax", // shared: shapes, templates, the semantic tree
	"prelude/view.wax", // shared: views as data
	"prelude/schema.wax", // shared: value types, constraints, field schemas
	"prelude/component.wax", // shared: the component runtime's types
	"src/str.wax", // string helpers over JS strings
	"src/buf.wax", // growable arrays of externrefs and i32s
	"src/key_map.wax", // string -> i32 hash map, for sibling keys
	"src/value.wax", // the Value type
	"src/collections.wax", // List and Map, over the vendored collections
	"src/vnode.wax", // shapes and vnodes
	"src/dom.wax", // building and morphing the DOM
	"src/path.wax", // path keys and frames
	"src/text.wax", // building strings, JSON text
	"src/meta.wax", // the metadata comments' text
	"src/sem.wax", // the semantic tree
	"src/lower.wax", // the semantic tree to vnodes
	"src/view.wax", // views as data
	"src/walk.wax", // walking views
	"src/collect.wax", // what walking views collects: templates, class names
	"src/component.wax", // the component runtime's types
	"src/route.wax", // paths: reading and writing the state, dispatch paths, selectors
	"src/schema.wax", // schemas: checking values, interfaces, describing them
	"src/scope.wax", // scopes: registering and making components
	"src/context.wax", // what a handler does through its context
	"src/render.wax", // rendering components into the semantic tree
	"src/eval.wax", // evaluating views; making specs from them
	"src/decode.wax", // routing a DOM event to a handler
	"src/host.wax", // tasks, transactions, rendering
	"src/check.wax", // what the host checks with schemas: arguments, contracts, the state
	"src/api.wax", // exports for the JS side
	"lib/author.wax", // helpers for writing component types, exported for them
	"src/abi.wax", // the component ABI: what component modules import
];

// The prelude without the js-string builtins, which come first.
const PRELUDE = ["prelude/value.wax", "prelude/path.wax", "prelude/sem.wax", "prelude/view.wax", "prelude/schema.wax", "prelude/component.wax"];

// The generated prelude files components are assembled with: the vendored
// collections' types, and per module, the ABI functions its sources call.
const COLLECTION_TYPES = "dist/prelude/collections_types.wax";
const abiImportsOf = (name) => `dist/components/${name}.abi.wax`;

// What a component module is assembled from before its own sources.
export const componentPrelude = (name) => ["prelude/js_string.wax", COLLECTION_TYPES, ...PRELUDE, abiImportsOf(name)];

// The component modules: each a .wasm of its own, exporting tutuca_register and
// tutuca_abi_version (README.md has the convention).
export const COMPONENTS = [
	// Defined in TCD (tcd/): tcd generates the boilerplate, the .wax has the rest.
	{ name: "counter", tcd: "components/counter/counter.tcd", impl: ["components/counter/counter.wax"] },
	{ name: "todo_item", tcd: "components/todo_item/todo_item.tcd", impl: ["components/todo_item/todo_item.wax"] },
	{ name: "todo_list", tcd: "components/todo_list/todo_list.tcd", impl: ["components/todo_list/todo_list.wax"] },
	// Another TodoItem, as a card: the same interface, another implementation.
	{ name: "todo_card", tcd: "components/todo_card/todo_card.tcd", impl: ["components/todo_card/todo_card.wax"] },
	// Shelf and Note: scopes, loop hooks, provided values, pushView, renderIt.
	{ name: "showcase", tcd: "components/showcase/showcase.tcd", impl: ["components/showcase/showcase.wax"] },
	{ name: "probe", sources: ["components/probe/probe.wax"] },
	// For js/pbt.js's tests: a seeded bug, a message that can't be enabled.
	{ name: "pbt", tcd: "components/pbt/pbt.tcd", impl: ["components/pbt/pbt.wax"] },
	{ name: "json", tcd: "components/json/json.tcd", impl: ["components/json/json.wax"] },
];


const TARGETS = [
	{ name: "tutuca-rt", sources: SOURCES },
	...COMPONENTS.map(({ name, sources, tcd, impl }) =>
		tcd ? { name: `components/${name}`, tcd, impl } : { name: `components/${name}`, sources: [...componentPrelude(name), ...sources] },
	),
];

// The top-level `type ...;` and `rec { ... }` items of a Wax source, in order.
// Items start at column 0 and end where their brackets close: at a `;`, or
// at a rec group's `}`.
export const typeItems = (text) => {
	const items = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (!/^(type |rec \{)/.test(lines[i])) continue;
		const item = [];
		let depth = 0;
		for (; i < lines.length; i++) {
			const code = lines[i].replace(/\/\/.*$/, "");
			item.push(lines[i]);
			for (const ch of code) {
				if ("{[(".includes(ch)) depth++;
				else if ("}])".includes(ch)) depth--;
			}
			if (depth === 0 && (/;\s*$/.test(code) || /^\}\s*$/.test(code))) break;
		}
		items.push(item.join("\n"));
	}
	return items;
};

// The ABI's import declarations, from src/abi.wax's wrappers: an
// `export = "x"` attribute on `fn abi_x(params) -> result {` becomes an
// `import = "x"` one on `fn x(params) -> result;`, as { name, decl }.
// tutuca_abi_version isn't imported: a component exports its own.
export const abiImports = (text) => {
	const pattern = /#\[export = "([^"]+)"\]\s*fn abi_(\w+)\(([^)]*)\)(?:\s*->\s*([^{]+?))?\s*\{/g;
	const decls = [];
	for (const [, name, fn, params, result] of text.matchAll(pattern)) {
		if (name !== fn) throw new Error(`src/abi.wax: export ${name} is fn abi_${fn}, not abi_${name}`);
		if (name === "tutuca_abi_version") continue;
		const list = params
			.split(",")
			.map((p) => p.trim().replace(/\s+/g, " "))
			.filter(Boolean)
			.join(", ");
		decls.push({ name, decl: `    #[import = "${name}"]\n    fn ${name}(${list})${result ? ` -> ${result.trim()}` : ""};` });
	}
	return decls;
};

// The prelude holds types, i32 consts and import declarations, never code: a
// top-level fn or let, or a const of a reference type, would be compiled into
// every module, each with its own copy.
const checkPrelude = () => {
	for (const file of ["prelude/js_string.wax", ...PRELUDE]) {
		readFileSync(join(root, file), "utf8")
			.split("\n")
			.forEach((line, i) => {
				if (/^(fn |let |const [\w]+\s*:)/.test(line)) {
					throw new Error(`${file}:${i + 1}: the prelude holds types and i32 consts only, not \`${line.trim()}\``);
				}
			});
	}
};

// Writes the generated prelude files.
const generatePrelude = () => {
	checkPrelude();
	mkdirSync(join(root, "dist/prelude"), { recursive: true });
	const vendored = ["vendor/wax-mb/persistent_hash_map.wax", "vendor/wax-mb/persistent_vector.wax"];
	const types = vendored.flatMap((f) => typeItems(readFileSync(join(root, f), "utf8")));
	writeFileSync(
		join(root, COLLECTION_TYPES),
		`// Generated by scripts/build.mjs: the types of ${vendored.join(" and ")}.\n\n${types.join("\n\n")}\n`,
	);
	// A wasm import is an entry of the module's import section whether it's
	// called or not, so each module imports only the names its sources use.
	const decls = abiImports(readFileSync(join(root, "src/abi.wax"), "utf8"));
	mkdirSync(join(root, "dist/components"), { recursive: true });
	for (const { name, sources } of COMPONENTS) {
		if (!sources) continue; // tcd writes a TCD module's imports itself
		const code = sources.map((f) => readFileSync(join(root, f), "utf8").replace(/\/\/.*$/gm, "")).join("\n");
		const used = decls.filter((d) => new RegExp(`\\b${d.name}\\b`).test(code));
		writeFileSync(
			join(root, abiImportsOf(name)),
			`// Generated by scripts/build.mjs from src/abi.wax: the runtime's functions\n// the ${name} module calls, imported as module "tutuca".\n\nimport "tutuca" {\n${used.map((d) => d.decl).join("\n")}\n}\n`,
		);
	}
};

// wasm-opt's features: the ones engines ship, which wax-mb's output uses.
// Not -all: it turns on proposals engines don't ship yet (custom descriptors'
// exact types), and engines reject what it writes then.
const WASM_OPT_FEATURES = [
	"--enable-gc",
	"--enable-reference-types",
	"--enable-multivalue",
	"--enable-bulk-memory",
	"--enable-sign-ext",
	"--enable-nontrapping-float-to-int",
	"--enable-mutable-globals",
	"--enable-tail-call",
];

const findWasmOpt = () => {
	if (process.env.WASM_OPT) return process.env.WASM_OPT;
	const local = join(root, "node_modules/.bin/wasm-opt");
	if (existsSync(local)) return local;
	return "wasm-opt";
};

// Optimizes input into output, dropping the name section. It keeps the types
// a component module shares with the runtime as they are (it doesn't run in
// closed-world mode), so optimized modules link with each other, and with
// unoptimized ones.
const optimize = (input, output) => {
	const wasmOpt = findWasmOpt();
	const result = spawnSync(wasmOpt, [...WASM_OPT_FEATURES, "-O2", input, "-o", output], { cwd: root, encoding: "utf8" });
	if (result.error) {
		throw new Error(`could not run ${wasmOpt} (${result.error.message}); run \`npm install\` or set WASM_OPT`);
	}
	// It doesn't read wax-mb's label names; they're dropped with the rest.
	const report = `${result.stdout}${result.stderr}`
		.split("\n")
		.filter((l) => l.trim() && !l.includes("unknown name subsection"))
		.join("\n");
	if (result.status !== 0) {
		process.stderr.write(`${report}\n`);
		throw new Error(`wasm-opt exited with ${result.status} on ${input}`);
	}
	if (report) process.stderr.write(`${report}\n`);
};

export const findWaxMb = () => {
	if (process.env.WAX_MB) return process.env.WAX_MB;
	const local = join(root, ".tools/wax-mb/_build/native/debug/build/marianoguerra/wax-cli/wax-mb/wax-mb.exe");
	if (existsSync(local)) return local;
	return "wax-mb"; // on PATH, e.g. from `moon install marianoguerra/wax-cli`
};

// Concatenates the sources, recording where each one starts in the output.
const assemble = (sources) => {
	const parts = [];
	const ranges = [];
	let line = 1;
	for (const file of sources) {
		const text = readFileSync(join(root, file), "utf8").replace(/\n*$/, "\n");
		const header = `// ---- ${file}\n`;
		parts.push(header, text, "\n");
		line += 1; // the header
		const lines = text.split("\n").length - 1;
		ranges.push({ file, start: line, end: line + lines - 1 });
		line += lines + 1; // the blank separator
	}
	return { text: parts.join(""), ranges };
};

// Rewrites "dist/<name>.wax:L:C" in compiler output to "src/file.wax:l:C".
const mapLocations = (output, ranges, outWax) => {
	const base = outWax.split("/").pop().replace(/[.]/g, "\\.");
	const pattern = new RegExp(`(?:[^\\s]*/)?${base}:(\\d+):(\\d+)`, "g");
	return output.replace(pattern, (match, l, c) => {
		const n = Number(l);
		const range = ranges.find((r) => n >= r.start && n <= r.end);
		return range ? `${range.file}:${n - range.start + 1}:${c} (${outWax}:${n})` : match;
	});
};

// The tcd command (tcd/), built with moon when it isn't, or TCD.
export const findTcd = () => {
	if (process.env.TCD) return process.env.TCD;
	const result = spawnSync("moon", ["-C", "tcd", "build", "--target", "native"], { cwd: root, encoding: "utf8" });
	if (result.error || result.status !== 0) {
		process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
		throw new Error(`could not build tcd with moon${result.error ? ` (${result.error.message})` : ""}`);
	}
	return join(root, "tcd/_build/native/debug/build/tutuca/tcd/cmd/tcd/tcd.exe");
};

// tcd and wax-mb's library compiled to wasm-gc (tcd/web), for the
// playground to compile components in the browser: dist/tcd/tcd.wasm.
export function buildTcdWeb() {
	const result = spawnSync("moon", ["-C", "tcd", "build", "--target", "wasm-gc", "--release"], { cwd: root, encoding: "utf8" });
	if (result.error || result.status !== 0) {
		process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
		throw new Error(`could not build tcd for wasm-gc${result.error ? ` (${result.error.message})` : ""}`);
	}
	const out = "dist/tcd/tcd.wasm";
	mkdirSync(join(root, "dist/tcd"), { recursive: true });
	copyFileSync(join(root, "tcd/_build/wasm-gc/release/build/tutuca/tcd/web/web.wasm"), join(root, out));
	return out;
}

export function build() {
	generatePrelude();
	return [...TARGETS.map(buildTarget), buildTcdWeb()];
}

// A component module defined in TCD: tcd generates its contract and glue
// (kept in dist/ next to it), checks the implementation against them, and
// compiles it with the runtime's prelude.
function buildTcd({ name, tcd, impl }) {
	const OUT_DEBUG = `dist/${name}.debug.wasm`;
	const OUT_WASM = `dist/${name}.wasm`;
	mkdirSync(dirname(join(root, OUT_DEBUG)), { recursive: true });
	const bin = findTcd();
	const result = spawnSync(bin, ["build", tcd, ...impl, "--runtime", ".", "-o", OUT_DEBUG, "--gen", dirname(OUT_DEBUG)], {
		cwd: root,
		encoding: "utf8",
	});
	const output = `${result.stdout}${result.stderr}`;
	if (result.error || result.status !== 0) {
		process.stderr.write(output);
		throw new Error(`tcd build ${tcd} failed${result.error ? ` (${result.error.message})` : ""}`);
	}
	if (output.trim()) process.stderr.write(output);
	// The model test runners generate states and messages from (js/pbt.js).
	const model = spawnSync(bin, ["model", tcd, "-o", `dist/${name}.model.json`], { cwd: root, encoding: "utf8" });
	if (model.status !== 0) {
		process.stderr.write(`${model.stdout}${model.stderr}`);
		throw new Error(`tcd model ${tcd} failed`);
	}
	optimize(OUT_DEBUG, OUT_WASM);
	return relative(process.cwd(), join(root, OUT_WASM));
}

function buildTarget(target) {
	if (target.tcd) return buildTcd(target);
	const { name, sources } = target;
	const OUT_WAX = `dist/${name}.wax`;
	const OUT_DEBUG = `dist/${name}.debug.wasm`;
	const OUT_WASM = `dist/${name}.wasm`;
	const { text, ranges } = assemble(sources);
	mkdirSync(dirname(join(root, OUT_WAX)), { recursive: true });
	writeFileSync(join(root, OUT_WAX), text);
	const waxMb = findWaxMb();
	const result = spawnSync(waxMb, [OUT_WAX, "-f", "wasm", "-o", OUT_DEBUG, "--color", "never"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.error) {
		throw new Error(`could not run ${waxMb} (${result.error.message}); run \`npm run setup\` or set WAX_MB`);
	}
	const output = mapLocations(`${result.stdout}${result.stderr}`, ranges, OUT_WAX);
	if (result.status !== 0) {
		process.stderr.write(output);
		throw new Error(`wax-mb exited with ${result.status}`);
	}
	if (output.trim()) process.stderr.write(output);
	optimize(OUT_DEBUG, OUT_WASM);
	return relative(process.cwd(), join(root, OUT_WASM));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		for (const out of build()) console.log(`built ${out}`);
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}

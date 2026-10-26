// tcd in the browser (and in Node): dist/tcd/tcd.wasm, tcd and wax-mb's
// library compiled to wasm-gc (tcd/web). Requests and responses cross as
// JSON strings; this turns them into objects, and a module's bytes into a
// Uint8Array.
//
// It needs the engine's js-string builtins (Chrome 131, Firefox 134, Node 24
// and later): its strings are JS strings it builds with fromCharCodeArray,
// which a polyfill can't read without an export the module doesn't have.

import { readBytes } from "./tutuca-rt.js";

// The runtime's files a component module is built with, by their paths in
// tutuca-wax (tcd/compose's prelude_files and collection_files, src/abi.wax).
export const RUNTIME_FILES = [
	"prelude/js_string.wax",
	"prelude/value.wax",
	"prelude/path.wax",
	"prelude/sem.wax",
	"prelude/view.wax",
	"prelude/schema.wax",
	"prelude/component.wax",
	"vendor/wax-mb/persistent_hash_map.wax",
	"vendor/wax-mb/persistent_vector.wax",
	"src/abi.wax",
];

// Reads the runtime's files relative to base (tutuca-wax's directory, as a URL).
export async function loadRuntimeFiles(base) {
	const out = {};
	for (const path of RUNTIME_FILES) {
		const bytes = await readBytes(new URL(path, base));
		out[path] = new TextDecoder().decode(bytes);
	}
	return out;
}

// Instantiates tcd from its bytes or URL. Resolves with { check, stub,
// model, build }, each taking { main, files, impls, runtime } (build also
// needs runtime) and returning the response, wasm as a Uint8Array.
export async function loadTcd(source) {
	const bytes = source instanceof URL ? await readBytes(source) : source;
	let module;
	try {
		module = await WebAssembly.compile(bytes, { builtins: ["js-string"], importedStringConstants: "_" });
	} catch (error) {
		throw new Error(`tcd needs WebAssembly GC and the js-string builtins (Chrome 131, Firefox 134 or later): ${error.message}`);
	}
	const left = WebAssembly.Module.imports(module);
	if (left.length > 0) {
		throw new Error("tcd needs the js-string builtins, which this engine doesn't provide (Chrome 131, Firefox 134 or later have them)");
	}
	const { exports } = await WebAssembly.instantiate(module, {});
	exports._start();
	const call = (fn) => (request) => {
		const response = JSON.parse(fn(JSON.stringify(request)));
		if (Array.isArray(response.wasm)) response.wasm = Uint8Array.from(response.wasm);
		return response;
	};
	return {
		check: call(exports.tcd_check),
		stub: call(exports.tcd_stub),
		model: call(exports.tcd_model),
		build: call(exports.tcd_build),
	};
}

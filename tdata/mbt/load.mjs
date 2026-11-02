// Loads tq's builds. Both engines have the same interface: tq_parse(query),
// tq_match(query, message_json), tq_match_all(...), tq_run(...) and tq_canon(message_json),
// each returning a string of canonical tdata JSON.

/** The wasm-gc build, from its bytes (a Uint8Array or ArrayBuffer). */
export const instantiateWasm = async (bytes) => {
	const { instance } = await WebAssembly.instantiate(
		bytes,
		{},
		{ builtins: ["js-string"], importedStringConstants: "_" },
	);
	return instance.exports;
};

/** The wasm-gc build from dist/tq.wasm, in Node. */
export const loadWasm = async () => {
	const { readFile } = await import("node:fs/promises");
	return instantiateWasm(await readFile(new URL("./dist/tq.wasm", import.meta.url)));
};

/** The JS (ESM) build from dist/tq.js. */
export const loadJs = () => import("./dist/tq.js");

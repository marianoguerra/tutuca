// Loads dist/tdata.wasm (scripts/build.mjs builds it) with the js-string builtins, the imported
// string constants and the host's number text, and wraps its exports for tests.

import { readFileSync } from "node:fs";

export const load = async () => {
	const bytes = readFileSync(new URL("../dist/tdata.wasm", import.meta.url));
	const module = await WebAssembly.compile(bytes, {
		builtins: ["js-string"],
		importedStringConstants: "'",
	});
	const { exports: e } = await WebAssembly.instantiate(module, {
		tdata: { doubleToText: (x) => String(x), textToDouble: (s) => Number(s) },
	});
	const toWasm = (u8) => {
		const b = e.td_bytes_new(u8.length);
		for (let i = 0; i < u8.length; i++) e.td_bytes_set(b, i, u8[i]);
		return b;
	};
	const fromWasm = (b) => {
		const out = new Uint8Array(e.td_bytes_length(b));
		for (let i = 0; i < out.length; i++) out[i] = e.td_bytes_get(b, i);
		return out;
	};
	const orFail = (x) => {
		if (x === null) throw new Error(e.td_error() ?? "failed");
		return x;
	};
	return {
		exports: e,
		/** The canonical JSON of a JSON text. */
		jsonCanon: (text, message = false) => orFail(e.td_json_canon(text, message ? 1 : 0)),
		jsonToCbor: (text, message = false) =>
			fromWasm(orFail(e.td_json_to_cbor(text, message ? 1 : 0))),
		cborToJson: (u8, message = false) => orFail(e.td_cbor_to_json(toWasm(u8), message ? 1 : 0)),
		check: (spec, x, message = false) => JSON.parse(orFail(e.td_check(spec, x, message ? 1 : 0))),
		loadSpecs: (text) => {
			if (!e.td_specs_load(text)) throw new Error(e.td_error() ?? "specs failed to load");
		},
		resetSpecs: () => e.td_specs_reset(),
		route: (spec, id) => {
			if (!e.td_route(spec, id)) throw new Error(e.td_error() ?? "route failed");
		},
		dispatch: (msg) => JSON.parse(orFail(e.td_dispatch(msg))),
		usePointCodec: (on) => e.td_use_point_codec(on ? 1 : 0),
		countNatives: (text) => e.td_count_natives(text),
	};
};

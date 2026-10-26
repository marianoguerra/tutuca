// The suite against jsdom, one node:test test per case, twice: with the
// engine's js-string builtins and string constants, and with the polyfills
// js/tutuca-rt.js falls back to on engines without them.
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { JSDOM } from "jsdom";
import { load } from "../js/tutuca-rt.js";
import { cases, prepare } from "./suite.mjs";

const bytesOf = (path) => readFile(new URL(`../dist/${path}.wasm`, import.meta.url));

for (const builtins of [true, false]) {
	const vdom = await load(new URL("../dist/tutuca-rt.wasm", import.meta.url), { builtins });
	// The component modules load the same way as the runtime: builtins or polyfills.
	const shared = await prepare(vdom, bytesOf);
	describe(builtins ? "builtins" : "polyfills", () => {
		test("the module runs on what was asked for", () => {
			if (vdom.builtins !== builtins) throw new Error(`builtins: ${vdom.builtins}`);
		});
		for (const { name, fn } of cases) {
			test(name, async () => {
				const { window } = new JSDOM("");
				const { document } = window;
				await fn({ vdom, window, document, container: document.createElement("div"), ...shared });
			});
		}
	});
}

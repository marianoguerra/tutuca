// The compiler worker (a module worker): tcd and wax-mb compiled to wasm-gc
// (dist/tcd/tcd.wasm), with the runtime's prelude and ABI it builds component
// modules with, fetched once. The page asks it to check, stub, model or build;
// compiling stays off the page's thread. version is the SHA-256 of tcd.wasm,
// for pages that keep what it built to tell when it changed.
import { loadRuntimeFiles, loadTcd } from "../js/tcd-web.js";

const base = new URL("../", import.meta.url);
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const ready = (async () => {
	const bytes = new Uint8Array(await (await fetch(new URL("dist/tcd/tcd.wasm", base))).arrayBuffer());
	const version = hex(await crypto.subtle.digest("SHA-256", bytes));
	const [tcd, runtime] = await Promise.all([loadTcd(bytes), loadRuntimeFiles(base)]);
	return { tcd: { ...tcd, version: () => ({ ok: true, version }) }, runtime };
})();

self.onmessage = async ({ data: { id, action, request } }) => {
	try {
		const { tcd, runtime } = await ready;
		const started = performance.now();
		const response = tcd[action]({ ...request, runtime });
		response.ms = Math.round(performance.now() - started);
		self.postMessage({ id, response }, response.wasm ? [response.wasm.buffer] : []);
	} catch (error) {
		self.postMessage({ id, error: error.message });
	}
};

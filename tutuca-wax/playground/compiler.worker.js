// The compiler worker (a module worker): tcd and wax-mb compiled to wasm-gc
// (dist/tcd/tcd.wasm), with the runtime's prelude and ABI it builds component
// modules with, fetched once. The page asks it to check, stub, model or build;
// compiling stays off the page's thread.
import { loadRuntimeFiles, loadTcd } from "../js/tcd-web.js";

const base = new URL("../", import.meta.url);
const ready = Promise.all([loadTcd(new URL("dist/tcd/tcd.wasm", base)), loadRuntimeFiles(base)]);

self.onmessage = async ({ data: { id, action, request } }) => {
	try {
		const [tcd, runtime] = await ready;
		const started = performance.now();
		const response = tcd[action]({ ...request, runtime });
		response.ms = Math.round(performance.now() - started);
		self.postMessage({ id, response }, response.wasm ? [response.wasm.buffer] : []);
	} catch (error) {
		self.postMessage({ id, error: error.message });
	}
};

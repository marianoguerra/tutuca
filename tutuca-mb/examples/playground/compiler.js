import { compileRun, loadPayload } from "./compile.js";

// A safety net: a compile that overflows the worker's stack (in Chrome under half the page's)
// runs again here, on the page, with a moonc of its own: the page waits for it, but it links.
// The vendored moonc appends lists in a loop (scripts/vendor-moonc.mjs), so every example
// compiles in the worker, and the browser check fails if one falls back; a user's program far
// larger than the thing tracker still could.
// The payload and the compiler are rebuilt in place (scripts/playground-payload.mjs), so
// they're fetched revalidated: a stale cached .mi would misread the fresh source.
const REVALIDATE = { cache: "no-cache" };
const OVERFLOW = /Stack_overflow/;
let pageMoonc = null;
const pagePayloads = new Map();
const compileOnPage = async ({ compilerUrl, payloadUrl }, { files, books, backend }) => {
	const t0 = performance.now();
	pageMoonc ??= fetch(compilerUrl, REVALIDATE).then((r) => r.text());
	const source = await pageMoonc;
	if (!pagePayloads.has(backend)) {
		const base = new URL(`${backend}/`, payloadUrl);
		const read = async (path) => new Uint8Array(await (await fetch(new URL(path, base), REVALIDATE)).arrayBuffer());
		const manifest = await (await fetch(new URL("manifest.json", base), REVALIDATE)).json();
		pagePayloads.set(backend, loadPayload(manifest, read));
	}
	const payload = await pagePayloads.get(backend);
	// A fresh instance each time, as the worker would after a wasm-gc compile; its CommonJS
	// names are its own, and it prints what it reports, so the console is quiet meanwhile.
	const module = { exports: {} };
	const require = (name) => {
		if (name === "constants") return {};
		throw new Error(`moonc: unexpected require(${name})`);
	};
	const quiet = { log: console.log, error: console.error };
	console.log = console.error = () => {};
	try {
		new Function("module", "exports", "require", source)(module, module.exports, require);
		const result = compileRun(module.exports, payload, files, { books });
		return { ...result, seen: undefined, ms: Math.round(performance.now() - t0), onPage: true };
	} finally {
		Object.assign(console, quiet);
	}
};

// The page's side of the compiler worker: compile(packages, { books, backend }) → { ok,
// diagnostics, js | wasm, ms }, `packages` as compile.js's compileRun takes them (or one
// package's [[name, code]]). Requests are queued, so a run waits for the one before it, whichever playground on
// the page asked.
export const workerCompiler = ({ workerUrl, compilerUrl, payloadUrl }) => {
	const worker = new Worker(workerUrl, { type: "module" });
	let seq = 0;
	const pending = new Map();
	worker.onmessage = (e) => {
		const { id, ok, value, error } = e.data;
		const p = pending.get(id);
		pending.delete(id);
		if (ok) p.resolve(value);
		else p.reject(new Error(error));
	};
	const call = (kind, args) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, kind, args });
		});
	let ready = null;
	const init = () => {
		ready ??= call("init", { compiler: String(compilerUrl), payload: String(payloadUrl) }).catch(
			(error) => {
				ready = null;
				throw error;
			},
		);
		return ready;
	};
	let last = Promise.resolve();
	return {
		init,
		compile(packages, { books, backend = "js" } = {}) {
			const args = { files: packages, books, backend };
			const next = last
				.then(init)
				.then(() => call("compile", args))
				.catch((error) => {
					if (backend !== "wasm-gc" || !OVERFLOW.test(String(error))) throw error;
					return compileOnPage({ compilerUrl, payloadUrl }, args);
				});
			last = next.catch(() => {});
			return next;
		},
	};
};

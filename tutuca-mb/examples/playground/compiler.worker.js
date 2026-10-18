// The compiler worker (a module worker): moonc-web.cjs, @moonbit/moonc-worker's in-browser
// moonc, compiles a run's files against the payload and links them (compile.js). The page
// talks to it through compiler.js.
//
// moonc-web.cjs is CommonJS built for node and the browser: it touches node:fs only when it
// finds node, so a worker gives it the CommonJS names it expects and evaluates its source in
// the global scope (importScripts would hide its errors behind an opaque NetworkError).
import { compileRun, loadPayload } from "./compile.js";

self.process = { versions: {}, platform: "browser", cwd: () => "/", exit: () => {}, env: {} };
self.require = (name) => {
	if (name === "constants") return {};
	throw new Error(`moonc worker: unexpected require(${name})`);
};

// moonc also prints what it reports, through the console it finds when it loads; the result
// carries the same text, so the console stays quiet while it compiles.
let muted = false;
for (const name of ["log", "error"]) {
	const write = console[name].bind(console);
	console[name] = (...args) => {
		if (!muted) write(...args);
	};
}

// The payload and the compiler are rebuilt in place (scripts/playground-payload.mjs), so
// they're fetched revalidated: a stale cached .mi would misread the fresh source.
const REVALIDATE = { cache: "no-cache" };
let source = null;
let moonc = null;
// A failed compile leaves moonc unusable (its aborts call the stubbed process.exit and it
// keeps the old diagnostics), and so does a wasm-gc one (compile.js), so the next compile
// starts from a fresh instance.
let dirty = false;
let seen = []; // The diagnostics the instance has reported so far.

const loadCompiler = async (url) => {
	source ??= await (await fetch(url, REVALIDATE)).text();
	self.module = { exports: {} };
	self.exports = self.module.exports;
	(0, eval)(source);
	moonc = self.module.exports;
	dirty = false;
	seen = [];
};

let compilerUrl = null;
let payloadBase = null;
const payloads = new Map(); // backend → its payload, loading or loaded

// The payload a backend's runs compile against, fetched on its first run.
const payloadFor = (backend) => {
	if (!payloads.has(backend)) {
		const base = new URL(`${backend}/`, payloadBase);
		const read = async (path) => new Uint8Array(await (await fetch(new URL(path, base), REVALIDATE)).arrayBuffer());
		const loading = fetch(new URL("manifest.json", base), REVALIDATE)
			.then((r) => r.json())
			.then((manifest) => loadPayload(manifest, read));
		payloads.set(backend, loading);
		loading.catch(() => payloads.delete(backend));
	}
	return payloads.get(backend);
};

const init = async ({ compiler, payload: base, backend = "js" }) => {
	compilerUrl ??= compiler;
	payloadBase ??= base;
	const [loaded] = await Promise.all([payloadFor(backend), moonc ?? loadCompiler(compiler)]);
	return { cores: loaded.cores.length };
};

const compile = async ({ files, books, backend = "js" }) => {
	const t0 = performance.now();
	const payload = await payloadFor(backend);
	if (dirty) await loadCompiler(compilerUrl);
	muted = true;
	let result;
	try {
		result = compileRun(moonc, payload, files, { seen, books });
	} finally {
		muted = false;
	}
	seen = result.seen;
	if (!result.reusable) dirty = true;
	return { ...result, seen: undefined, ms: Math.round(performance.now() - t0) };
};

self.onmessage = async (e) => {
	const { id, kind, args } = e.data;
	try {
		const value = kind === "init" ? await init(args) : await compile(args);
		self.postMessage({ id, ok: true, value });
	} catch (error) {
		dirty = true;
		self.postMessage({ id, ok: false, error: String(error?.stack ?? error) });
	}
};

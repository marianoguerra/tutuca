// Compiling a run: the user's files, as one package, against a backend's payload
// (scripts/playground-payload.mjs, payload/<target>/), then linked with the payload's cores
// into one module: JS text on js, wasm bytes on wasm-gc. Shared by the browser's compiler
// worker (compiler.worker.js) and the node smoke script, so both compile exactly the same
// way. `moonc` is @moonbit/moonc-worker's exports.

// The backends a run compiles to.
export const BACKENDS = ["js", "wasm-gc"];

// The file a run adds to the user's package: its `main` hands the books to the prebuilt run
// host (@run: examples/playground/run, or run_wasm on wasm-gc). Its own file, so diagnostics
// in the user's files keep their line numbers. `books` is the expression giving the books:
// `books()` unless the example says otherwise. On wasm-gc the module also exports what the
// page calls: `on_call`, through which the loader's callbacks reach the wasm shell, and
// `playground_story`, the story the run shows. moonc exports every function of an exported
// name, methods too (the thing tracker has a `MeasurementWizard::current`), so the names are
// ones a run won't use.
export const BOOT_FILE = "_boot.mbt";
export const bootFile = (books = "books()", target = "js") =>
	target === "wasm-gc"
		? `fn main {
  @run.start(${books})
}

pub fn on_call(id : Int, status : Int, arg : @wasm.JsNode, text : String) -> Unit {
  @wasm.on_call(id, status, arg, text)
}

pub fn playground_story() -> String {
  @run.current()
}
`
		: `fn main {
  @run.start(${books})
}
`;

// What a wasm-gc run exports (bootFile).
export const WASM_EXPORTS = ["on_call", "playground_story"];

// Loads the payload `manifest` names, reading each file with `read(path) → Uint8Array`. A
// direct import is named "path:alias" when its alias isn't its last path segment.
export const loadPayload = async (manifest, read) => {
	const load = (paths) =>
		Promise.all(paths.map(async (path) => [path, await read(path.split(":")[0])]));
	const [std, direct, lib, cores] = await Promise.all([
		load(manifest.std),
		load(manifest.direct),
		load(manifest.lib),
		Promise.all(manifest.cores.map(read)),
	]);
	return { manifest, std, direct, lib, cores };
};

// The user's packages of a run: one ("playground/user") for a site example's files, or a
// library's, in dependency order. A package is { name, files: [[key, code]], uses?: { alias:
// package name }, std?: { alias: core-library package } }: `key` names a file in the editor
// and in the diagnostics, its last segment is the file's name in its package; `uses` gives the
// aliases it imports the packages before it by, and `std` core-library packages it aliases
// otherwise than by their last segment (`@fm` for moonbitlang/core/math).
export const USER_PKG = "playground/user";
export const asPackages = (filesOrPackages) =>
	filesOrPackages.length > 0 && Array.isArray(filesOrPackages[0])
		? [{ name: USER_PKG, files: filesOrPackages }]
		: filesOrPackages;

const baseName = (key) => key.split("/").pop();

// The warnings every tutuca-mb moon.pkg turns off (`warnings = "-79"`), which buildPackage
// has no option for: E0079, a derived impl's methods promoted, which moonc reports for a
// package that isn't the main one.
const SILENCED = /\[E0079\]/;

// Compiles a run's packages, each on its own against the payload and the interfaces of the
// packages before it, as moon does, then links their cores after the payload's: { ok,
// reusable, diagnostics, js? | wasm? }. The last package is the main one: the boot file joins
// it. `seen` is what the instance reported before (the last call's `seen`). Diagnostics name
// a file by its key (`./jsonschema/views.mbt:3:1-3:4 …`), so each maps
// back to its package's file. A failed compile stops there, and leaves this moonc instance
// unusable (it accumulates diagnostics and can't recover from its own aborts); so does a
// wasm-gc one (a later link on it carries state over and writes a different module than a
// fresh instance does): callers start a fresh one unless `reusable`.
export const compileRun = (moonc, payload, filesOrPackages, { seen = [], books } = {}) => {
	const { manifest } = payload;
	const packages = asPackages(filesOrPackages);
	const target = manifest.target;
	const wasm = target === "wasm-gc";
	const built = []; // { name, mi, core }
	const diagnostics = [];
	// A moonc instance keeps every diagnostic it has reported, once per text, sorted by file and
	// position, so a call's own are the ones not seen before: `seen` comes back with them.
	const known = new Set(seen);
	for (const [i, pkg] of packages.entries()) {
		const main = i === packages.length - 1;
		const keyOf = new Map(pkg.files.map(([key]) => [baseName(key), key]));
		const imported = new Set(Object.values(pkg.uses ?? {}));
		const aliasOf = new Map(Object.entries(pkg.uses ?? {}).map(([alias, name]) => [name, alias]));
		const std = Object.entries(pkg.std ?? {}).flatMap(([alias, path]) => {
			const found = payload.std.find(([p]) => p.endsWith(`/${path}/${path.split("/").pop()}.mi`));
			return found ? [[`${found[0]}:${alias}`, found[1]]] : [];
		});
		const result = moonc.buildPackage({
			mbtFiles: [
				...pkg.files.map(([key, code]) => [baseName(key), code]),
				...(main ? [[BOOT_FILE, bootFile(books, target)]] : []),
			],
			miFiles: [
				...payload.direct,
				...std,
				...built.filter((b) => imported.has(b.name)).map((b) => [`${b.name}.mi:${aliasOf.get(b.name)}`, b.mi]),
			],
			indirectImportMiFiles: [
				...payload.lib,
				...built.filter((b) => !imported.has(b.name)).map((b) => [`${b.name}.mi`, b.mi]),
			],
			stdMiFiles: payload.std,
			target,
			pkg: pkg.name,
			pkgSources: [`${pkg.name}:.`],
			isMain: main,
			errorFormat: "human",
			enableValueTracing: false,
			noOpt: false,
		});
		const all = result.diagnostics ?? [];
		for (const d of all) {
			if (known.has(d)) continue;
			known.add(d);
			if (SILENCED.test(d)) continue;
			diagnostics.push(
				String(d).replace(/^\.\/([^\s:/]+)(?=:\d)/, (m, file) =>
					keyOf.has(file) ? `./${keyOf.get(file)}` : m,
				),
			);
		}
		if (!result.core) return { ok: false, reusable: false, diagnostics, seen: [...known] };
		built.push({ name: pkg.name, mi: result.mi, core: result.core });
	}
	const main = packages.at(-1).name;
	const linked = moonc.linkCore({
		coreFiles: [...payload.cores, ...built.map((b) => b.core)],
		main,
		pkgSources: packages.map((p) => `${p.name}:.`),
		target,
		exportedFunctions: wasm ? WASM_EXPORTS : [],
		// The string ABI the loader instantiates with: js-string builtins.
		...(wasm ? { useJsBuiltinString: true, importedStringConstants: "_" } : {}),
		outputFormat: "wasm",
		testMode: false,
		debug: false,
		noOpt: false,
		sourceMap: false,
		sources: {},
		stopOnMain: false,
	});
	const out = wasm ? { wasm: linked.result } : { js: new TextDecoder().decode(linked.result) };
	return { ok: true, reusable: !wasm, diagnostics, seen: [...known], ...out };
};

// The playground: edit a book's MoonBit files and run its stories with the storybook's panels.
// The left pane edits the example's files in CodeMirror; Run compiles them in the browser as
// one package against the prebuilt tutuca-mb packages (compile.js, in a worker) and runs the
// linked module, whose `main` starts the storybook UI on the right pane: imported as JS on js
// (examples/playground/run), instantiated with wasm/loader.mjs on wasm-gc (run_wasm). Compile errors are underlined in the editor and listed in the
// right pane; a run that fails (a component with issues, a crash) shows its error there.
//
// Each run's previews are keyed `p<playground>r<run>/<story>`, so a run never answers another's
// <tutuca-app>, and a new run shows the story the last one showed when it still has it. A page
// can mount many playgrounds (element.js embeds them): they share one compiler, which compiles
// one run at a time, and each has its own run root, keys and <style> for its storybook's CSS.
import { instantiate } from "../../wasm/loader.mjs";
import { BACKENDS } from "./compile.js";
import { groupDiagnostics } from "./diagnostics.js";
import { compiles, fileKey, packagesOf } from "./library.js";

const LAYOUT = `
.pg { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); height: 100%;
	border: 1px solid var(--color-base-300); border-radius: var(--radius-box, 0.5rem);
	overflow: hidden; background: var(--color-base-100); color: var(--color-base-content); }
.pg-editor { display: flex; flex-direction: column; min-height: 0; min-width: 0;
	border-right: 1px solid var(--color-base-300); }
.pg-top { display: flex; align-items: center; gap: 6px; padding: 6px;
	background: var(--color-base-200); }
.pg-files { display: flex; gap: 2px; overflow-x: auto; padding: 0 4px;
	background: var(--color-base-200); border-bottom: 1px solid var(--color-base-300); }
.pg-files button { font: 12px ui-monospace, monospace; padding: 4px 8px; border: 0;
	border-radius: 4px 4px 0 0; background: transparent; color: inherit; opacity: 0.7;
	white-space: nowrap; cursor: pointer; }
.pg-files button[aria-selected="true"] { background: var(--color-base-100); opacity: 1; }
.pg-files button[data-errors] { color: var(--color-error); }
.pg-files button[data-off] { text-decoration: line-through; opacity: 0.4; }
.pg-code { flex: 1; min-height: 0; overflow: hidden; }
.pg-bar { display: flex; align-items: center; gap: 6px; padding: 6px;
	border-top: 1px solid var(--color-base-300); background: var(--color-base-200); }
.pg-bar .pg-hint { margin-left: auto; font-size: 12px; opacity: 0.6; }
.pg-status { font-size: 12px; opacity: 0.75; }
.pg-panel { min-height: 0; min-width: 0; overflow: auto; }
.pg-panel [role="alert"] { margin: 12px; white-space: pre-wrap; font: 12px ui-monospace, monospace; }
@media (max-width: 900px) {
	.pg { grid-template-columns: minmax(0, 1fr); grid-template-rows: 32rem auto; height: auto; }
	.pg-editor { border-right: 0; border-bottom: 1px solid var(--color-base-300); }
}
`;

export const playgroundClasses = [
	"select",
	"select-sm",
	"btn",
	"btn-sm",
	"btn-primary",
	"alert",
	"alert-error",
	"loading",
	"loading-spinner",
	"loading-sm",
];

const errorText = (error) => String(error?.message ?? error);

let playgrounds = 0;
// A run reads its config from globalThis.__tutucaPlayground as its module evaluates, so the
// page imports one run at a time.
let importing = Promise.resolve();
const importAlone = (f) => {
	const next = importing.then(f);
	importing = next.catch(() => {});
	return next;
};

// The default way to import a js run: as a blob module, whose bare imports ("margaui")
// resolve with the page's import map.
const importBlob = async (js) => {
	const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
	try {
		await import(url);
	} finally {
		URL.revokeObjectURL(url);
	}
};

// The way to start a wasm-gc run: instantiate it with wasm/loader.mjs's `tdom` and the
// `playground` imports, which answer it the run's config (run_wasm). Its `_start` runs `main`,
// which starts the storybook; `config.current` then asks it the story it shows.
const startWasm = async (bytes, config, doc) => {
	const playground = {
		root: () => config.root,
		prefix: () => config.prefix,
		style_id: () => config.styleId,
		wanted_lines: () => config.wanted.join("\n"),
		fail: (message) => {
			throw new Error(message);
		},
	};
	const instance = await instantiate(bytes, { document: doc, extra: { playground } });
	config.current = () => instance.exports.playground_story();
	instance.exports._start();
};

// Mounts the playground in `el`. `compiler.compile(packages, { books, backend })` compiles
// and links; `createEditor` is editor.js's (or anything with its methods); `examples` are
// examples.js's, with files relative to `base`; `backend` is what a run compiles to ("js"
// or "wasm-gc"), which the page's select changes. A js run is imported with `importRun(js,
// run)`, a wasm-gc one started with `startRun(bytes, config, document)`. Returns the
// playground's handle; nothing loads until its `load`.
export const mountPlayground = (
	el,
	{
		compiler,
		createEditor,
		examples = [],
		base = el.ownerDocument.baseURI,
		fetch = globalThis.fetch,
		importRun = importBlob,
		startRun = startWasm,
		backend = "js",
		onChange = () => {},
	},
) => {
	const doc = el.ownerDocument;
	const id = ++playgrounds;
	const styleId = `tutuca-playground-${id}`;
	if (doc.getElementById(styleId) === null) {
		const style = doc.createElement("style");
		style.id = styleId;
		doc.head.append(style);
	}
	el.innerHTML = `<style>${LAYOUT}</style>
<div class="pg">
	<div class="pg-editor">
		<div class="pg-top">
			<select class="select select-sm" aria-label="Example"></select>
			<select class="select select-sm" aria-label="Backend" title="What a run compiles to"></select>
			<span class="pg-status" aria-live="polite"></span>
		</div>
		<div class="pg-files" role="tablist" aria-label="Files"></div>
		<div class="pg-code"></div>
		<div class="pg-bar">
			<button type="button" class="btn btn-sm btn-primary" data-run>Run ▶︎</button>
			<button type="button" class="btn btn-sm" data-reset title="Undo every edit">Reset</button>
			<span class="pg-hint">Ctrl+Enter runs</span>
		</div>
	</div>
	<div class="pg-panel"><div role="alert" class="alert alert-error" hidden></div><div data-runs></div></div>
</div>`;
	const $ = (selector) => el.querySelector(selector);
	const select = $('[aria-label="Example"]');
	const status = $(".pg-status");
	const tabs = $(".pg-files");
	const alert = $('[role="alert"]');
	const runs = $("[data-runs]");

	const state = {
		example: "",
		files: [], // { name, url, code }: the files as loaded.
		errors: new Map(), // name → how many errors
		run: 0,
		backend: BACKENDS.includes(backend) ? backend : "js",
		compiles: () => true, // Whether a file compiles for the backend.
		status: "loading",
		error: "",
		wanted: "",
	};
	const setStatus = (next, text = "") => {
		state.status = next;
		el.setAttribute("data-status", next);
		status.textContent = text;
	};

	const editor = createEditor({
		parent: $(".pg-code"),
		onRun: () => void playground.run(),
		onChange: () => renderTabs(),
	});

	const renderTabs = () => {
		tabs.replaceChildren(
			...state.files.map((file) => {
				const tab = doc.createElement("button");
				tab.type = "button";
				tab.setAttribute("role", "tab");
				const edited = editor.value(file.name) !== file.code;
				const errors = state.errors.get(file.name) ?? 0;
				tab.textContent = `${file.name}${edited ? " •" : ""}${errors > 0 ? ` (${errors})` : ""}`;
				if (errors > 0) tab.setAttribute("data-errors", String(errors));
				tab.title = file.url;
				if (!state.compiles(file.name)) {
					tab.setAttribute("data-off", "");
					tab.title = `${file.url} (not compiled for ${state.backend})`;
				}
				tab.setAttribute("aria-selected", String(file.name === editor.current()));
				tab.addEventListener("click", () => {
					editor.open(file.name);
					renderTabs();
				});
				return tab;
			}),
		);
	};

	const fail = (text) => {
		state.error = text;
		alert.textContent = text;
		alert.hidden = false;
		runs.hidden = true;
		setStatus("failed", "");
	};

	select.replaceChildren(
		...examples.map((e) => {
			const option = doc.createElement("option");
			option.value = e.id;
			option.textContent = e.title;
			return option;
		}),
	);
	select.hidden = examples.length < 2;
	const backendSelect = $('[aria-label="Backend"]');
	backendSelect.replaceChildren(
		...BACKENDS.map((b) => {
			const option = doc.createElement("option");
			option.value = b;
			option.textContent = b;
			return option;
		}),
	);
	backendSelect.value = state.backend;
	backendSelect.addEventListener("change", () => {
		void playground.setBackend(backendSelect.value);
		onChange({ example: state.example, backend: backendSelect.value });
	});
	select.addEventListener("change", () => {
		void playground.load(select.value);
		onChange({ example: select.value });
	});
	$("[data-run]").addEventListener("click", () => void playground.run());
	$("[data-reset]").addEventListener("click", () => void playground.reset());

	let config = {}; // The current run's, which it leaves `current()` on.
	const prefixOf = (run) => `p${id}r${run}/`;

	// A preview reports its state with its key: the story the run shows, as it changes.
	let shown = "";
	runs.addEventListener("tutucareport", (e) => {
		const prefix = prefixOf(state.run);
		const key = String(e.detail?.key ?? "");
		if (!key.startsWith(prefix)) return;
		const story = key.slice(prefix.length).replace(/@\d+$/, "");
		if (story !== shown) {
			shown = story;
			onChange({ example: state.example, story });
		}
	});

	const playground = {
		state,
		editor,
		// Loads example `id`'s files and runs them (unless `run` is false), showing `story`
		// when it has it.
		async load(id, { story = "", run = true } = {}) {
			const example = examples.find((e) => e.id === id) ?? examples[0];
			if (example === undefined) return;
			state.example = example.id;
			state.books = example.boot;
			state.wanted = story;
			select.value = example.id;
			setStatus("loading", "Loading…");
			try {
				const loaded = await Promise.all(
					example.files.map(async (path) => {
						const url = new URL(path, base).href;
						const response = await fetch(url);
						if (!response.ok) throw new Error(`can't load ${url}: ${response.status}`);
						return { path, url, name: fileKey(example, path), code: await response.text() };
					}),
				);
				// A library's tabs: its stories first, then its components, then what they use.
				const order = example.packages === undefined ? loaded : [...example.packages]
					.reverse()
					.flatMap((p) => p.files.map((path) => loaded.find((f) => f.path === path)));
				state.files = order.map(({ name, url, code }) => ({ name, url, code }));
				state.definition = example;
				state.compiles = compiles(example, state.backend);
			} catch (error) {
				fail(errorText(error));
				return;
			}
			return playground.reset({ run });
		},
		// Back to the files as loaded, then runs them (unless `run` is false).
		reset({ run = true } = {}) {
			editor.load(state.files.map((f) => [f.name, f.code]));
			state.errors = new Map();
			renderTabs();
			if (run) return playground.run();
			setStatus("idle", "Ctrl+Enter or Run to run it");
		},
		// Compiles the files as edited and runs them.
		async run() {
			if (state.files.length === 0) return;
			const files = state.files
				.filter((f) => state.compiles(f.name))
				.map((f) => [f.name, editor.value(f.name)]);
			// A library compiles package by package; a site example is one package.
			const example = state.definition;
			const code = new Map(files);
			const packages =
				example.packages === undefined
					? files
					: packagesOf(example, (path) => code.get(fileKey(example, path))).map((p) => ({
							...p,
							files: p.files.filter(([key]) => code.has(key)),
						}));
			setStatus("compiling", "Compiling…");
			let result;
			try {
				result = await compiler.compile(packages, { books: state.books, backend: state.backend });
			} catch (error) {
				fail(`The compiler failed: ${errorText(error)}`);
				return;
			}
			const { byFile, other } = groupDiagnostics(
				result.diagnostics,
				files.map(([name]) => name),
			);
			state.errors = new Map();
			editor.clearDiagnostics();
			for (const [name, list] of byFile) {
				editor.setDiagnostics(name, list);
				const errors = list.filter((d) => d.severity === "error").length;
				if (errors > 0) state.errors.set(name, errors);
			}
			if (!result.ok) {
				const first = [...state.errors.keys()][0];
				if (first !== undefined && first !== editor.current()) editor.open(first);
				renderTabs();
				const count = [...state.errors.values()].reduce((a, b) => a + b, 0) + other.length;
				fail(
					[
						`It doesn't compile: ${count} error${count === 1 ? "" : "s"}.`,
						...(result.diagnostics ?? []).map((d) => String(d).trim()),
					].join("\n\n"),
				);
				return;
			}
			renderTabs();
			const previous = config.current?.() ?? "";
			state.run += 1;
			// The old run's root goes first, so its previews let go of their apps.
			const root = doc.createElement("div");
			runs.replaceChildren(root);
			config = { root, prefix: prefixOf(state.run), wanted: [state.wanted, previous], styleId };
			state.wanted = "";
			try {
				await importAlone(() => {
					globalThis.__tutucaPlayground = config;
					return result.wasm !== undefined
						? startRun(result.wasm, config, doc)
						: importRun(result.js, `${id}-${state.run}`);
				});
			} catch (error) {
				runs.replaceChildren();
				fail(`The run failed: ${errorText(error)}`);
				return;
			}
			alert.hidden = true;
			runs.hidden = false;
			state.error = "";
			const where = result.onPage ? " on the page" : "";
			setStatus("ready", `Run ${state.run} · ${state.backend} · compiled${where} in ${result.ms ?? "?"} ms`);
		},
		// Compiles to `backend` from now on, running again if a run was shown.
		setBackend(next) {
			if (!BACKENDS.includes(next) || next === state.backend) return;
			state.backend = next;
			backendSelect.value = next;
			if (state.definition !== undefined) state.compiles = compiles(state.definition, next);
			renderTabs();
			if (state.run > 0 || state.status === "failed") return playground.run();
		},
		// The story the current run shows.
		story: () => config.current?.() ?? "",
		prefix: () => prefixOf(state.run),
	};
	setStatus("loading", "");
	return playground;
};

// The playground: a component's pure-tutuca module in an editor, checked and compiled to
// WebAssembly in the browser by pure-js, and run by tutuca-wasm: its root mounted beside it,
// with its state, what the runtime reported, its model and the WebAssembly it became.

import { createRuntime } from "../dist/tutuca-wasm.js";
import { el, jsonTree, moduleSources, pageStyles, placeOf } from "../js/page.js";
import { COMPILER, componentPath, MARGAUI, RUNTIME, SOURCES } from "../js/paths.js";
import { createEditor } from "./deps/editor.js";
import { EXAMPLES } from "./examples.js";

const UI = {
	body: "bg-base-200 text-base-content min-h-screen",
	app: "max-w-[1600px] mx-auto p-3 flex flex-col gap-3",
	header: "flex flex-wrap items-center gap-3",
	title: "text-xl font-bold",
	lead: "text-sm opacity-70 max-w-prose",
	link: "link link-primary text-sm",
	toolbar: "pg-toolbar flex flex-wrap items-center gap-2",
	select: "select select-sm w-64",
	button: "btn btn-sm",
	primary: "btn btn-sm btn-primary",
	status: "pg-status text-sm opacity-70",
	columns: "grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
	panel: "card card-border bg-base-100 p-2 gap-2 min-w-0",
	tabs: "pg-tabs flex flex-wrap gap-1",
	tab: "pg-tab-button btn btn-xs btn-ghost font-mono",
	tabOn: "pg-tab-button btn btn-xs btn-active font-mono",
	editor: "pg-editor h-[62vh] border border-base-300 rounded-box overflow-hidden",
	diags: "pg-diagnostics font-mono text-xs max-h-48 overflow-auto flex flex-col",
	diag: "pg-diagnostic text-left px-2 py-1 border-b border-base-300 hover:bg-base-200 cursor-pointer",
	error: "text-error font-semibold",
	hint: "opacity-60",
	label: "text-xs uppercase tracking-wide opacity-60",
	row: "flex flex-wrap items-center gap-2",
	fields: "pg-fields textarea textarea-sm font-mono text-xs w-full h-24",
	stage: "pg-stage rounded-box border border-dashed border-base-300 p-3 min-h-24 overflow-auto",
	state:
		"pg-state bg-base-200 rounded-box p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-auto",
	events: "pg-events font-mono text-xs max-h-48 overflow-auto flex flex-col",
	event: "py-0.5 border-b border-base-300",
	issue: "pg-issue text-warning",
	failed: "pg-failed text-error",
	info: "pg-info opacity-70",
};

const styles = await pageStyles(MARGAUI, Object.values(UI));
document.body.className = UI.body;

// ---- The page -------------------------------------------------------------------------------

const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const select = el("select", { class: UI.select, "aria-label": "Example" });
for (const ex of EXAMPLES) select.append(el("option", { value: ex.id }, ex.title));
const compileButton = el("button", { class: UI.primary, title: "Ctrl/Cmd-Enter" }, "Compile");
const resetButton = el(
	"button",
	{ class: UI.button, title: "Back to the example as shipped" },
	"Reset",
);
const status = el("span", { class: UI.status });
const description = el("p", { class: UI.lead });
app.append(
	el(
		"header",
		{ class: UI.header },
		el("h1", { class: UI.title }, "tutuca-wasm playground"),
		el(
			"a",
			{
				class: UI.link,
				href: "https://github.com/marianoguerra/tutuca/tree/main/spec/pure-tutuca",
			},
			"pure-tutuca",
		),
	),
	el(
		"p",
		{ class: UI.lead },
		"A component is a pure-tutuca module (.tutuca.ts): its state, its messages with their guards and contracts and what each does, its views. It is checked and compiled to WebAssembly here, in your browser, by pure-js, and run by tutuca's runtime in WebAssembly, which checks the contracts as you click.",
	),
	el("div", { class: UI.toolbar }, select, compileButton, resetButton, status),
	description,
);
const tabs = el("div", { class: UI.tabs });
const editorBox = el("div", { class: UI.editor });
const diagList = el("div", { class: UI.diags });
const rootSelect = el("select", { class: UI.select, "aria-label": "Root type" });
const fieldsBox = el("textarea", {
	class: UI.fields,
	spellcheck: "false",
	"aria-label": "Root fields (JSON)",
});
const remountButton = el("button", { class: UI.button }, "Remount");
let stage = el("div", { class: UI.stage });
const stageBox = el("div", {}, stage);
const statePanel = el("pre", { class: UI.state });
const events = el("div", { class: UI.events });
app.append(
	el(
		"div",
		{ class: UI.columns },
		el(
			"section",
			{ class: UI.panel },
			tabs,
			editorBox,
			el("p", { class: UI.label }, "diagnostics"),
			diagList,
		),
		el(
			"section",
			{ class: UI.panel },
			el("p", { class: UI.label }, "instance"),
			el("div", { class: UI.row }, rootSelect, remountButton),
			fieldsBox,
			stageBox,
			el("p", { class: UI.label }, "state"),
			statePanel,
			el("p", { class: UI.label }, "events"),
			events,
		),
	),
);

const editor = createEditor(editorBox, {
	onRun: () => compile(),
	onChange: () => saveEdits(),
});

// ---- Examples and their files ---------------------------------------------------------------

let example = null;
let tutuca = null; // The runtime the example runs on: a new one for each compile.
let shownReports = 0;

const storageKey = (id) => `tutuca-wasm-playground:${id}`;
const loadEdits = (id) => {
	try {
		return JSON.parse(localStorage.getItem(storageKey(id)) ?? "null");
	} catch {
		return null;
	}
};
const saveEdits = () => {
	if (example === null || !editor.has(example.main)) return;
	try {
		localStorage.setItem(
			storageKey(example.id),
			JSON.stringify({ source: editor.text(example.main), fields: fieldsBox.value }),
		);
	} catch {}
};

// The modules an example reads: its own, and the files under SOURCES.
let sources = moduleSources(SOURCES);

function renderTabs() {
	tabs.textContent = "";
	for (const name of editor.names()) {
		const on = editor.current() === name;
		tabs.append(
			el(
				"button",
				{
					class: on ? UI.tabOn : UI.tab,
					onclick: () => {
						editor.show(name);
						renderTabs();
					},
				},
				name.split("/").at(-1),
			),
		);
	}
}

async function openExample(id, { fresh = false } = {}) {
	example = EXAMPLES.find((ex) => ex.id === id) ?? EXAMPLES[0];
	sources = moduleSources(SOURCES, example.sources ?? {});
	select.value = example.id;
	description.textContent = example.description;
	const saved = fresh ? null : loadEdits(example.id);
	for (const name of editor.names()) editor.remove(name);
	editor.open(example.main, saved?.source ?? (await sources.read(example.main)), {
		lang: "ts",
	});
	for (const used of example.uses ?? []) {
		editor.open(used, await sources.read(used), { lang: "ts", readOnly: true });
	}
	editor.show(example.main);
	fieldsBox.value = saved?.fields ?? JSON.stringify(example.fields ?? {}, null, 2);
	renderTabs();
	await compile();
}

// ---- Compiling and mounting -----------------------------------------------------------------

// A diagnostic of either checker, as the editor and the list take one.
const diagnosticOf = (d, source) => {
	const start = d.span?.start ?? d.start ?? 0;
	const from = placeOf(source, start);
	const to = placeOf(source, d.span?.end ?? d.end ?? start);
	return {
		code: d.code,
		message: d.help ? `${d.message} (${d.help})` : d.message,
		severity: "error",
		line: from.line,
		col: from.col,
		endLine: to.line,
		endCol: to.col,
	};
};

// Shows a place of the module being edited.
const showPlace = (line, col) => () => {
	editor.show(example.main);
	editor.goto(example.main, line, col);
	renderTabs();
};

function renderDiagnostics(diags) {
	diagList.textContent = "";
	for (const d of diags) {
		diagList.append(
			el(
				"button",
				{
					class: UI.diag,
					onclick: showPlace(d.line, d.col),
				},
				el("span", { class: UI.error }, d.code ?? "error"),
				` ${d.message} `,
				el("span", { class: UI.hint }, `line ${d.line}, column ${d.col}`),
			),
		);
	}
	if (diags.length === 0) {
		diagList.append(el("span", { class: UI.info }, "nothing to report"));
	}
	editor.setDiagnostics({ [example.main]: diags });
}

const withJson = (v) => {
	if (Array.isArray(v)) return v.map(withJson);
	if (v === null || typeof v !== "object") return v;
	if ("$json" in v) return jsonTree(v.$json);
	return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withJson(x)]));
};

// The state, what was reported since the last time, and the CSS for what is on the page now.
function showState() {
	if (tutuca === null) return;
	statePanel.textContent = JSON.stringify(tutuca.state(), null, 2);
	const reports = tutuca.reports();
	for (const r of reports.slice(shownReports)) {
		if (r.type === "settled" && r.issues.length === 0) continue;
		const issues = (r.issues ?? []).map((i) =>
			i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason,
		);
		const what =
			r.type === "transition"
				? `${r.name}(${JSON.stringify(r.args).slice(1, -1)}) ${r.outcome}`
				: r.type;
		const failed = r.outcome === "failed" || r.type === "renderFailed";
		const tone = failed ? UI.failed : issues.length > 0 ? UI.issue : UI.info;
		const logs = (r.logs ?? []).map((l) => `log ${JSON.stringify(l)}`);
		const detail = [r.error, ...issues, ...logs].filter(Boolean);
		const line = detail.length > 0 ? `${what}: ${detail.join(", ")}` : what;
		events.prepend(el("div", { class: `${UI.event} ${tone}` }, line));
	}
	shownReports = reports.length;
}

function mount() {
	const root = rootSelect.value;
	let fields;
	try {
		fields = withJson(JSON.parse(fieldsBox.value || "{}"));
	} catch (e) {
		status.textContent = `the fields aren't JSON: ${e.message}`;
		return;
	}
	try {
		tutuca.start(root, fields);
		tutuca.mount();
	} catch (e) {
		status.textContent = `${root} can't be made: ${e.message}`;
		return;
	}
	showState();
}

async function compile() {
	if (example === null) return;
	const started = performance.now();
	status.textContent = "compiling…";
	// A new runtime and a new node for each compile: nothing of the last one is left.
	stage = el("div", { class: UI.stage });
	stageBox.replaceChildren(stage);
	events.textContent = "";
	statePanel.textContent = "";
	shownReports = 0;
	tutuca = await createRuntime({
		document,
		rootNode: stage,
		asks: example.asks ?? {},
		runtime: RUNTIME,
		compiler: COMPILER,
	});
	styles.watch(stage);
	// What happens later (a click, an answer) shows as it happens.
	new MutationObserver(showState).observe(stage, {
		childList: true,
		subtree: true,
		attributes: true,
		characterData: true,
	});
	for (const type of ["click", "input", "change", "keydown", "drop"]) {
		stage.addEventListener(type, () => queueMicrotask(showState));
	}
	// The modules it composes with first, as a page would have them.
	for (const dep of example.deps ?? []) {
		const loaded = await sources.load(tutuca, componentPath(dep));
		if (!loaded.ok) {
			status.textContent = `${dep} didn't load: ${loaded.diagnostics[0]?.message ?? ""}`;
			return;
		}
	}
	const loaded = await sources.load(tutuca, example.main, { text: editor.text(example.main) });
	const ms = Math.round(performance.now() - started);
	renderDiagnostics(loaded.diagnostics.map((d) => diagnosticOf(d, loaded.source)));
	for (const name of ["model.json", "module.wat"]) if (editor.has(name)) editor.remove(name);
	if (!loaded.ok) {
		status.textContent = `didn't compile (${ms} ms): see the diagnostics`;
		renderTabs();
		return;
	}
	editor.open("model.json", JSON.stringify(loaded.model, null, 2), {
		lang: "json",
		readOnly: true,
	});
	editor.open("module.wat", loaded.wat, { lang: "wax", readOnly: true });
	editor.show(example.main);
	renderTabs();
	// What can be the root: the names the module's components are made by, and the example's.
	const names = loaded.model.components.map((c) => loaded.model.register?.[c.name] ?? c.name);
	const wanted = [rootSelect.value, example.root].find((n) => n && names.includes(n));
	const root = wanted ?? example.root ?? names[0];
	rootSelect.textContent = "";
	for (const name of new Set([root, ...names])) {
		rootSelect.append(el("option", { value: name }, name));
	}
	rootSelect.value = root;
	status.textContent = `compiled and mounted in ${ms} ms`;
	mount();
}

select.addEventListener("change", () => openExample(select.value));
compileButton.addEventListener("click", () => compile());
remountButton.addEventListener("click", () => compile());
resetButton.addEventListener("click", () => {
	try {
		localStorage.removeItem(storageKey(example.id));
	} catch {}
	return openExample(example.id, { fresh: true });
});

await openExample(new URLSearchParams(location.search).get("example") ?? EXAMPLES[0].id);

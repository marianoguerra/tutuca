// The playground: a component's .tcd and .wax in an editor, compiled in the
// browser by tcd and wax-mb compiled to wasm-gc (compiler.worker.js), and
// the module loaded into a fresh scope next to the prebuilt modules it
// composes with, its root mounted on a dev host in the side panel, with its
// state, what the host reported, and test runs from its model (js/pbt.js).
import { hydrate } from "../js/hydrate.js";
import { compilerClient, el, pageStyles } from "../js/page.js";
import { examples as runExamples, snapshot, walk } from "../js/pbt.js";
import { load, readBytes } from "../js/tutuca-rt.js";
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
	tabGen: "pg-tab-button btn btn-xs btn-ghost font-mono opacity-60",
	tabGenOn: "pg-tab-button btn btn-xs btn-active font-mono opacity-60",
	editor: "pg-editor h-[62vh] border border-base-300 rounded-box overflow-hidden",
	diags: "pg-diagnostics font-mono text-xs max-h-48 overflow-auto flex flex-col",
	diag: "pg-diagnostic text-left px-2 py-1 border-b border-base-300 hover:bg-base-200 cursor-pointer",
	error: "text-error font-semibold",
	warning: "text-warning font-semibold",
	note: "text-info font-semibold",
	hint: "opacity-60",
	label: "text-xs uppercase tracking-wide opacity-60",
	row: "flex flex-wrap items-center gap-2",
	fields: "pg-fields textarea textarea-sm font-mono text-xs w-full h-24",
	stage: "pg-stage rounded-box border border-dashed border-base-300 p-3 min-h-24 overflow-auto",
	state: "pg-state bg-base-200 rounded-box p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-auto",
	events: "pg-events font-mono text-xs max-h-48 overflow-auto flex flex-col",
	event: "py-0.5 border-b border-base-300",
	log: "pg-log text-success",
	issue: "pg-issue text-warning",
	failed: "pg-failed text-error",
	info: "pg-info opacity-70",
};

// ---- Theme and CSS, the runtime and the compiler ------------------------------------

const styles = await pageStyles(Object.values(UI));
document.body.className = UI.body;
const tw = await load(new URL("../dist/tutuca-rt.wasm", import.meta.url));
const { runtime } = tw;
const compiler = compilerClient();

// Prebuilt component modules, by name, fetched once.
const prebuilt = new Map();
const prebuiltBytes = async (name) => {
	if (!prebuilt.has(name)) prebuilt.set(name, await readBytes(new URL(`../dist/components/${name}.wasm`, import.meta.url)));
	return prebuilt.get(name);
};

// ---- The page ------------------------------------------------------------------------

const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const select = el("select", { class: UI.select, "aria-label": "Example" });
for (const ex of EXAMPLES) select.append(el("option", { value: ex.id }, ex.title));
const compileButton = el("button", { class: UI.primary, title: "Ctrl/Cmd-Enter" }, "Compile");
const stubButton = el("button", { class: UI.button, title: "Append the functions the .wax lacks, as tcd stub --missing writes them" }, "Add missing functions");
const testButton = el("button", { class: UI.button, title: "Run the model's examples and random walks (js/pbt.js)" }, "Test");
const resetButton = el("button", { class: UI.button, title: "Back to the example as shipped" }, "Reset");
const status = el("span", { class: UI.status });
const description = el("p", { class: UI.lead });
app.append(
	el(
		"header",
		{ class: UI.header },
		el("h1", { class: UI.title }, "tutuca-wax playground"),
		el("a", { class: UI.link, href: "../demos/" }, "demos"),
		el("a", { class: UI.link, href: "../studio/" }, "studio"),
		el("a", { class: UI.link, href: "https://github.com/marianoguerra/tutuca/tree/main/tutuca-wax/tcd" }, "the TCD language"),
	),
	el(
		"p",
		{ class: UI.lead },
		"A component is a .tcd (its state, its messages with their guards and contracts, its views) and a .wax (what each message does). The compiler is tcd and wax-mb compiled to wasm-gc, running in your browser; the module it builds is loaded and mounted on the right, on a dev host that checks the contracts as you click.",
	),
	el("div", { class: UI.toolbar }, select, compileButton, stubButton, testButton, resetButton, status),
	description,
);
const tabs = el("div", { class: UI.tabs });
const editorBox = el("div", { class: UI.editor });
const diagList = el("div", { class: UI.diags });
const rootSelect = el("select", { class: UI.select, "aria-label": "Root type" });
const fieldsBox = el("textarea", { class: UI.fields, spellcheck: "false", "aria-label": "Root fields (JSON)" });
const remountButton = el("button", { class: UI.button }, "Remount");
const stage = el("div", { class: UI.stage });
const statePanel = el("pre", { class: UI.state });
const events = el("div", { class: UI.events });
app.append(
	el(
		"div",
		{ class: UI.columns },
		el("section", { class: UI.panel }, tabs, editorBox, el("p", { class: UI.label }, "diagnostics"), diagList),
		el(
			"section",
			{ class: UI.panel },
			el("p", { class: UI.label }, "instance"),
			el("div", { class: UI.row }, rootSelect, remountButton),
			fieldsBox,
			stage,
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

// ---- Examples and their files -----------------------------------------------------------

let example = null;
let generated = []; // the names of the generated files' tabs
let lastBuild = null;
let mounted = null; // { scope, host }

const storageKey = (id) => `tutuca-wax-playground:${id}`;
const loadEdits = (id) => {
	try {
		return JSON.parse(localStorage.getItem(storageKey(id)) ?? "null");
	} catch {
		return null;
	}
};
const saveEdits = () => {
	if (!example) return;
	try {
		localStorage.setItem(
			storageKey(example.id),
			JSON.stringify({ tcd: editor.text(example.main), wax: editor.text(example.impl), fields: fieldsBox.value }),
		);
	} catch {}
};
const sourceOf = async (ex, path) => ex.sources?.[path] ?? new TextDecoder().decode(await readBytes(new URL(`../${path}`, import.meta.url)));
const langOf = (name) => (name.endsWith(".tcd") ? "tcd" : name.endsWith(".wax") ? "wax" : "json");
const shortName = (path) => path.split("/").pop();

const renderTabs = () => {
	tabs.textContent = "";
	for (const name of editor.names()) {
		const isGen = generated.includes(name);
		const on = editor.current() === name;
		tabs.append(
			el(
				"button",
				{
					class: isGen ? (on ? UI.tabGenOn : UI.tabGen) : on ? UI.tabOn : UI.tab,
					title: isGen ? `${name} (generated, read only)` : name,
					onclick: () => {
						editor.show(name);
						renderTabs();
					},
				},
				shortName(name),
			),
		);
	}
};

async function openExample(id, { reset = false } = {}) {
	example = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
	select.value = example.id;
	description.textContent = example.description;
	for (const name of editor.names()) editor.remove(name);
	generated = [];
	lastBuild = null;
	const saved = reset ? null : loadEdits(example.id);
	editor.open(example.main, saved?.tcd ?? (await sourceOf(example, example.main)), { lang: "tcd" });
	editor.open(example.impl, saved?.wax ?? (await sourceOf(example, example.impl)), { lang: "wax" });
	for (const used of example.uses ?? []) editor.open(used, await sourceOf(example, used), { lang: "tcd", readOnly: true });
	editor.show(example.main);
	fieldsBox.value = saved?.fields ?? JSON.stringify(example.fields, null, 2);
	rootSelect.textContent = "";
	rootSelect.append(el("option", { value: example.root }, example.root));
	renderTabs();
	renderDiagnostics([]);
	await compile();
}

// The request tcd builds from: the .tcd, the files it uses, the .wax.
const request = () => {
	const files = { [example.main]: editor.text(example.main) };
	for (const used of example.uses ?? []) files[used] = editor.text(used);
	return { main: example.main, files, impls: [{ path: example.impl, text: editor.text(example.impl) }] };
};

// ---- Diagnostics -------------------------------------------------------------------------

function renderDiagnostics(diags) {
	diagList.textContent = "";
	const byFile = {};
	for (const d of diags) {
		const where = d.span.file;
		(byFile[where] ??= []).push({
			line: d.span.start.line,
			col: d.span.start.col,
			endLine: d.span.end.line,
			endCol: d.span.end.col,
			severity: d.severity === "note" ? "info" : d.severity,
			message: d.hint ? `${d.message}\n${d.hint}` : d.message,
		});
		diagList.append(
			el(
				"button",
				{
					class: UI.diag,
					onclick: () => {
						if (editor.has(where)) {
							editor.goto(where, d.span.start.line, d.span.start.col);
							renderTabs();
						}
					},
				},
				el("span", { class: UI[d.severity] ?? UI.note }, `${d.severity} `),
				`${shortName(where)}:${d.span.start.line}:${d.span.start.col} ${d.message}`,
				d.hint ? el("span", { class: UI.hint }, ` (${d.hint})`) : null,
			),
		);
	}
	if (diags.length === 0) diagList.append(el("span", { class: UI.info }, "nothing to report"));
	editor.setDiagnostics(byFile);
}

// ---- Compiling and mounting ----------------------------------------------------------------

async function compile() {
	if (!example) return;
	status.textContent = "compiling…";
	let res;
	try {
		res = await compiler("build", request());
	} catch (error) {
		status.textContent = `the compiler failed: ${error.message}`;
		return;
	}
	lastBuild = res;
	// The generated files, read only, as tcd wrote them.
	const current = editor.current();
	for (const name of generated) if (name !== current) editor.remove(name);
	generated = [];
	for (const [path, text] of [
		[res.contractPath, res.contract],
		[res.gluePath, res.glue],
		[res.abiPath, res.abi],
	]) {
		if (path && text != null) {
			editor.open(path, text, { lang: "wax", readOnly: true });
			generated.push(path);
		}
	}
	if (res.model) {
		const path = example.main.replace(/\.tcd$/, ".model.json");
		editor.open(path, JSON.stringify(res.model, null, 2), { lang: "json", readOnly: true });
		generated.push(path);
	}
	if (current && !editor.has(current)) editor.show(example.main);
	renderTabs();
	renderDiagnostics(res.diags);
	const types = res.types ?? [];
	const chosen = rootSelect.value;
	rootSelect.textContent = "";
	for (const t of [...new Set([example.root, ...types])]) rootSelect.append(el("option", { value: t }, t));
	rootSelect.value = chosen && [...rootSelect.options].some((o) => o.value === chosen) ? chosen : example.root;
	if (!res.ok) {
		status.textContent = `didn't build (${res.ms} ms): see the diagnostics`;
		return;
	}
	status.textContent = `built in ${res.ms} ms: ${res.wasm.length} bytes`;
	await mount();
}

const note = (kind, text) => events.prepend(el("div", { class: `${UI.event} ${UI[kind] ?? ""}` }, `${new Date().toLocaleTimeString()} ${kind}: ${text}`));

// A fresh scope with the prebuilt modules the example composes with, then
// the compiled module; the root mounted on a dev host.
async function mount() {
	if (!lastBuild?.ok) return;
	mounted?.host.unmount();
	mounted = null;
	events.textContent = "";
	statePanel.textContent = "";
	try {
		const scope = runtime.scope();
		for (const dep of example.deps ?? []) styles.add((await tw.loadComponent(await prebuiltBytes(dep), scope)).classes);
		styles.add((await tw.loadComponent(lastBuild.wasm.slice(), scope)).classes);
		const fields = hydrate(runtime, scope, JSON.parse(fieldsBox.value || "{}"));
		const root = runtime.make(scope, rootSelect.value, fields);
		const host = runtime.createHost(document, stage, root, { dev: true, asks: example.asks ?? {} });
		const seen = { logs: 0, unhandled: 0, failures: 0, issues: 0 };
		const run = host.run.bind(host);
		host.run = () => {
			run();
			for (const v of host.logs.slice(seen.logs)) note("log", JSON.stringify(snapshot(runtime, v)));
			for (const n of host.unhandled.slice(seen.unhandled)) note("info", `unhandled ${n}`);
			for (const e of host.failures.slice(seen.failures)) note("failed", e.message);
			for (const i of host.issues.slice(seen.issues)) note("issue", JSON.stringify(i));
			Object.assign(seen, { logs: host.logs.length, unhandled: host.unhandled.length, failures: host.failures.length, issues: host.issues.length });
			statePanel.textContent = JSON.stringify(snapshot(runtime, host.root()), null, 2);
		};
		host.mount();
		mounted = { scope, host };
	} catch (error) {
		stage.replaceChildren();
		note("failed", `can't mount ${rootSelect.value}: ${error.message}`);
		mounted = null;
	}
}

// ---- Testing from the model -----------------------------------------------------------------

async function test() {
	if (!lastBuild?.ok || !mounted) {
		status.textContent = "compile first";
		return;
	}
	const model = lastBuild.model;
	const { scope } = mounted;
	for (const r of runExamples({ runtime, scope, model })) {
		note(r.ok ? "info" : "failed", `example ${r.name}: ${r.ok ? "passed" : r.failures.join("; ")}`);
	}
	for (const comp of model.components) {
		if (comp.messages.length === 0) continue;
		const found = walk({ runtime, scope, model, component: comp.name, runs: 25, steps: 20, seed: Date.now() % 1000 });
		if (found.ok) note("info", `${comp.name}: ${found.runs} random walks found nothing`);
		else {
			const trace = found.trace.map((s) => `${s.name}(${s.args.map((a) => JSON.stringify(snapshot(runtime, a))).join(", ")})`).join(", ");
			note("failed", `${comp.name}: from ${JSON.stringify(snapshot(runtime, found.start))}, ${trace || "making it"}: ${JSON.stringify(found.issues[0] ?? found.failures[0])}`);
		}
	}
}

// ---- Wiring ------------------------------------------------------------------------------------

select.addEventListener("change", () => openExample(select.value));
compileButton.addEventListener("click", () => compile());
remountButton.addEventListener("click", () => mount());
rootSelect.addEventListener("change", () => mount());
fieldsBox.addEventListener("change", () => saveEdits());
testButton.addEventListener("click", () => test());
resetButton.addEventListener("click", () => openExample(example.id, { reset: true }));
stubButton.addEventListener("click", async () => {
	const res = await compiler("stub", request());
	if (!res.ok) {
		renderDiagnostics(res.diags);
		return;
	}
	if (!res.stub.trim()) {
		status.textContent = "nothing missing";
		return;
	}
	const text = editor.text(example.impl).replace(/\n*$/, "\n\n") + res.stub;
	editor.open(example.impl, text, { lang: "wax" });
	editor.show(example.impl);
	renderTabs();
	saveEdits();
	await compile();
});

const initial = new URLSearchParams(location.search).get("example") ?? EXAMPLES[0].id;
await openExample(initial);

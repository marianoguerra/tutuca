// The studio's page: the host of studio.tcd's Studio, which has the screens
// as tabs, the picker a new screen's scope is chosen in, and the menu, and
// which asks the page for what only it can do: keep the library in IndexedDB
// (store.js), make a screen in its scope chain (answered with the screen's
// component, which Studio renders), confirm, move the library in and out.
// A screen is composed by filling a layout's holes with what its scope can
// make; a hole's list also offers a new component, and a slot's ✎ edits the
// one in it: the page turns into the editor, still written here (the code, a
// live preview, what the build says and the assistant), and saving registers
// the component in the screen's scope, where the hole can make it. A screen
// is kept as what to make (js/hydrate.js's capture), saved as it changes.
// Served with an API (scripts/studio-server.mjs), the editor also has an
// assistant (assistant.js): a model that edits the component, its changes
// built and its errors sent back to it.
import { defineRating } from "../components/media/rating.js";
import { capture, hydrate } from "../js/hydrate.js";
import { compilerClient, el, pageStyles } from "../js/page.js";
import { snapshot } from "../js/pbt.js";
import { load, readBytes } from "../js/tutuca-rt.js";
import { createEditor } from "../playground/deps/editor.js";
import { assistantPanel, checkServer, diagnosticText } from "./assistant.js";
import { fromBundle, openStore, toBundle } from "./store.js";

const UI = {
	body: "bg-base-200 text-base-content",
	app: "h-screen flex flex-col",
	spacer: "flex-1",
	status: "st-status text-xs opacity-70 truncate max-w-[40%]",
	main: "flex-1 min-h-0 flex flex-col",
	button: "btn btn-sm",
	primary: "btn btn-sm btn-primary",
	ghost: "btn btn-sm btn-ghost",
	input: "input input-sm",
	select: "select select-sm",
	label: "text-xs uppercase tracking-wide opacity-60",
	row: "flex flex-wrap items-center gap-2",
	info: "opacity-70",
	// The preview's events.
	eventList: "st-events font-mono max-h-40 overflow-auto flex flex-col px-3 pb-2",
	event: "py-0.5 border-b border-base-300",
	log: "text-success",
	issue: "text-warning",
	failed: "st-failed text-error",
	// The layout JSON dialog.
	dialog: "modal",
	dialogBox: "modal-box flex flex-col gap-3",
	dialogTitle: "text-lg font-bold",
	dialogActions: "modal-action mt-0",
	layoutJson: "st-layout textarea textarea-sm font-mono text-xs w-full h-80",
	// The editor.
	editorBar: "st-editor-bar flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-2 py-1",
	work: "st-work flex-1 min-h-0 grid gap-2 p-2 grid-cols-1 lg:grid-cols-2",
	workChat: "st-work flex-1 min-h-0 grid gap-2 p-2 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24rem]",
	pane: "card card-border bg-base-100 min-h-0 min-w-0 flex flex-col gap-2 p-2",
	fileTabs: "flex flex-wrap gap-1",
	fileTab: "btn btn-xs btn-ghost font-mono",
	fileTabOn: "btn btn-xs btn-active font-mono",
	editor: "st-editor flex-1 min-h-0 border border-base-300 rounded-box overflow-hidden",
	preview: "st-preview min-h-40 max-h-[50%] overflow-auto rounded-box border border-dashed border-base-300 p-3",
	inspectorTabs: "tabs tabs-border tabs-sm",
	inspectorTab: "st-inspector-tab tab",
	inspectorTabOn: "st-inspector-tab tab tab-active",
	inspector: "st-inspector flex-1 min-h-0 overflow-auto",
	diags: "st-diagnostics font-mono text-xs flex flex-col",
	diag: "text-left px-2 py-1 border-b border-base-300 hover:bg-base-200 cursor-pointer",
	error: "text-error font-semibold",
	warning: "text-warning font-semibold",
	note: "text-info font-semibold",
	table: "table table-sm",
	ok: "text-success",
	bad: "text-error",
	state: "st-state font-mono text-xs whitespace-pre-wrap",
	// The assistant (assistant.js).
	chat: "st-chat flex flex-col gap-2 min-h-0 rounded-box border border-base-300 bg-base-100 p-2",
	chatLog: "st-chat-log flex flex-col gap-2 overflow-auto flex-1 min-h-24 text-sm",
	chatInput: "st-chat-input textarea textarea-sm w-full h-20",
	chatPrompt: "font-mono text-xs whitespace-pre-wrap max-h-64 overflow-auto",
	chatUser: "st-chat-user self-end max-w-[90%] rounded-box bg-primary/10 px-3 py-2 whitespace-pre-wrap",
	chatAssistant: "st-chat-assistant max-w-[90%] rounded-box bg-base-200 px-3 py-2 whitespace-pre-wrap",
	chatTool: "st-chat-tool text-xs font-mono opacity-70",
	chatOk: "st-chat-ok text-xs text-success",
	chatError: "st-chat-error text-xs text-error",
	chatThinking: "st-chat-thinking flex items-center gap-2 self-start rounded-box bg-base-200 px-3 py-2 text-sm opacity-80",
	chatDots: "loading loading-dots loading-sm",
};

const styles = await pageStyles(Object.values(UI));
document.body.className = UI.body;
defineRating();
const RUNTIME = new URL("../dist/tutuca-rt.wasm", import.meta.url);
const tw = await load(RUNTIME);
const { runtime } = tw;
const compiler = compilerClient();
const store = await openStore();
// The API's answer, or null when the studio is served as files only.
const server = await checkServer();

// ---- Prebuilt modules ---------------------------------------------------------------------

// The modules of dist/components/ a scope can register, with the names they
// register and their .tcd (for a component's use of their interfaces).
const PREBUILT = ["layout", "counter", "todo_list", "todo_item", "todo_card", "json", "media", "showcase"];
const prebuilt = new Map(
	await Promise.all(
		PREBUILT.map(async (name) => {
			const wasm = await readBytes(new URL(`../dist/components/${name}.wasm`, import.meta.url));
			// A dry run in a scope of its own: what it registers.
			const { registered } = await tw.loadComponent(wasm.slice(), runtime.scope());
			return [name, { wasm, types: registered.map((r) => r.as) }];
		}),
	),
);
const prebuiltTcd = async (name) => new TextDecoder().decode(await readBytes(new URL(`../components/${name}/${name}.tcd`, import.meta.url)));
const PREBUILT_PREFIX = "prebuilt:";

// What a new component starts from: the assistant's tasks example, which
// shows the model a working module too.
const text = async (path) => new TextDecoder().decode(await readBytes(new URL(path, import.meta.url)));
const STARTER = { name: "tasks", tcd: await text("./assistant/examples/tasks.tcd"), wax: await text("./assistant/examples/tasks.wax") };

// ---- The library ---------------------------------------------------------------------------

let lib = await store.load();
const ROOT = "root";
// A new library: a root scope with the layouts, so a first screen has holes.
if (!lib.scopes.has(ROOT)) {
	const root = { id: ROOT, name: "root", parent: null, registrations: [{ component: `${PREBUILT_PREFIX}layout` }] };
	await store.put("scopes", root);
	lib.scopes.set(ROOT, root);
}
const save = (kind, record) => {
	lib[kind].set(record.id, record);
	return store.put(kind, record);
};
const remove = (kind, id) => {
	lib[kind].delete(id);
	return store.delete(kind, id);
};
const newId = () => crypto.randomUUID();

const componentLabel = (ref) => (ref.startsWith(PREBUILT_PREFIX) ? `${ref.slice(PREBUILT_PREFIX.length)} (prebuilt)` : lib.components.get(ref).name);
// The names a registration's module registers: a prebuilt's, or what a
// component's last build said; null when it was never built.
const typesOf = (ref) => (ref.startsWith(PREBUILT_PREFIX) ? prebuilt.get(ref.slice(PREBUILT_PREFIX.length)).types : (lib.components.get(ref)?.build?.types ?? null));
// From the root to the scope.
const chainOf = (scope) => {
	const chain = [];
	for (let s = scope; s; s = lib.scopes.get(s.parent)) chain.unshift(s);
	return chain;
};
// What a scope's holes offer, as ctx_component_names lists them: each name
// once, an inner registration hiding an outer one. [{ name, scope, ref }].
const resolvesIn = (scope) => {
	const found = new Map();
	for (const s of chainOf(scope).reverse()) {
		for (const { component } of s.registrations) {
			for (const name of typesOf(component) ?? []) {
				if (!found.has(name)) found.set(name, { name, scope: s, ref: component });
			}
		}
	}
	return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
};
const screensInOrder = () => [...lib.screens.values()].sort((a, b) => a.created - b.created);

// ---- Building ------------------------------------------------------------------------------

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
let tcdVersion = null;
const version = async () => (tcdVersion ??= (await compiler("version", {})).version);

// The files a component's .tcd uses ("name.tcd": another component of the
// library, or a prebuilt module's), and what they use, by the path written.
async function usedFiles(tcd, files = {}) {
	for (const [, path] of tcd.matchAll(/\buse\s+"([^"]+)"/g)) {
		if (path in files) continue;
		const name = path.replace(/\.tcd$/, "");
		const own = [...lib.components.values()].find((c) => c.name === name);
		const source = own ? own.tcd : prebuilt.has(name) ? await prebuiltTcd(name) : null;
		if (source === null) continue; // tcd reports it
		files[path] = source;
		await usedFiles(source, files);
	}
	return files;
}
const requestFor = async (c) => {
	const main = `${c.name}.tcd`;
	return { main, files: { ...(await usedFiles(c.tcd)), [main]: c.tcd }, impls: [{ path: `${c.name}.wax`, text: c.wax }] };
};

// The component's build, built again only when what it's built from (the
// request and tcd itself) changed since the last one. Kept with it when
// it's the library's, not the editor's copy of it.
async function buildOf(c) {
	const request = await requestFor(c);
	const key = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([await version(), request]))));
	if (c.build?.key === key) return c.build;
	const res = await compiler("build", request);
	c.build = { key, ok: res.ok, wasm: res.ok ? res.wasm : null, types: res.types ?? [], diags: res.diags ?? [] };
	if (lib.components.get(c.id) === c) await save("components", c);
	return c.build;
}
const wasmOf = async (ref) => {
	if (ref.startsWith(PREBUILT_PREFIX)) return prebuilt.get(ref.slice(PREBUILT_PREFIX.length)).wasm;
	const c = lib.components.get(ref);
	const build = await buildOf(c);
	if (!build.ok) throw new Error(`${c.name} doesn't build: edit it to see its diagnostics`);
	return build.wasm;
};

// The scope's chain made from scratch in a runtime instance (t: the screen's
// or the preview's), from first (a new root scope unless given), each scope's
// registrations loaded into it; the innermost scope. What can't be registered
// goes to fail(text).
async function loadChain(t, scopeRecord, fail, first = t.runtime.scope()) {
	let scope = null;
	for (const s of chainOf(scopeRecord)) {
		scope = scope === null ? first : t.runtime.enter(scope, s.id);
		for (const reg of s.registrations) {
			try {
				const loaded = await t.loadComponent((await wasmOf(reg.component)).slice(), scope);
				styles.add(loaded.classes);
			} catch (error) {
				fail(`${s.name}: can't register ${componentLabel(reg.component)}: ${error.message}`);
			}
		}
	}
	return scope;
}

// A host's report as an event line, or null for the ones not shown (render).
const reportLine = (t, type, r) => {
	const line = (kind, text) => ({ kind, text });
	if (type === "log") return line("log", JSON.stringify(snapshot(t.runtime, r.value)));
	if (type === "unhandled") return line("info", `unhandled ${r.message}`);
	if (type === "taskFailed" || type === "renderFailed") return line("failed", r.error?.message ?? String(r.error));
	if (type === "stateInvalid" || type === "messageInvalid") return line("issue", JSON.stringify(r));
	return null;
};
const eventItem = ({ kind, text }) => el("div", { class: `${UI.event} ${UI[kind] ?? ""}` }, `${new Date().toLocaleTimeString()} ${kind}: ${text}`);

// ---- The page ------------------------------------------------------------------------------

// The studio's tabs, picker and menu are studio.tcd's Studio, rendered into
// studioRoot; the editor, still the page's, takes its place while a
// component is written.
const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const studioRoot = el("div");
const main = el("main", { class: UI.main });
main.hidden = true;
const dialog = el("dialog", { class: UI.dialog, "aria-label": "Layout" });
const importInput = el("input", { type: "file", accept: ".json,application/json", "aria-label": "Import a bundle" });
importInput.hidden = true;
app.append(studioRoot, main, dialog, importInput);

// ---- Screens -------------------------------------------------------------------------------

// A screen starts as a Screen, to toggle editing it, around a Vbox, which
// starts with a hole.
const DEFAULT_LAYOUT = { $make: "Screen" };
// The layout made in the studio: its Screen offers new components and ✎, and
// with editing starts edited, as a new screen does.
const forStudio = (layout, editing = false) =>
	layout?.$make === "Screen" ? { ...layout, fields: { ...layout.fields, studio: true, ...(editing && { editing: true }) } } : layout;

const ACTIVE_KEY = "tutuca-wax-studio:screen";
const remembered = () => {
	try {
		return localStorage.getItem(ACTIVE_KEY);
	} catch {
		return null;
	}
};
const remember = (id) => {
	try {
		localStorage.setItem(ACTIVE_KEY, id);
	} catch {}
};

// Every scope chain the host makes hangs from base: the host listens for the
// events of the types in its root's scope tree, so a screen's types are
// heard too. The studio's own module is in a child of its own, which no
// screen's chain goes through: a hole never lists Studio. Each screen opened
// gets a child of base, so it's made from scratch.
const base = runtime.scope();
const studioScope = runtime.enter(base, "studio");
styles.add((await tw.loadComponent(new URL("../dist/components/studio.wasm", import.meta.url), studioScope)).classes);
let opened = 0;

// The library's scopes and screens, as the studio holds them.
const scopeRows = () => [...lib.scopes.values()].map(({ id, name, parent }) => ({ id, name, parent: parent ?? "" }));
const screenRows = () => screensInOrder().map(({ id, name, scope, created }) => ({ id, name, scope, created }));

let studioHost = null;
// Messages to the studio, sent once what's running now is done: an ask's
// handler or a report doesn't send in the middle of a task.
const tell = (name, ...args) => queueMicrotask(() => studioHost?.send(name, args));
const say = (message) => tell("say", message);
const note = (kind, message) => tell("note", kind, message);

let mounted = null; // the screen the studio shows: { id, scope }
let wanted = null; // the screen asked for last
const fresh = new Set(); // screens made but not opened yet, which open edited

// The layout the studio shows, kept when it changed.
let pendingSave = null;
async function keepLayout() {
	clearTimeout(pendingSave);
	pendingSave = null;
	if (!mounted || !studioHost) return;
	const root = studioHost.root();
	const [made] = runtime.get(root, "shown");
	const screen = lib.screens.get(mounted.id);
	if (!made || !screen || runtime.get(root, "shown_id") !== mounted.id) return;
	let layout;
	try {
		layout = capture(runtime, mounted.scope, made);
	} catch (error) {
		say(`can't keep ${screen.name}'s layout: ${error.message}`);
		return;
	}
	if (JSON.stringify(layout) === JSON.stringify(screen.layout)) return;
	screen.layout = layout;
	await save("screens", screen);
}
const keepLayoutSoon = () => {
	clearTimeout(pendingSave);
	pendingSave = setTimeout(keepLayout, 300);
};

// An element with autofocus that the studio renders gets the focus once.
const focused = new WeakSet();
const autofocus = () => {
	for (const node of studioRoot.querySelectorAll("[autofocus]")) {
		if (focused.has(node)) continue;
		focused.add(node);
		node.focus();
	}
};

// What the studio and the screens it shows ask the page for.
const asks = {
	// The screen's scope chain made from scratch, each scope's registrations
	// loaded into it, and its layout made there.
	open_screen: async (id) => {
		await keepLayout();
		wanted = id;
		const screen = lib.screens.get(id);
		if (!screen) throw new Error(`there's no screen ${id}`);
		const editing = fresh.delete(id);
		const scopeRecord = lib.scopes.get(screen.scope);
		const scope = await loadChain(tw, scopeRecord, (message) => note("failed", message), runtime.enter(base, `screen ${opened++}`));
		const made = hydrate(runtime, scope, forStudio(screen.layout, editing));
		if (wanted === id) {
			mounted = { id, scope };
			remember(id);
			say(`${screen.name}, in ${chainOf(scopeRecord).map((s) => s.name).join(" / ")}`);
		}
		return { id, screen: made };
	},
	// A new screen starts with the default layout, opened edited.
	save_screen: async (id, name, scope, created) => {
		const existing = lib.screens.get(id);
		if (!existing) fresh.add(id);
		await save("screens", { layout: structuredClone(DEFAULT_LAYOUT), ...existing, id, name, scope, created });
		return true;
	},
	delete_screen: async (id) => {
		if (mounted?.id === id) {
			clearTimeout(pendingSave);
			mounted = null;
		}
		await remove("screens", id);
		return true;
	},
	save_scope: async (id, name, parent) => {
		await save("scopes", { id, name, parent, registrations: [] });
		return true;
	},
	confirm: (text) => confirm(text),
	export_library: async () => {
		await keepLayout();
		exportBundle();
		return true;
	},
	import_library: () =>
		new Promise((resolve) => {
			importing = resolve;
			importInput.click();
		}),
	edit_layout_json: (id) => {
		showLayoutJson(id);
		return true;
	},
	// The layout's: a hole's new component, a slot's ✎.
	create_component: () => createComponent(),
	edit_component: (item) => editComponent(item),
};

// The screen's layout as it's kept, to read or change by hand.
async function showLayoutJson(id) {
	await keepLayout();
	const screen = lib.screens.get(id);
	const box = el("textarea", { class: UI.layoutJson, spellcheck: "false", "aria-label": "Layout (JSON)" });
	box.value = JSON.stringify(screen.layout, null, 2);
	const apply = el("button", { class: UI.primary }, "Apply");
	apply.addEventListener("click", async () => {
		try {
			screen.layout = JSON.parse(box.value);
		} catch (error) {
			say(`not JSON: ${error.message}`);
			return;
		}
		await save("screens", screen);
		// Not kept over what was just applied: what it shows is older.
		clearTimeout(pendingSave);
		mounted = null;
		dialog.close();
		tell("reopen");
	});
	dialog.replaceChildren(
		el(
			"div",
			{ class: `${UI.dialogBox} max-w-3xl` },
			el("h3", { class: UI.dialogTitle }, `${screen.name}'s layout`),
			box,
			el("div", { class: UI.dialogActions }, el("button", { class: UI.ghost, onclick: () => dialog.close() }, "Close"), apply),
		),
	);
	dialog.showModal();
}

// ---- The editor ----------------------------------------------------------------------------

// While a component is written or edited, the page is the editor: the
// screen's host stays mounted, hidden, waiting for the answer to its ask.
const NAME = /^[a-z][a-z0-9_]*$/;
const freeName = (base) => {
	const taken = new Set([...lib.components.values()].map((c) => c.name));
	let name = base;
	for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
	return name;
};

const backButton = el("button", { class: UI.ghost, title: "Back to the screen, without saving" }, "← Back");
const nameInput = el("input", { class: `${UI.input} font-mono w-48`, "aria-label": "Component name" });
const buildButton = el("button", { class: UI.button, title: "Ctrl/Cmd-Enter" }, "Build");
const assistantButton = el("button", { class: UI.button, title: "Ask a model to change this component" }, "Assistant");
assistantButton.hidden = !server?.assistant;
const saveButton = el("button", { class: UI.primary, title: "Keep it and register it in the screen's scope" }, "Save & register");
const editorStatus = el("span", { class: UI.status });
const fileTabs = el("div", { class: UI.fileTabs });
const editorBox = el("div", { class: UI.editor });
const preview = el("div", { class: UI.preview });
const previewType = el("select", { class: `${UI.select} st-preview-type`, "aria-label": "Type to preview" });
const inspectorTabs = el("div", { class: UI.inspectorTabs, role: "tablist" });
const inspector = el("div", { class: UI.inspector });
const diagList = el("div", { class: UI.diags });
const typesBox = el("div");
const stateBox = el("pre", { class: UI.state });
const previewEvents = el("div", { class: UI.eventList });
const work = el(
	"div",
	{ class: UI.work },
	el("section", { class: UI.pane }, fileTabs, editorBox),
	el("section", { class: UI.pane }, el("div", { class: UI.row }, el("span", { class: UI.label }, "preview"), previewType), preview, inspectorTabs, inspector),
);
const editorPane = el(
	"section",
	{ class: UI.main },
	el("div", { class: UI.editorBar }, backButton, nameInput, buildButton, assistantButton, el("span", { class: UI.spacer }), editorStatus, saveButton),
	work,
);
main.append(editorPane);

const INSPECTORS = { diagnostics: ["Diagnostics", diagList], registers: ["Registers", typesBox], state: ["State", stateBox], events: ["Events", previewEvents] };
let inspecting = "diagnostics";
const renderInspector = () => {
	inspectorTabs.textContent = "";
	for (const [id, [label]] of Object.entries(INSPECTORS)) {
		const on = id === inspecting;
		inspectorTabs.append(
			el(
				"button",
				{
					class: on ? UI.inspectorTabOn : UI.inspectorTab,
					role: "tab",
					"aria-selected": String(on),
					onclick: () => {
						inspecting = id;
						renderInspector();
					},
				},
				label,
			),
		);
	}
	inspector.replaceChildren(INSPECTORS[inspecting][1]);
};

// The session: { kind: "create" | "edit", copy, scope (the screen's scope
// record), resolve (the ask's answer), saved (the sources as they were) }.
let session = null;
const editor = createEditor(editorBox, {
	onRun: () => build(),
	onChange: () => keepSources(),
});
const keepSources = () => {
	if (!session) return;
	session.copy.tcd = editor.text(`${session.copy.name}.tcd`);
	session.copy.wax = editor.text(`${session.copy.name}.wax`);
};
const changed = () => session && (session.copy.tcd !== session.saved.tcd || session.copy.wax !== session.saved.wax || session.copy.name !== session.saved.name);
const renderFileTabs = () => {
	fileTabs.textContent = "";
	for (const name of editor.names()) {
		const on = editor.current() === name;
		fileTabs.append(
			el(
				"button",
				{
					class: on ? UI.fileTabOn : UI.fileTab,
					onclick: () => {
						editor.show(name);
						renderFileTabs();
					},
				},
				name,
			),
		);
	}
};
const openFiles = (c) => {
	const current = editor.current();
	for (const name of editor.names()) editor.remove(name);
	editor.open(`${c.name}.tcd`, c.tcd, { lang: "tcd" });
	editor.open(`${c.name}.wax`, c.wax, { lang: "wax" });
	editor.show(current?.endsWith(".wax") ? `${c.name}.wax` : `${c.name}.tcd`);
	renderFileTabs();
};
const renderDiagnostics = (diags) => {
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
		const go = () => {
			if (editor.has(where)) {
				editor.goto(where, d.span.start.line, d.span.start.col);
				renderFileTabs();
			}
		};
		diagList.append(el("button", { class: UI.diag, onclick: go }, el("span", { class: UI[d.severity] ?? UI.note }, `${d.severity} `), `${where}:${d.span.start.line}:${d.span.start.col} ${d.message}`));
	}
	if (diags.length === 0) diagList.append(el("span", { class: UI.info }, "nothing to report"));
	editor.setDiagnostics(byFile);
};
// Each type it registers, and whether a hole can make it: made with no
// fields, in a scope with only this module.
const renderTypes = async (b) => {
	typesBox.textContent = "";
	if (!b?.ok) {
		typesBox.append(el("span", { class: UI.info }, b ? "it doesn't build" : "not built yet"));
		return [];
	}
	const scope = runtime.scope();
	await tw.loadComponent(b.wasm.slice(), scope);
	const makeable = [];
	const rows = b.types.map((t) => {
		let made = "a hole can make it";
		let ok = true;
		try {
			runtime.make(scope, t, {});
			makeable.push(t);
		} catch (error) {
			made = `a hole can't make it alone: ${error.message}`;
			ok = false;
		}
		return el("tr", {}, el("td", { class: "font-mono" }, t), el("td", { class: ok ? UI.ok : UI.bad }, made));
	});
	typesBox.append(el("table", { class: UI.table }, el("tbody", {}, ...rows)));
	return makeable;
};

// The preview: in a runtime instance of its own (one instance drives one
// host, and the screen's is still mounted), the screen's scope chain and,
// in a scope inside it, the module as just built, hiding a version of it
// registered around; one of its types made there with no fields.
let previewTw = null;
let previewHost = null;
const previewNote = (line) => previewEvents.prepend(eventItem(line));
const showState = () => {
	try {
		stateBox.textContent = previewHost ? JSON.stringify(snapshot(previewTw.runtime, previewHost.root()), null, 2) : "";
	} catch (error) {
		stateBox.textContent = error.message;
	}
};
async function renderPreview(b, makeable) {
	previewHost?.unmount();
	previewHost = null;
	preview.replaceChildren();
	previewEvents.textContent = "";
	if (!b?.ok) {
		preview.append(el("span", { class: UI.info }, "it doesn't build: see the diagnostics"));
		return;
	}
	const wanted = previewType.value;
	previewType.textContent = "";
	for (const t of makeable) previewType.append(el("option", { value: t }, t));
	previewType.hidden = makeable.length < 2;
	if (makeable.length === 0) {
		preview.append(el("span", { class: UI.info }, "none of its types can be made with no fields"));
		return;
	}
	previewType.value = makeable.includes(wanted) ? wanted : makeable[0];
	previewTw ??= await load(RUNTIME);
	if (!session) return;
	const around = await loadChain(previewTw, session.scope, (message) => previewNote({ kind: "failed", text: message }));
	if (!session) return;
	const scope = previewTw.runtime.enter(around, "preview");
	try {
		const loaded = await previewTw.loadComponent(b.wasm.slice(), scope);
		styles.add(loaded.classes);
		previewHost = previewTw.runtime.createHost(document, preview, previewTw.runtime.make(scope, previewType.value, {}), {
			dev: true,
			onReport: (type, r) => {
				if (type === "render") return showState();
				const line = reportLine(previewTw, type, r);
				if (line) previewNote(line);
			},
		});
		previewHost.mount();
		showState();
	} catch (error) {
		preview.append(el("span", { class: UI.bad }, `can't preview it: ${error.message}`));
	}
}
previewType.addEventListener("change", () => session && renderPreview(session.copy.build, [...previewType.options].map((o) => o.value)));

async function build() {
	if (!session) return null;
	keepSources();
	const c = session.copy;
	editorStatus.textContent = `building ${c.name}…`;
	try {
		const b = await buildOf(c);
		editorStatus.textContent = b.ok ? `built: registers ${b.types.join(", ")}` : "it didn't build: see the diagnostics";
		if (session?.copy !== c) return b;
		renderDiagnostics(b.diags);
		if (!b.ok && inspecting !== "diagnostics") {
			inspecting = "diagnostics";
			renderInspector();
		}
		await renderPreview(b, await renderTypes(b));
		return b;
	} catch (error) {
		editorStatus.textContent = `the compiler failed: ${error.message}`;
		return null;
	}
}

// What the assistant is told of a build: the types it registers, or tcd's
// diagnostics and the signatures of the functions still missing.
async function check() {
	const c = session.copy;
	const b = await build();
	if (!b) return { ok: false, text: "The compiler failed; nothing was built." };
	const warnings = b.diags.filter((d) => d.severity !== "error").map(diagnosticText);
	if (b.ok) {
		const notes = warnings.length > 0 ? `\nWarnings:\n${warnings.join("\n")}` : "";
		return { ok: true, text: `It built: ${c.name} registers ${b.types.join(", ")}.${notes}` };
	}
	let message = `It didn't build. tcd's diagnostics:\n${b.diags.map(diagnosticText).join("\n")}`;
	try {
		const stub = await compiler("stub", await requestFor(c));
		if (stub.ok && stub.stub.trim()) message += `\n\nThe functions the .wax is missing, with the signatures it must have:\n${stub.stub}`;
	} catch {}
	return { ok: false, text: message };
}
const assistant = server?.assistant
	? assistantPanel({
			server,
			UI,
			component: () => session?.copy ?? null,
			write: async ({ tcd, wax }) => {
				if (!session) return;
				if (typeof tcd === "string") session.copy.tcd = tcd;
				if (typeof wax === "string") session.copy.wax = wax;
				openFiles(session.copy);
			},
			check,
			// The chat is kept with the component once it's in the library.
			keep: (c) => (lib.components.has(c.id) ? save("components", { ...lib.components.get(c.id), chat: c.chat }) : undefined),
		})
	: null;
if (assistant) {
	work.append(assistant.root);
	assistantButton.addEventListener("click", () => {
		const open = assistant.toggle();
		assistantButton.className = open ? UI.primary : UI.button;
		work.className = open ? UI.workChat : UI.work;
	});
}

// Opens the editor on a copy of c; resolves with what the ask is answered.
function openEditor(kind, c) {
	return new Promise((resolve) => {
		const scope = lib.scopes.get(lib.screens.get(mounted.id).scope);
		session = { kind, copy: { ...c, chat: [...(c.chat ?? [])] }, saved: { name: c.name, tcd: c.tcd, wax: c.wax }, scope, resolve };
		studioRoot.hidden = true;
		main.hidden = false;
		nameInput.value = c.name;
		saveButton.textContent = kind === "create" ? "Save & register" : "Save";
		openFiles(session.copy);
		inspecting = "diagnostics";
		renderInspector();
		assistant?.render();
		build();
	});
}
function closeEditor(answer) {
	const { resolve } = session;
	session = null;
	previewHost?.unmount();
	previewHost = null;
	main.hidden = true;
	studioRoot.hidden = false;
	resolve(answer);
}

// The hole's ask: a new component, from the starter. Answered with its name
// once it's registered, or "" when the editor is left without saving.
function createComponent() {
	const c = { id: newId(), name: freeName(STARTER.name), tcd: STARTER.tcd, wax: STARTER.wax };
	return openEditor("create", c);
}
// A slot's ask: the component in it, by the name it's made by here. Only
// the library's components open; true once it's saved, false otherwise.
function editComponent(item) {
	const name = runtime.nameIn(mounted.scope, item);
	const found = resolvesIn(lib.scopes.get(lib.screens.get(mounted.id).scope)).find((r) => r.name === name);
	if (!found || found.ref.startsWith(PREBUILT_PREFIX)) {
		say(`${name ?? "that"} comes with the studio: only components you made open in the editor`);
		return false;
	}
	return openEditor("edit", lib.components.get(found.ref));
}

backButton.addEventListener("click", () => {
	if (changed() && !confirm(`Leave ${session.copy.name} without saving?`)) return;
	closeEditor(session.kind === "create" ? "" : false);
});
buildButton.addEventListener("click", () => build());
nameInput.addEventListener("change", () => {
	const name = nameInput.value.trim();
	if (!NAME.test(name) || [...lib.components.values()].some((c) => c.id !== session.copy.id && c.name === name)) {
		editorStatus.textContent = `a name is snake_case and unique in the library: ${name} isn't`;
		nameInput.value = session.copy.name;
		return;
	}
	keepSources();
	session.copy.name = name;
	openFiles(session.copy);
});
saveButton.addEventListener("click", async () => {
	const { kind, copy, scope } = session;
	const b = await build();
	if (!b?.ok) {
		editorStatus.textContent = "it doesn't build yet: fix what the diagnostics say first";
		return;
	}
	// Another registration giving one of its names would hide it, or it them.
	const taken = resolvesIn(scope).filter((r) => r.ref !== copy.id && b.types.includes(r.name));
	if (taken.length > 0) {
		const which = taken.map((r) => `${r.name} (${componentLabel(r.ref)}${r.scope === scope ? "" : `, from ${r.scope.name}`})`).join(", ");
		editorStatus.textContent = `${which} already made in this scope: rename the component in ${copy.name}.tcd`;
		return;
	}
	await save("components", copy);
	if (kind === "create") {
		scope.registrations.push({ component: copy.id });
		await save("scopes", scope);
		// Registered in the mounted screen's scope too, for the hole to make.
		const loaded = await tw.loadComponent(b.wasm.slice(), mounted.scope);
		styles.add(loaded.classes);
		say(`${copy.name} registered in ${scope.name}: ${b.types.join(", ")}`);
		closeEditor(copy.name);
		return;
	}
	say(`${copy.name} saved`);
	closeEditor(true);
	// Made again, with the new module.
	await keepLayout();
	tell("reopen");
});

// ---- Export and import ---------------------------------------------------------------------

function exportBundle() {
	const blob = new Blob([JSON.stringify(toBundle(lib), null, 2)], { type: "application/json" });
	const a = el("a", { href: URL.createObjectURL(blob), download: "tutuca-wax-studio.json" });
	a.click();
	URL.revokeObjectURL(a.href);
}
// The import ask's answer, while the file is being picked.
let importing = null;
const imported = (ok) => {
	importing?.(ok);
	importing = null;
};
importInput.addEventListener("cancel", () => imported(false));
importInput.addEventListener("change", async () => {
	const file = importInput.files[0];
	importInput.value = "";
	if (!file) return imported(false);
	let records;
	try {
		records = fromBundle(JSON.parse(await file.text()));
	} catch (error) {
		say(`can't import ${file.name}: ${error.message}`);
		return imported(false);
	}
	const replaced = Object.entries(records).flatMap(([kind, rs]) => rs.filter((r) => lib[kind].has(r.id) && kind !== "scopes").map((r) => r.name));
	if (replaced.length > 0 && !confirm(`Importing replaces ${replaced.join(", ")}. Go on?`)) return imported(false);
	await keepLayout();
	const shown = mounted?.id;
	mounted = null;
	for (const [kind, rs] of Object.entries(records)) for (const r of rs) await store.put(kind, r);
	lib = await store.load();
	tell("set_library", scopeRows(), screenRows());
	const next = lib.screens.get(shown) ?? screensInOrder()[0];
	if (next) tell("show_screen", next.id);
	say(`imported ${Object.values(records).reduce((n, rs) => n + rs.length, 0)} records from ${file.name}`);
	imported(true);
});

// ---- The studio ----------------------------------------------------------------------------

const badge = server?.assistant ? `assistant: ${server.models.length} model${server.models.length === 1 ? "" : "s"}` : "";
studioHost = runtime.createHost(document, studioRoot, runtime.make(studioScope, "Studio", { scopes: scopeRows(), screens: screenRows(), assistant: badge }), {
	dev: true,
	asks,
	onReport: (type, r) => {
		if (type === "render") {
			autofocus();
			return keepLayoutSoon();
		}
		const line = reportLine(tw, type, r);
		if (line) note(line.kind, line.text);
	},
});
studioHost.mount();
const first = lib.screens.get(remembered()) ?? screensInOrder()[0];
if (first) tell("show_screen", first.id);

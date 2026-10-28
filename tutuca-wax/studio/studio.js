// The studio: screens, each a tab, made in a scope of a tree of scopes and
// composed by filling a layout's holes with what that scope can make. A
// hole's list also offers a new component, and a slot's ✎ edits the one in
// it: the page turns into an editor (the code, a live preview, what the
// build says and the assistant), and saving registers the component in the
// screen's scope, where the hole can make it. Components, scopes and screens
// stay in IndexedDB (store.js); a screen is kept as what to make
// (js/hydrate.js's capture), saved as it changes. Opening a screen makes its
// scope chain from scratch, loads each scope's registrations into it (built
// again only when the sources or tcd changed), and mounts the layout on a dev
// host. Served with an API (scripts/studio-server.mjs), the editor also has
// an assistant (assistant.js): a model that edits the component, its changes
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
	bar: "st-bar flex items-center gap-2 border-b border-base-300 bg-base-100 px-2 py-1",
	brand: "text-sm font-bold opacity-70 px-1",
	tabs: "st-tabs flex items-center gap-1 overflow-x-auto min-w-0",
	tab: "st-tab group flex items-center rounded-btn hover:bg-base-200",
	tabOn: "st-tab group flex items-center rounded-btn bg-base-200 font-semibold",
	tabLabel: "px-3 py-1 text-sm whitespace-nowrap",
	tabClose: "btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-60 hover:opacity-100",
	tabName: "input input-xs w-32",
	plus: "st-new-screen btn btn-sm btn-ghost btn-square",
	spacer: "flex-1",
	status: "st-status text-xs opacity-70 truncate max-w-[40%]",
	badge: "st-assistant badge badge-ghost badge-sm",
	menu: "st-menu dropdown dropdown-end",
	menuButton: "btn btn-sm btn-ghost btn-square",
	menuList: "menu menu-sm dropdown-content z-20 w-48 rounded-box border border-base-300 bg-base-100 p-1 shadow",
	main: "flex-1 min-h-0 flex flex-col",
	empty: "flex-1 flex flex-col items-center justify-center gap-3",
	lead: "text-sm opacity-70 max-w-prose text-center",
	button: "btn btn-sm",
	primary: "btn btn-sm btn-primary",
	big: "btn btn-primary",
	ghost: "btn btn-sm btn-ghost",
	small: "btn btn-xs btn-ghost",
	input: "input input-sm",
	select: "select select-sm",
	label: "text-xs uppercase tracking-wide opacity-60",
	row: "flex flex-wrap items-center gap-2",
	info: "opacity-70",
	// A screen.
	stage: "st-stage flex-1 min-h-0 overflow-auto p-4",
	events: "st-events-box border-t border-base-300 bg-base-100 text-xs",
	eventsSummary: "cursor-pointer px-3 py-1 opacity-70",
	eventList: "st-events font-mono max-h-40 overflow-auto flex flex-col px-3 pb-2",
	event: "py-0.5 border-b border-base-300",
	log: "text-success",
	issue: "text-warning",
	failed: "st-failed text-error",
	// The scope picker.
	dialog: "modal",
	dialogBox: "modal-box flex flex-col gap-3",
	dialogTitle: "text-lg font-bold",
	tree: "st-tree flex flex-col gap-0.5 max-h-80 overflow-auto rounded-box border border-base-300 p-1",
	treeRow: "flex items-center gap-1",
	scope: "st-scope btn btn-sm btn-ghost flex-1 justify-start font-mono",
	scopeOn: "st-scope btn btn-sm btn-active flex-1 justify-start font-mono",
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
// or the preview's), each scope's registrations loaded into it; the innermost
// scope. What can't be registered goes to fail(text).
async function loadChain(t, scopeRecord, fail) {
	let scope = null;
	for (const s of chainOf(scopeRecord)) {
		scope = scope === null ? t.runtime.scope() : t.runtime.enter(scope, s.id);
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

const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const status = el("span", { class: UI.status });
const say = (message) => {
	status.textContent = message;
	status.title = message;
};
const tabBar = el("nav", { class: UI.tabs, role: "tablist" });
const newScreenButton = el("button", { class: UI.plus, title: "New screen", "aria-label": "New screen" }, "+");
const importInput = el("input", { type: "file", accept: ".json,application/json", "aria-label": "Import a bundle" });
importInput.hidden = true;
const menuItem = (label, title, onclick) => el("li", {}, el("button", { title, onclick }, label));
const menu = el(
	"details",
	{ class: UI.menu },
	el("summary", { class: UI.menuButton, title: "More", "aria-label": "More" }, "⋯"),
	el(
		"ul",
		{ class: UI.menuList },
		menuItem("Layout JSON", "The screen's layout as it's kept", () => showLayoutJson()),
		menuItem("Export", "Download the library as a bundle", () => exportBundle()),
		menuItem("Import", "Add a bundle's components, scopes and screens", () => importInput.click()),
		el("li", {}, el("a", { href: "../playground/" }, "Playground")),
		el("li", {}, el("a", { href: "../demos/" }, "Demos")),
	),
);
const closeMenu = () => menu.removeAttribute("open");
const bar = el(
	"header",
	{ class: UI.bar },
	el("span", { class: UI.brand }, "studio"),
	tabBar,
	newScreenButton,
	el("span", { class: UI.spacer }),
	status,
	server?.assistant ? el("span", { class: UI.badge, title: "Served with an LLM assistant: open it from the editor" }, `assistant: ${server.models.length} model${server.models.length === 1 ? "" : "s"}`) : null,
	menu,
	importInput,
);
const main = el("main", { class: UI.main });
app.append(bar, main);

// ---- Screens -------------------------------------------------------------------------------

// A screen starts as a Vbox holding a hole, in a Screen to toggle editing it.
const DEFAULT_LAYOUT = { $make: "Screen", fields: { content: { $make: "Vbox", fields: { items: [{ $make: "Hole" }] } } } };
// The layout made in the studio: its Screen offers new components and ✎.
const forStudio = (layout) => (layout?.$make === "Screen" ? { ...layout, fields: { ...layout.fields, studio: true } } : layout);

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

const stage = el("div", { class: UI.stage });
const eventList = el("div", { class: UI.eventList });
const eventsSummary = el("summary", { class: UI.eventsSummary }, "events");
const screenPane = el("section", { class: UI.main }, stage, el("details", { class: UI.events }, eventsSummary, eventList));
const emptyPane = el(
	"section",
	{ class: UI.empty },
	el("p", { class: UI.lead }, "A screen is a layout made in a scope: fill its holes with the components that scope can make, or write new ones. Everything stays in this browser; export a bundle to take it elsewhere."),
	el("button", { class: UI.big, onclick: () => pickScope() }, "+ New screen"),
);
main.append(screenPane, emptyPane);

let active = null; // the screen shown
let mounted = null; // { screen, scope, host }
let events = 0;
const note = (kind, message) => {
	eventList.prepend(eventItem({ kind, text: message }));
	eventsSummary.textContent = `events (${++events})`;
};

// The layout as it is now, kept when it changed.
let pendingSave = null;
async function keepLayout() {
	clearTimeout(pendingSave);
	pendingSave = null;
	if (!mounted) return;
	const { screen, scope, host } = mounted;
	let layout;
	try {
		layout = capture(runtime, scope, host.root());
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

const unmount = async () => {
	await keepLayout();
	mounted?.host.unmount();
	mounted = null;
	stage.replaceChildren();
};

// The screen's scope chain made from scratch, each scope's registrations
// loaded into it, and its layout mounted there on a dev host that answers
// the layout's asks for new components and edits.
async function openScreen(screen) {
	await unmount();
	eventList.textContent = "";
	events = 0;
	eventsSummary.textContent = "events";
	const scopeRecord = lib.scopes.get(screen.scope);
	const scope = await loadChain(tw, scopeRecord, (message) => note("failed", message));
	try {
		const host = runtime.createHost(document, stage, hydrate(runtime, scope, forStudio(screen.layout)), {
			dev: true,
			asks: { create_component: () => createComponent(), edit_component: (item) => editComponent(item) },
			onReport: (type, r) => {
				if (type === "render") return keepLayoutSoon();
				const line = reportLine(tw, type, r);
				if (line) note(line.kind, line.text);
			},
		});
		mounted = { screen, scope, host };
		host.mount();
		say(`${screen.name}, in ${chainOf(scopeRecord).map((s) => s.name).join(" / ")}`);
	} catch (error) {
		note("failed", `can't make ${screen.name}'s layout: ${error.message}`);
		say(`can't make ${screen.name}'s layout: see the events`);
	}
}

async function showScreen(screen) {
	active = screen;
	if (screen) remember(screen.id);
	renderTabs();
	screenPane.hidden = !screen;
	emptyPane.hidden = !!screen;
	if (screen) await openScreen(screen);
	else await unmount();
}

function renderTabs() {
	tabBar.textContent = "";
	for (const screen of screensInOrder()) {
		const label = el("button", { class: UI.tabLabel, role: "tab", "aria-selected": String(screen === active), title: "Double-click to rename" }, screen.name);
		label.addEventListener("click", () => screen !== active && showScreen(screen));
		label.addEventListener("dblclick", () => {
			const input = el("input", { class: UI.tabName, value: screen.name, "aria-label": "Screen name" });
			const done = async () => {
				screen.name = input.value.trim() || screen.name;
				await save("screens", screen);
				renderTabs();
			};
			input.addEventListener("change", done);
			input.addEventListener("blur", done);
			input.addEventListener("keydown", (e) => e.key === "Escape" && renderTabs());
			label.replaceWith(input);
			input.select();
		});
		const close = el("button", { class: UI.tabClose, title: `Delete ${screen.name}`, "aria-label": `Delete ${screen.name}` }, "×");
		close.addEventListener("click", async () => {
			if (!confirm(`Delete the screen ${screen.name}?`)) return;
			if (screen === active) {
				mounted?.host.unmount();
				mounted = null;
			}
			await remove("screens", screen.id);
			if (screen === active) await showScreen(screensInOrder().at(-1) ?? null);
			else renderTabs();
		});
		tabBar.append(el("div", { class: screen === active ? UI.tabOn : UI.tab }, label, close));
	}
}

// ---- The scope picker ----------------------------------------------------------------------

const picker = el("dialog", { class: UI.dialog, "aria-label": "New screen" });
app.append(picker);

// A new screen: the scope it's made in, picked from the tree (where a child
// scope can be added), and its name.
function pickScope() {
	let selected = lib.scopes.get(active?.scope) ?? lib.scopes.get(ROOT);
	let adding = null; // the scope a child is being added under
	const tree = el("div", { class: UI.tree, role: "tree" });
	const name = el("input", { class: UI.input, placeholder: `screen ${lib.screens.size + 1}`, "aria-label": "New screen's name" });
	const renderTree = () => {
		tree.textContent = "";
		const walk = (s, depth) => {
			const pad = `margin-left: ${depth * 1.25}rem`;
			const pick = el("button", { class: s === selected ? UI.scopeOn : UI.scope, role: "treeitem", "aria-selected": String(s === selected) }, s.name);
			pick.addEventListener("click", () => {
				selected = s;
				renderTree();
			});
			const add = el("button", { class: UI.small, title: `Add a scope in ${s.name}`, "aria-label": `Add a scope in ${s.name}` }, "+");
			add.addEventListener("click", () => {
				adding = s;
				renderTree();
			});
			tree.append(el("div", { class: UI.treeRow, style: pad }, pick, add));
			if (adding === s) {
				const input = el("input", { class: UI.input, placeholder: "scope's name", "aria-label": "New scope's name" });
				input.addEventListener("keydown", async (e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						adding = null;
						renderTree();
					}
					if (e.key !== "Enter") return;
					e.preventDefault();
					const child = { id: newId(), name: input.value.trim() || "scope", parent: s.id, registrations: [] };
					await save("scopes", child);
					selected = child;
					adding = null;
					renderTree();
				});
				tree.append(el("div", { class: UI.treeRow, style: `margin-left: ${(depth + 1) * 1.25}rem` }, input));
				queueMicrotask(() => input.focus());
			}
			for (const child of [...lib.scopes.values()].filter((c) => c.parent === s.id)) walk(child, depth + 1);
		};
		walk(lib.scopes.get(ROOT), 0);
	};
	const create = el("button", { class: UI.primary }, "Create");
	create.addEventListener("click", async () => {
		const screen = { id: newId(), name: name.value.trim() || name.placeholder, scope: selected.id, layout: structuredClone(DEFAULT_LAYOUT), created: Date.now() };
		await save("screens", screen);
		picker.close();
		await showScreen(screen);
	});
	name.addEventListener("keydown", (e) => e.key === "Enter" && create.click());
	picker.replaceChildren(
		el(
			"div",
			{ class: UI.dialogBox },
			el("h3", { class: UI.dialogTitle }, "New screen"),
			el("p", { class: UI.label }, "the scope it's made in"),
			tree,
			el("p", { class: UI.label }, "its name"),
			name,
			el("div", { class: UI.dialogActions }, el("button", { class: UI.ghost, onclick: () => picker.close() }, "Cancel"), create),
		),
	);
	renderTree();
	picker.showModal();
}
newScreenButton.addEventListener("click", () => pickScope());

// The screen's layout as it's kept, to read or change by hand.
function showLayoutJson() {
	closeMenu();
	if (!active) return say("no screen open");
	const box = el("textarea", { class: UI.layoutJson, spellcheck: "false", "aria-label": "Layout (JSON)" });
	box.value = JSON.stringify(active.layout, null, 2);
	const apply = el("button", { class: UI.primary }, "Apply");
	apply.addEventListener("click", async () => {
		try {
			active.layout = JSON.parse(box.value);
		} catch (error) {
			say(`not JSON: ${error.message}`);
			return;
		}
		await save("screens", active);
		// Not kept over what was just applied: what it shows is older.
		mounted?.host.unmount();
		mounted = null;
		picker.close();
		await openScreen(active);
	});
	picker.replaceChildren(
		el(
			"div",
			{ class: `${UI.dialogBox} max-w-3xl` },
			el("h3", { class: UI.dialogTitle }, `${active.name}'s layout`),
			box,
			el("div", { class: UI.dialogActions }, el("button", { class: UI.ghost, onclick: () => picker.close() }, "Close"), apply),
		),
	);
	picker.showModal();
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
editorPane.hidden = true;
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
		session = { kind, copy: { ...c, chat: [...(c.chat ?? [])] }, saved: { name: c.name, tcd: c.tcd, wax: c.wax }, scope: lib.scopes.get(mounted.screen.scope), resolve };
		bar.hidden = true;
		screenPane.hidden = true;
		editorPane.hidden = false;
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
	editorPane.hidden = true;
	bar.hidden = false;
	screenPane.hidden = false;
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
	const found = resolvesIn(lib.scopes.get(mounted.screen.scope)).find((r) => r.name === name);
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
	await openScreen(active);
});

// ---- Export and import ---------------------------------------------------------------------

function exportBundle() {
	closeMenu();
	const blob = new Blob([JSON.stringify(toBundle(lib), null, 2)], { type: "application/json" });
	const a = el("a", { href: URL.createObjectURL(blob), download: "tutuca-wax-studio.json" });
	a.click();
	URL.revokeObjectURL(a.href);
}
importInput.addEventListener("change", async () => {
	closeMenu();
	const file = importInput.files[0];
	importInput.value = "";
	if (!file) return;
	let records;
	try {
		records = fromBundle(JSON.parse(await file.text()));
	} catch (error) {
		say(`can't import ${file.name}: ${error.message}`);
		return;
	}
	const replaced = Object.entries(records).flatMap(([kind, rs]) => rs.filter((r) => lib[kind].has(r.id) && kind !== "scopes").map((r) => r.name));
	if (replaced.length > 0 && !confirm(`Importing replaces ${replaced.join(", ")}. Go on?`)) return;
	await unmount();
	for (const [kind, rs] of Object.entries(records)) for (const r of rs) await store.put(kind, r);
	lib = await store.load();
	await showScreen(lib.screens.get(active?.id) ?? screensInOrder()[0] ?? null);
	say(`imported ${Object.values(records).reduce((n, rs) => n + rs.length, 0)} records from ${file.name}`);
});

await showScreen(lib.screens.get(remembered()) ?? screensInOrder()[0] ?? null);

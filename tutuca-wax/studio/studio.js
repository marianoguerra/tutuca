// The studio's page: the host of studio.tcd's Studio, which has the screens
// as tabs, the picker a new screen's scope is chosen in, the menu and the
// editor, and which asks the page for what only it can do: keep the library
// in IndexedDB (store.js), make a screen or a preview in its scope chain
// (answered with the component made, which Studio renders), build with tcd
// (the compiler worker), confirm, move the library in and out. A screen is
// composed by filling a layout's holes with what its scope can make; a
// hole's list also offers a new component, and a slot's ✎ edits the one in
// it: the studio turns into the editor, its code in tw-code-editor
// (code-editor.js, around CodeMirror), and saving registers the component in
// the screen's scope, where the hole can make it. A screen is kept as what
// to make (js/hydrate.js's capture), saved as it changes. Served with an API
// (scripts/studio-server.mjs), the editor also has an assistant: a model
// that edits the component (the conversation is the editor's; the page asks
// the server for the model's turns, assistant.js).
import { defineRating } from "../components/media/rating.js";
import { capture, hydrate } from "../js/hydrate.js";
import { compilerClient, el, pageStyles } from "../js/page.js";
import { snapshot } from "../js/pbt.js";
import { componentMeta, load, readBytes } from "../js/tutuca-rt.js";
import { askChat, askPrompt, checkServer, diagnosticText, rememberModel, rememberedModel } from "./assistant.js";
import { defineStudioElements } from "./code-editor.js";
import { fromBundle, openStore, toBundle } from "./store.js";

const UI = {
	body: "bg-base-200 text-base-content",
	app: "h-screen flex flex-col",
	button: "btn btn-sm",
	primary: "btn btn-sm btn-primary",
	ghost: "btn btn-sm btn-ghost",
	select: "select select-sm",
	label: "text-xs uppercase tracking-wide opacity-60",
	row: "flex flex-wrap items-center gap-2",
	// The layout JSON dialog.
	dialog: "modal",
	dialogBox: "modal-box flex flex-col gap-3",
	dialogTitle: "text-lg font-bold",
	dialogActions: "modal-action mt-0",
	layoutJson: "st-layout textarea textarea-sm font-mono text-xs w-full h-80",
	// The studio while .wasm files are dragged over it.
	dropping: "outline-2 outline-dashed outline-primary -outline-offset-4",
};

const styles = await pageStyles(Object.values(UI));
document.body.className = UI.body;
defineRating();
defineStudioElements();
const RUNTIME = new URL("../dist/tutuca-rt.wasm", import.meta.url);
const tw = await load(RUNTIME);
const { runtime } = tw;
const compiler = compilerClient();
const store = await openStore();
// The API's answer, or null when the studio is served as files only.
const server = await checkServer();

// ---- Prebuilt modules ---------------------------------------------------------------------

// The modules of dist/components/ a scope can register, with the names they
// register and their .tcd (for a component's use of their interfaces), as
// their tutuca section says.
const PREBUILT = ["layout", "counter", "todo_list", "todo_item", "todo_card", "json", "media", "showcase"];
const prebuilt = new Map(
	await Promise.all(
		PREBUILT.map(async (name) => {
			const wasm = new Uint8Array(await readBytes(new URL(`../dist/components/${name}.wasm`, import.meta.url)));
			const { types, tcd } = componentMeta(wasm);
			return [name, { wasm, types, tcd }];
		}),
	),
);
const PREBUILT_PREFIX = "prebuilt:";

// What a new component starts from: the assistant's tasks example, which
// shows the model a working module too.
const text = async (path) => new TextDecoder().decode(await readBytes(new URL(path, import.meta.url)));
const STARTER = { name: "tasks", tcd: await text("./assistant/examples/tasks.tcd"), wax: await text("./assistant/examples/tasks.wax") };
// What the editor can start from instead: the examples the build lists
// (dist/examples.json: the assistant's and the component modules'), each a
// .tcd and its .wax, fetched when picked.
const EXAMPLES = new Map(JSON.parse(await text("../dist/examples.json")).map((e) => [e.name, e]));

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

// The files a component's .tcd uses ("name.tcd", or a path ending in it as
// the component modules write them: another component of the library, or a
// prebuilt module's, else the one an imported module came with, in kept),
// and what they use, by the path written.
function usedFiles(tcd, kept = {}, files = {}) {
	for (const [, path] of tcd.matchAll(/\buse\s+"([^"]+)"/g)) {
		if (path in files) continue;
		const name = path.split("/").pop().replace(/\.tcd$/, "");
		const own = [...lib.components.values()].find((c) => c.name === name);
		const source = own?.tcd ?? prebuilt.get(name)?.tcd ?? kept[path] ?? null;
		if (source === null) continue; // tcd reports it
		files[path] = source;
		usedFiles(source, kept, files);
	}
	return files;
}
const requestFor = async (c) => {
	const main = `${c.name}.tcd`;
	return { main, files: { ...usedFiles(c.tcd, c.uses), [main]: c.tcd }, impls: [{ path: `${c.name}.wax`, text: c.wax }] };
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

// ---- The page ------------------------------------------------------------------------------

// The studio is studio.tcd's Studio, rendered into studioRoot.
const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const studioRoot = el("div");
const dialog = el("dialog", { class: UI.dialog, "aria-label": "Layout" });
const importInput = el("input", { type: "file", multiple: "", accept: ".json,application/json,.wasm,application/wasm", "aria-label": "Import a bundle or components" });
importInput.hidden = true;
app.append(studioRoot, dialog, importInput);

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

// Every scope chain the studio makes hangs from base. The studio's own
// module is in a child of its own, which no screen's chain goes through: a
// hole never lists Studio. Each screen opened and each preview made gets a
// child of base, so it's made from scratch, left once another takes its
// place.
const base = runtime.scope();
const studioScope = runtime.enter(base, "studio");
styles.add((await tw.loadComponent(new URL("../dist/components/studio.wasm", import.meta.url), studioScope)).classes);
let opened = 0;
// A new child of base: { name, scope }.
const child = (kind) => {
	const name = `${kind} ${opened++}`;
	return { name, scope: runtime.enter(base, name) };
};

// The library's scopes and screens, as the studio holds them.
const scopeRows = () => [...lib.scopes.values()].map(({ id, name, parent }) => ({ id, name, parent: parent ?? "" }));
const screenRows = () => screensInOrder().map(({ id, name, scope, created }) => ({ id, name, scope, created }));

let studioHost = null;
// Messages to the studio, sent once what's running now is done: an ask's
// handler or a report doesn't send in the middle of a task.
const tell = (name, ...args) => queueMicrotask(() => studioHost?.send(name, args));
// The same, to the editor (studio.tcd's Studio holds it in its field editor).
const tellEditor = (name, ...args) => queueMicrotask(() => studioHost?.sendAt(["editor"], name, args));
const say = (message) => tell("say", message);
const note = (kind, message) => tell("note", kind, message);

let mounted = null; // the screen the studio shows: { id, scope, child (its child of base) }
let wanted = null; // the screen asked for last
const fresh = new Set(); // screens made but not opened yet, which open edited
// The screen shown no longer is: its child of base is left.
const unmount = () => {
	if (mounted) runtime.leave(base, mounted.child);
	mounted = null;
};

// The layout the studio shows, kept when it changed.
let pendingSave = null;
async function keepLayout() {
	clearTimeout(pendingSave);
	pendingSave = null;
	if (!mounted || !studioHost) return;
	const root = studioHost.root();
	const made = runtime.get(root, "shown");
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
		const under = child("screen");
		const scope = await loadChain(tw, scopeRecord, (message) => note("failed", message), under.scope);
		const made = hydrate(runtime, scope, forStudio(screen.layout, editing));
		// One asked for after it won't be shown: nothing will be made there.
		if (wanted !== id) runtime.leave(base, under.name);
		else {
			unmount();
			mounted = { id, scope, child: under.name };
			remember(id);
			say(`${screen.name}, in ${chainOf(scopeRecord).map((s) => s.name).join(" / ")}`);
		}
		return { id, screen: made, editing };
	},
	// A new screen starts with the default layout, opened edited.
	// The bar's toggle: sent to the screen shown, answered with what it'll be.
	toggle_screen: () => {
		const screen = runtime.get(studioHost.root(), "shown");
		if (!screen) return false;
		studioHost.sendAt(["shown"], "toggle_editing");
		return !runtime.get(screen, "editing");
	},
	save_screen: async (id, name, scope, created) => {
		const existing = lib.screens.get(id);
		if (!existing) fresh.add(id);
		await save("screens", { layout: structuredClone(DEFAULT_LAYOUT), ...existing, id, name, scope, created });
		return true;
	},
	delete_screen: async (id) => {
		if (mounted?.id === id) {
			clearTimeout(pendingSave);
			unmount();
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
	export_components: () => exportComponents(),
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
		unmount();
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

// ---- The editor ---------------------------------------------------------------------------

// While a component is written or edited, studio.tcd's Editor is the page;
// the screen stays in the studio's state, its hole or slot waiting for the
// answer to its ask. editing: { creating, resolve (that answer), scope (the
// screen's scope record), draft ({ id, name, tcd, wax, build, chat }: what
// the last build was made from), state (the preview's, as last told),
// preview (the last preview's child of base) }.
const NAME = /^[a-z][a-z0-9_]*$/;
const freeName = (base) => {
	const taken = new Set([...lib.components.values()].map((c) => c.name));
	let name = base;
	for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
	return name;
};
let editing = null;

function openEditor(creating, c) {
	return new Promise((resolve) => {
		const scope = lib.scopes.get(lib.screens.get(mounted.id).scope);
		editing = { creating, resolve, scope, draft: { ...c, chat: [...(c.chat ?? [])] }, state: "" };
		tell("open_editor", creating, c.id, c.name, c.tcd, c.wax, c.chat ?? []);
	});
}
function closeEditing(answer) {
	const { resolve, preview } = editing;
	if (preview) runtime.leave(base, preview);
	editing = null;
	resolve(answer);
}

// The hole's ask: a new component, from the starter. Answered with its name
// once it's registered, or "" when the editor is left without saving.
const createComponent = () => openEditor(true, { id: newId(), name: freeName(STARTER.name), tcd: STARTER.tcd, wax: STARTER.wax });
// A slot's ask: the component in it, by the name it's made by here. Only
// the library's components open; true once it's saved, false otherwise.
function editComponent(item) {
	const name = runtime.nameIn(mounted.scope, item);
	const found = resolvesIn(lib.scopes.get(lib.screens.get(mounted.id).scope)).find((r) => r.name === name);
	if (!found || found.ref.startsWith(PREBUILT_PREFIX)) {
		say(`${name ?? "that"} comes with the studio: only components you made open in the editor`);
		return false;
	}
	return openEditor(false, lib.components.get(found.ref));
}

// Each type it registers, and whether a hole can make it: made with no
// fields, in a scope with only this module.
async function registersOf(b) {
	if (!b.ok) return [];
	const scope = runtime.scope();
	await tw.loadComponent(b.wasm.slice(), scope);
	return b.types.map((name) => {
		try {
			runtime.make(scope, name, {});
			return { name, ok: true, note: "a hole can make it" };
		} catch (error) {
			return { name, ok: false, note: `a hole can't make it alone: ${error.message}` };
		}
	});
}
const diagnosticRow = (d) => ({
	file: d.span.file,
	line: d.span.start.line,
	col: d.span.start.col,
	end_line: d.span.end.line,
	end_col: d.span.end.col,
	severity: d.severity,
	message: d.hint ? `${d.message} (${d.hint})` : d.message,
	text: diagnosticText(d),
});

// The draft, as the editor has it now.
const draftAs = (id, name, tcd, wax) => {
	if (editing?.draft.id !== id) throw new Error("that component isn't being edited");
	return Object.assign(editing.draft, { name, tcd, wax });
};

// What the editor asks the page for.
Object.assign(asks, {
	build: async (id, name, tcd, wax) => {
		const draft = draftAs(id, name, tcd, wax);
		const b = await buildOf(draft);
		const registers = await registersOf(b);
		return {
			ok: b.ok,
			status: b.ok ? `built: registers ${b.types.join(", ")}` : "it didn't build: see the diagnostics",
			makeable: registers.filter((r) => r.ok).map(({ name }) => ({ name })),
			registers,
			diagnostics: b.diags.map(diagnosticRow),
		};
	},
	// In a scope inside the screen's chain, the module as last built, hiding
	// a version of it registered around; the type made there with no fields.
	preview: async (id, type) => {
		const { draft, scope: scopeRecord } = editing ?? {};
		if (draft?.id !== id || !draft.build?.ok) throw new Error("it doesn't build");
		const under = child("preview");
		if (editing.preview) runtime.leave(base, editing.preview);
		editing.preview = under.name;
		const around = await loadChain(tw, scopeRecord, (message) => tellEditor("note", "failed", message), under.scope);
		const scope = runtime.enter(around, "preview");
		styles.add((await tw.loadComponent(draft.build.wasm.slice(), scope)).classes);
		return runtime.make(scope, type, {});
	},
	// Kept, and registered in the screen's scope when it's new; an edited
	// one's screen is made again with it.
	save_component: async (creating, id, name, tcd, wax, chat) => {
		if (!NAME.test(name) || [...lib.components.values()].some((c) => c.id !== id && c.name === name)) {
			throw new Error(`a name is snake_case and unique in the library: ${name} isn't`);
		}
		const draft = draftAs(id, name, tcd, wax);
		const b = await buildOf(draft);
		if (!b.ok) throw new Error("it doesn't build yet: fix what the diagnostics say first");
		let { scope } = editing;
		// A name another registration of this scope gives can't be given again;
		// one a parent scope gives is hidden here (an inner registration hides
		// an outer one), so a screen's scope can have its own Hbox while the
		// others keep root's. A new one that would give one again can have a
		// scope made for the screen, under its own, and the screen moved there.
		const taken = scope.registrations
			.filter((r) => r.component !== id)
			.flatMap((r) => (typesOf(r.component) ?? []).filter((t) => b.types.includes(t)).map((t) => `${t} (${componentLabel(r.component)})`));
		if (taken.length > 0) {
			const screen = lib.screens.get(mounted.id);
			const ask = `${taken.join(", ")} already made in ${scope.name}, for all its screens. Give ${screen.name} a scope of its own, under ${scope.name}, and register ${name} there?`;
			if (!creating || !confirm(ask)) {
				throw new Error(`${taken.join(", ")} already made in ${scope.name}: rename the component in ${name}.tcd, or make it in a scope of its own, where it hides ${scope.name}'s`);
			}
			await keepLayout();
			const own = { id: newId(), name: screen.name, parent: scope.id, registrations: [] };
			await save("scopes", own);
			await save("screens", { ...lib.screens.get(screen.id), scope: own.id });
			tell("scope_added", own.id, own.name, own.parent);
			tell("screen_moved", screen.id, own.id);
			scope = editing.scope = own;
		}
		await save("components", { id, name, tcd, wax, uses: draft.uses, build: b, chat });
		if (creating) {
			// One that hides a name of a parent scope changes what the screen's
			// components are made from: the screen is kept and made again with it.
			const hides = resolvesIn(scope).some((r) => b.types.includes(r.name));
			if (hides) await keepLayout();
			scope.registrations.push({ component: id });
			await save("scopes", scope);
			say(`${name} registered in ${scope.name}: ${b.types.join(", ")}`);
			if (hides) {
				closeEditing(name);
				tell("reopen");
				return "saved";
			}
			// Registered in the shown screen's scope too, for the hole to make.
			styles.add((await tw.loadComponent(b.wasm.slice(), mounted.scope)).classes);
			closeEditing(name);
		} else {
			say(`${name} saved`);
			closeEditing(true);
			await keepLayout();
			tell("reopen");
		}
		return "saved";
	},
	// An example's sources, asked first when they'd replace changed ones; a
	// new component takes a free name after it.
	example: async (name, replacing) => {
		if (replacing && !confirm(`Replace ${editing.draft.name}'s sources with ${name}'s?`)) return { ok: false, name: "", tcd: "", wax: "" };
		const example = EXAMPLES.get(name);
		const [tcd, wax] = await Promise.all([text(`../${example.tcd}`), text(`../${example.wax}`)]);
		return { ok: true, name: freeName(name), tcd, wax };
	},
	leave_editor: (creating) => {
		closeEditing(creating ? "" : false);
		return true;
	},
	// The assistant's: the model's turn, from the server (stop_chat aborts
	// it: answered "aborted"), and what it's told of a build that failed.
	chat: async (model, messages, name, tcd, wax) => {
		chatting?.abort();
		chatting = new AbortController();
		try {
			return await askChat(model, messages, { name, tcd, wax }, chatting.signal);
		} catch (error) {
			if (error.name === "AbortError") throw new Error("aborted");
			throw error;
		} finally {
			chatting = null;
		}
	},
	stop_chat: () => {
		chatting?.abort();
		return true;
	},
	stub: async (id, name, tcd, wax) => {
		const res = await compiler("stub", await requestFor(draftAs(id, name, tcd, wax)));
		return res.ok ? res.stub.trim() : "";
	},
	prompt: (name, tcd, wax) => askPrompt({ name, tcd, wax }),
	remember_model: (model) => {
		rememberModel(model);
		return true;
	},
	// The conversation kept with the component once it's in the library.
	keep_chat: async (id, messages) => {
		if (editing?.draft.id === id) editing.draft.chat = messages;
		const c = lib.components.get(id);
		if (c) await save("components", { ...c, chat: messages });
		return true;
	},
});
let chatting = null; // the AbortController of the model's turn in flight

// The preview's state, told to the editor when it changed.
function tellPreviewState() {
	const editor = runtime.get(studioHost.root(), "editor");
	if (!editing || !editor) return;
	const preview = runtime.get(editor, "preview");
	let state = "";
	try {
		state = preview ? JSON.stringify(snapshot(runtime, preview), null, 2) : "";
	} catch (error) {
		state = error.message;
	}
	if (state === editing.state) return;
	editing.state = state;
	tellEditor("set_state", state);
}



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
	const files = [...importInput.files];
	importInput.value = "";
	if (files.some((f) => f.name.endsWith(".wasm"))) return imported(await importModules(files));
	const file = files[0];
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
	unmount();
	for (const [kind, rs] of Object.entries(records)) for (const r of rs) await store.put(kind, r);
	lib = await store.load();
	tell("set_library", scopeRows(), screenRows());
	const next = lib.screens.get(shown) ?? screensInOrder()[0];
	if (next) tell("show_screen", next.id);
	say(`imported ${Object.values(records).reduce((n, rs) => n + rs.length, 0)} records from ${file.name}`);
	imported(true);
});

// ---- Components as .wasm --------------------------------------------------------------------

// A component module carries what it's made from and what it is (tcd's
// tutuca section, componentMeta), so one exported from a library is a
// component of another once imported: kept with its sources, built as it was
// (its .wasm is its build, checked against the runtime's ABI), registered in
// the shown screen's scope like one made there.

const download = (name, bytes, type) => {
	const a = el("a", { href: URL.createObjectURL(new Blob([bytes], { type })), download: name });
	a.click();
	URL.revokeObjectURL(a.href);
};
// The library's components the shown screen's scope chain registers, each
// as its .wasm, built first when it isn't.
async function exportComponents() {
	if (!mounted) return false;
	const refs = chainOf(lib.scopes.get(lib.screens.get(mounted.id).scope)).flatMap((s) => s.registrations.map((r) => r.component));
	const own = [...new Set(refs)].filter((ref) => !ref.startsWith(PREBUILT_PREFIX));
	if (own.length === 0) {
		say("this screen's scopes register none of your components: only those export");
		return false;
	}
	const done = [];
	for (const ref of own) {
		const c = lib.components.get(ref);
		try {
			download(`${c.name}.wasm`, await wasmOf(ref), "application/wasm");
			done.push(c.name);
		} catch (error) {
			note("failed", `can't export ${c.name}: ${error.message}`);
		}
	}
	say(done.length > 0 ? `exported ${done.map((n) => `${n}.wasm`).join(", ")}` : "nothing exported: see the events");
	return done.length > 0;
}

// What a .wasm file is as a component of the library, or why it can't be.
async function componentOf(file) {
	const wasm = new Uint8Array(await file.arrayBuffer());
	const meta = componentMeta(wasm);
	if (!meta) throw new Error("it isn't a component module tcd built (it has no tutuca section)");
	if (meta.format !== 1) throw new Error(`its tutuca section is format ${meta.format}, this studio reads 1`);
	// Refused here when it's for another ABI or doesn't load.
	await tw.loadComponent(wasm.slice(), runtime.scope());
	const wax = meta.impls.map((i) => i.text).join("\n");
	const same = [...lib.components.values()].find((c) => c.tcd === meta.tcd && c.wax === wax);
	const c = same ?? { id: newId(), name: freeName(meta.name), tcd: meta.tcd, wax, uses: meta.uses, chat: [] };
	const key = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([await version(), await requestFor(c)]))));
	return { meta, c: { ...c, build: { key, ok: true, wasm, types: meta.types, diags: [] } }, existed: !!same };
}

// The .wasm files, kept and registered in the shown screen's scope, which
// is made again with them; then what they need that it doesn't give.
async function importModules(files) {
	if (!mounted) {
		say("open a screen first: imported components are registered in its scope");
		return false;
	}
	const scope = lib.scopes.get(lib.screens.get(mounted.id).scope);
	const added = [];
	for (const file of files.filter((f) => f.name.endsWith(".wasm"))) {
		let found;
		try {
			found = await componentOf(file);
		} catch (error) {
			note("failed", `can't import ${file.name}: ${error.message}`);
			continue;
		}
		const { meta, c } = found;
		const registered = scope.registrations.some((r) => r.component === c.id);
		const taken = scope.registrations
			.filter((r) => r.component !== c.id)
			.flatMap((r) => (typesOf(r.component) ?? []).filter((t) => meta.types.includes(t)).map((t) => `${t} (${componentLabel(r.component)})`));
		if (taken.length > 0) {
			note("failed", `can't import ${file.name}: ${taken.join(", ")} already made in ${scope.name}; import it in a scope of its own, where it hides ${scope.name}'s`);
			continue;
		}
		await save("components", c);
		if (!registered) scope.registrations.push({ component: c.id });
		added.push({ file, meta, c });
	}
	if (added.length === 0) {
		say("nothing imported: see the events");
		return false;
	}
	await keepLayout();
	await save("scopes", scope);
	// What the scope gives now, made apart, to tell what's still missing.
	const made = await loadChain(tw, scope, () => {}, runtime.scope());
	const gives = new Set(resolvesIn(scope).map((r) => r.name));
	for (const { meta, c } of added) {
		const missing = [
			...meta.needs.types.filter((t) => !gives.has(t)).map((t) => `a ${t} to make`),
			...meta.needs.interfaces.filter((i) => runtime.interface(made, i) === null).map((i) => `the ${i} interface`),
			...meta.host_asks.filter((a) => !(a in asks)).map((a) => `an answer to its ${a} host ask`),
		];
		if (missing.length > 0) note("issue", `${c.name} needs ${missing.join(", ")}, which ${scope.name} doesn't give`);
	}
	say(`imported into ${scope.name}: ${added.map(({ c, meta }) => `${c.name} (${meta.types.join(", ")})`).join(", ")}`);
	tell("reopen");
	return true;
}

// .wasm files dropped on the studio are imported into the shown screen's
// scope; a drag from inside the page (a layout's) carries no files.
const dragsFiles = (e) => mounted && !editing && e.dataTransfer?.types.includes("Files");
studioRoot.addEventListener("dragover", (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	e.dataTransfer.dropEffect = "copy";
	studioRoot.classList.add(...UI.dropping.split(" "));
});
studioRoot.addEventListener("dragleave", (e) => {
	if (!studioRoot.contains(e.relatedTarget)) studioRoot.classList.remove(...UI.dropping.split(" "));
});
studioRoot.addEventListener("drop", (e) => {
	studioRoot.classList.remove(...UI.dropping.split(" "));
	if (!dragsFiles(e)) return;
	e.preventDefault();
	importModules([...e.dataTransfer.files]);
});

// ---- The studio ----------------------------------------------------------------------------

// The models the server offers, by provider, and the one picked last.
const models = server?.assistant ? server.models : [];
const byProvider = [...Map.groupBy(models, (m) => m.provider)].map(([provider, list]) => ({
	provider,
	models: list.map((m) => ({ value: `${m.provider}/${m.id}`, name: m.name })),
}));
const values = models.map((m) => `${m.provider}/${m.id}`);
const model = values.includes(rememberedModel()) ? rememberedModel() : (values[0] ?? "");
// Where a report came from: the preview's components are the editor's to
// show (at editor.preview), the rest the studio's, with where they are.
const fromPreview = (path) => path?.[0] === "editor" && path[1] === "preview";
const where = (path) => (path?.length ? ` (at ${path.join(".")})` : "");
studioHost = runtime.createHost(
	document,
	studioRoot,
	runtime.make(studioScope, "Studio", { scopes: scopeRows(), screens: screenRows(), models: byProvider, model, examples: [...EXAMPLES.keys()].map((name) => ({ name })) }),
	{
		dev: true,
		asks,
		onReport: (type, r) => {
			if (type === "render") {
				autofocus();
				tellPreviewState();
				return keepLayoutSoon();
			}
			const line = reportLine(tw, type, r);
			if (!line) return;
			if (fromPreview(r.path)) tellEditor("note", line.kind, line.text);
			else note(line.kind, `${line.text}${where(r.path)}`);
		},
	},
);
studioHost.mount();
const first = lib.screens.get(remembered()) ?? screensInOrder()[0];
if (first) tell("show_screen", first.id);

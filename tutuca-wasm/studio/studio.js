// The studio's page: the page of studio.tutuca.ts's Studio, which has the screens as tabs, the
// picker a new screen's scope is chosen in, the menu and the editor, and which asks the page
// for what only it can do: keep the library in IndexedDB (store.js), make a screen or a preview
// in its scope chain (answered with what to make, which Studio renders), check and compile a
// module, confirm, move the library in and out. A screen is composed by filling a layout's
// holes with what its scope can make; a hole's list also offers a new component, and a slot's
// ✎ edits the one in it: the studio turns into the editor, its code in tw-code-editor
// (code-editor.js, around CodeMirror), and saving registers the component in the screen's
// scope, where the hole can make it. A screen is kept as what to make (the runtime's capture),
// saved as it changes. Served with an API (scripts/server.mjs), the editor also has an
// assistant: a model that edits the component (the conversation is the editor's; the page asks
// the server for the model's turns, assistant.js).
//
// Everything runs on one runtime. Its scopes are a tree: the studio's own module in one, and
// each screen opened and each preview made in another, with the screen's scope chain below it.
import { createRuntime } from "../dist/tutuca-wasm.js";
import { el, moduleSources, pageStyles } from "../js/page.js";
import { COMPILER, MARGAUI, RUNTIME, SOURCES } from "../js/paths.js";
import {
	askChat,
	askPrompt,
	checkServer,
	diagnosticReport,
	rememberedModel,
	rememberModel,
} from "./assistant.js";
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
	// The studio while files are dragged over it.
	dropping: "outline-2 outline-dashed outline-primary -outline-offset-4",
	// What an import did, for a few seconds, below the bar.
	toasts: "st-toasts toast toast-top toast-end top-10 z-50",
	toast: "st-toast alert shadow-lg cursor-pointer items-start text-sm max-w-md",
	toastSuccess: "st-toast-success alert-success",
	toastError: "st-toast-error alert-error",
	toastWarning: "st-toast-warning alert-warning",
	toastBody: "flex flex-col gap-0.5 min-w-0",
	toastTitle: "font-semibold",
	toastLine: "text-xs opacity-90 break-words",
};

const styles = await pageStyles(MARGAUI, Object.values(UI));
document.body.className = UI.body;
const { defineRating } = await import(new URL("components/media/rating.js", SOURCES));
defineRating();
defineStudioElements();
const store = await openStore();
// The API's answer, or null when the studio is served as files only.
const server = await checkServer();
const sources = moduleSources(SOURCES);
const asks = {};

// ---- Prebuilt modules ---------------------------------------------------------------------

// The modules of components/ a scope can register, with their source (for a component's
// import of their interfaces) and the names they register.
const PREBUILT = [
	"meta",
	"layout",
	"counter",
	"todo_list",
	"todo_item",
	"todo_card",
	"json",
	"media",
	"showcase",
];
const PREBUILT_PREFIX = "prebuilt:";
const prebuiltPath = (name) => `components/${name}/${name}.tutuca.ts`;
// What a new component starts from: the assistant's tasks example, which shows the model a
// working module too.
const STARTER = {
	name: "tasks",
	source: await sources.read("studio/assistant/examples/tasks.tutuca.ts"),
};
// What the editor can start from instead: the assistant's examples and the component modules,
// each a module, fetched when picked.
const EXAMPLES = new Map(
	[
		...["checklist", "note", "score", "stat", "tasks"].map((name) => [
			name,
			`studio/assistant/examples/${name}.tutuca.ts`,
		]),
		...PREBUILT.filter((name) => name !== "meta").map((name) => [name, prebuiltPath(name)]),
	].map(([name, source]) => [name, { name, source }]),
);

// ---- The page's nodes and the runtime ---------------------------------------------------------

// The studio is studio.tutuca.ts's Studio, rendered into studioRoot.
const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const studioRoot = el("div");
const dialog = el("dialog", { class: UI.dialog, "aria-label": "Layout" });
const importInput = el("input", {
	type: "file",
	multiple: "",
	accept: ".json,application/json,.ts",
	"aria-label": "Import a bundle or components",
});
importInput.hidden = true;
const toasts = el("div", { class: UI.toasts, role: "status", "aria-live": "polite" });
app.append(studioRoot, dialog, importInput, toasts);

// A toast: kind (success, error or warning), a title and lines below it,
// gone after a while or when clicked. The events say it too.
const TOAST_KINDS = { success: UI.toastSuccess, error: UI.toastError, warning: UI.toastWarning };
function toast(kind, title, lines = []) {
	const node = el(
		"div",
		{ class: `${UI.toast} ${TOAST_KINDS[kind]}`, title: "Dismiss" },
		el(
			"div",
			{ class: UI.toastBody },
			el("span", { class: UI.toastTitle }, title),
			...lines.map((line) => el("span", { class: UI.toastLine }, line)),
		),
	);
	node.addEventListener("click", () => node.remove());
	toasts.append(node);
	setTimeout(() => node.remove(), kind === "success" ? 5000 : 10000);
}

const tutuca = await createRuntime({
	document,
	rootNode: studioRoot,
	asks,
	runtime: RUNTIME,
	compiler: COMPILER,
});
styles.watch(studioRoot);
const prebuilt = new Map();
for (const name of PREBUILT) {
	const checked = await sources.load(tutuca, prebuiltPath(name), { check: true });
	prebuilt.set(name, { source: checked.source, types: checked.types ?? [] });
}

// ---- The library ---------------------------------------------------------------------------

let lib = await store.load();
const ROOT = "root";
// A new library: a root scope with the well-known meta schemas, which check
// what the components below say about themselves, and the layouts, so a
// first screen has holes.
if (!lib.scopes.has(ROOT)) {
	const root = {
		id: ROOT,
		name: "root",
		parent: null,
		registrations: [
			{ component: `${PREBUILT_PREFIX}meta` },
			{ component: `${PREBUILT_PREFIX}layout` },
		],
	};
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

const componentLabel = (ref) =>
	ref.startsWith(PREBUILT_PREFIX)
		? `${ref.slice(PREBUILT_PREFIX.length)} (prebuilt)`
		: lib.components.get(ref).name;
// The names a registration's module registers: a prebuilt's, or what a
// component's last build said; null when it was never built.
const typesOf = (ref) =>
	ref.startsWith(PREBUILT_PREFIX)
		? prebuilt.get(ref.slice(PREBUILT_PREFIX.length)).types
		: (lib.components.get(ref)?.build?.types ?? null);
// From the root to the scope.
const chainOf = (scope) => {
	const chain = [];
	for (let s = scope; s; s = lib.scopes.get(s.parent)) chain.unshift(s);
	return chain;
};
// What a scope's holes offer, as ctx.componentNames lists them: each name
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

const hex = (buffer) =>
	[...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
// The file a component's source is built as.
const mainOf = (name) => `${name}.tutuca.ts`;
// The files a component's source imports (from "name.tutuca", or a path
// ending in it as the component modules write them): another component of
// the library, or a prebuilt module's, else the one an imported module came
// with, in kept), and what they import, by the path written, with .ts.
function usedFiles(source, kept = {}, files = {}) {
	for (const m of source.matchAll(/\bfrom\s+"([^"]+\.tutuca)(?:\.ts)?"/g)) {
		const path = `${m[1]}.ts`;
		if (path in files) continue;
		const name = path
			.split("/")
			.pop()
			.replace(/\.tutuca\.ts$/, "");
		const own = [...lib.components.values()].find((c) => c.name === name);
		const text = own?.source ?? prebuilt.get(name)?.source ?? kept[path] ?? null;
		if (text === null) continue; // pure-tutuca reports it
		files[path] = text;
		usedFiles(text, kept, files);
	}
	return files;
}
// What a component's imports of other component modules resolve to.
const resolverOf = (c) => {
	const files = usedFiles(c.source, c.uses);
	return (spec) => files[spec.endsWith(".ts") ? spec : `${spec}.ts`] ?? null;
};
// 1-based line and column of an offset.
const placeOf = (source, offset) => {
	const before = source.slice(0, Math.max(0, offset));
	return { line: before.split("\n").length, col: before.length - before.lastIndexOf("\n") };
};
// A diagnostic with where it is as lines and columns of the file it's in.
const withSpan = (d, file, source) => ({
	code: d.code,
	message: d.message,
	hint: d.help ?? null,
	severity: "error",
	span: {
		file,
		start: placeOf(source, d.span?.start ?? d.start ?? 0),
		end: placeOf(source, d.span?.end ?? d.end ?? d.start ?? 0),
	},
});
// The component's build: whether it checks and compiles, the names it registers and its
// diagnostics, made again only when what it's built from changed since the last one. Kept with
// it when it's the library's, not the editor's copy of it.
async function buildOf(c) {
	const request = [c.source, usedFiles(c.source, c.uses)];
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(request)),
	);
	const key = hex(digest);
	if (c.build?.key === key) return c.build;
	const res = await tutuca.load(c.source, { resolve: resolverOf(c), check: true });
	c.build = {
		key,
		ok: res.ok,
		types: res.types ?? [],
		diags: res.diagnostics.map((d) => withSpan(d, mainOf(c.name), c.source)),
	};
	if (lib.components.get(c.id) === c) await save("components", c);
	return c.build;
}
// Registers a registration's module in a scope of the runtime.
async function register(ref, scope) {
	if (ref.startsWith(PREBUILT_PREFIX)) {
		const name = ref.slice(PREBUILT_PREFIX.length);
		const loaded = await sources.load(tutuca, prebuiltPath(name), { scope });
		if (!loaded.ok) throw new Error(loaded.diagnostics[0]?.message ?? "it doesn't load");
		return loaded;
	}
	const c = lib.components.get(ref);
	const loaded = await tutuca.load(c.source, { scope, resolve: resolverOf(c) });
	if (!loaded.ok) throw new Error(`${c.name} doesn't build: edit it to see its diagnostics`);
	return loaded;
}
// The scope's chain made from scratch below first (a scope of the runtime), each scope's
// registrations loaded into it; the innermost scope. What can't be registered goes to
// fail(text).
async function loadChain(scopeRecord, fail, first) {
	let scope = null;
	for (const s of chainOf(scopeRecord)) {
		scope = scope === null ? first : [...scope, s.id];
		for (const reg of s.registrations) {
			try {
				await register(reg.component, scope);
			} catch (error) {
				fail(`${s.name}: can't register ${componentLabel(reg.component)}: ${error.message}`);
			}
		}
	}
	return scope;
}

// ---- Screens -------------------------------------------------------------------------------

// A screen starts as a Screen, to toggle editing it, around a Vbox, which
// starts with a hole.
const DEFAULT_LAYOUT = { $make: "Screen" };
// The layout made in the studio: its Screen offers new components and ✎, and
// with editing starts edited, as a new screen does.
const forStudio = (layout, editing = false) =>
	layout?.$make === "Screen"
		? { ...layout, fields: { ...layout.fields, studio: true, ...(editing && { editing: true }) } }
		: layout;

const ACTIVE_KEY = "tutuca-wasm-studio:screen";
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

// Every scope chain the studio makes is below the base. The studio's own module is in a scope of
// its own, which no screen's chain goes through: a hole never lists Studio. Each screen opened
// and each preview made gets another, so it's made from scratch, left once another takes its
// place.
const STUDIO = ["studio"];
{
	const loaded = await sources.load(tutuca, "studio/studio.tutuca.ts", { scope: STUDIO });
	if (!loaded.ok) throw new Error(`the studio: ${loaded.diagnostics[0]?.message}`);
}
let opened = 0;
// A new scope below the base: { name, scope }.
const child = (kind) => {
	const name = `${kind} ${opened++}`;
	return { name, scope: [name] };
};
// The library's scopes and screens, as the studio holds them.
const scopeRows = () =>
	[...lib.scopes.values()].map(({ id, name, parent }) => ({ id, name, parent: parent ?? "" }));
const screenRows = () =>
	screensInOrder().map(({ id, name, scope, created }) => ({ id, name, scope, created }));
let started = false;
// Messages to the studio, sent once what's running now is done: an ask's handler or a report
// doesn't send in the middle of a task.
const tell = (name, ...args) => queueMicrotask(() => started && tutuca.send(name, args));
// The same, to the editor (studio.tutuca.ts's Studio holds it in its field editor).
const tellEditor = (name, ...args) =>
	queueMicrotask(() => started && tutuca.send(name, args, { to: ["editor"] }));
const say = (message) => tell("say", message);
const note = (kind, message) => tell("note", kind, message);
let mounted = null; // the screen the studio shows: { id, scope, child (its scope's name) }
// What the bar says once the screen asked for opens, instead of where it is: what made it
// again says what it did (an import).
let sayOnOpen = null;
let wanted = null; // the screen asked for last
const fresh = new Set(); // screens made but not opened yet, which open edited
// The screen shown no longer is: its scope is left.
const unmount = () => {
	if (mounted) tutuca.leave([mounted.child]);
	mounted = null;
};
// The layout the studio shows, kept when it changed.
let pendingSave = null;
async function keepLayout() {
	clearTimeout(pendingSave);
	pendingSave = null;
	if (!mounted || !started) return;
	const state = tutuca.state();
	const screen = lib.screens.get(mounted.id);
	if (!state.shown || !screen || state.shownId !== mounted.id) return;
	let layout;
	try {
		layout = tutuca.capture(["shown"]);
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
// What the studio and the screens it shows ask the page for: each takes the ask's arguments.
Object.assign(asks, {
	// The screen's scope chain made from scratch, each scope's registrations loaded into it, and
	// its layout made there.
	openScreen: async ([id]) => {
		await keepLayout();
		wanted = id;
		const screen = lib.screens.get(id);
		if (!screen) throw new Error(`there's no screen ${id}`);
		const editing = fresh.delete(id);
		const scopeRecord = lib.scopes.get(screen.scope);
		const under = child("screen");
		const scope = await loadChain(scopeRecord, (message) => note("failed", message), under.scope);
		// One asked for after it won't be shown: nothing will be made there.
		if (wanted !== id) tutuca.leave(under.scope);
		else {
			unmount();
			mounted = { id, scope, child: under.name };
			remember(id);
			const where = chainOf(scopeRecord)
				.map((s) => s.name)
				.join(" / ");
			say(sayOnOpen ?? `${screen.name}, in ${where}`);
			sayOnOpen = null;
		}
		return { id, screen: { ...forStudio(screen.layout, editing), scope }, editing };
	},
	// The bar's toggle: sent to the screen shown, answered with what it'll be.
	toggleScreen: () => {
		if (!tutuca.state().shown) return false;
		const editing = tutuca.query("editing", [], { to: ["shown"] });
		queueMicrotask(() => tutuca.send("toggleEditing", [], { to: ["shown"] }));
		return !editing;
	},
	// A new screen starts with the default layout, opened edited.
	saveScreen: async ([id, name, scope, created]) => {
		const existing = lib.screens.get(id);
		if (!existing) fresh.add(id);
		const layout = structuredClone(DEFAULT_LAYOUT);
		await save("screens", { layout, ...existing, id, name, scope, created });
		return true;
	},
	deleteScreen: async ([id]) => {
		if (mounted?.id === id) {
			clearTimeout(pendingSave);
			unmount();
		}
		await remove("screens", id);
		return true;
	},
	saveScope: async ([id, name, parent]) => {
		await save("scopes", { id, name, parent, registrations: [] });
		return true;
	},
	confirm: ([text]) => confirm(text),
	exportLibrary: async () => {
		await keepLayout();
		exportBundle();
		return true;
	},
	exportComponents: () => exportComponents(),
	importLibrary: () =>
		new Promise((resolve) => {
			importing = resolve;
			importInput.click();
		}),
	editLayoutJson: ([id]) => {
		void showLayoutJson(id);
		return true;
	},
	// The layout's: a hole's new component, a slot's ✎ (the component in it, by the name it's
	// made by).
	createComponent: () => createComponent(),
	editComponent: (_args, { names }) => editComponent(names[0]),
});
// The screen's layout as it's kept, to read or change by hand.
async function showLayoutJson(id) {
	await keepLayout();
	const screen = lib.screens.get(id);
	const box = el("textarea", {
		class: UI.layoutJson,
		spellcheck: "false",
		"aria-label": "Layout (JSON)",
	});
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
			el(
				"div",
				{ class: UI.dialogActions },
				el("button", { class: UI.ghost, onclick: () => dialog.close() }, "Close"),
				apply,
			),
		),
	);
	dialog.setAttribute("aria-label", "Layout");
	dialog.showModal();
}

// One of choices ([value, label], the first the primary one), or null when
// the dialog is left with Cancel or Escape.
function choose(title, text, choices) {
	return new Promise((resolve) => {
		let chosen = null;
		const pick = (value) => () => {
			chosen = value;
			dialog.close();
		};
		dialog.addEventListener("close", () => resolve(chosen), { once: true });
		dialog.replaceChildren(
			el(
				"div",
				{ class: UI.dialogBox },
				el("h3", { class: UI.dialogTitle }, title),
				el("p", {}, text),
				el(
					"div",
					{ class: UI.dialogActions },
					el("button", { class: UI.ghost, onclick: pick(null) }, "Cancel"),
					...choices
						.toReversed()
						.map(([value, label], i) =>
							el(
								"button",
								{ class: i === choices.length - 1 ? UI.primary : UI.ghost, onclick: pick(value) },
								label,
							),
						),
				),
			),
		);
		dialog.setAttribute("aria-label", title);
		dialog.showModal();
	});
}

// ---- The editor ---------------------------------------------------------------------------

// While a component is written or edited, studio.tutuca.ts's Editor is the page;
// the screen stays in the studio's state, its hole or slot waiting for the
// answer to its ask. editing: { creating, resolve (that answer), scope (the
// screen's scope record), draft ({ id, name, source, build, chat }: what
// the last build was made from), state (the preview's, as last told),
// preview (the last preview's scope, below the base) }.
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
		tell("openEditor", creating, c.id, c.name, c.source, c.chat ?? []);
	});
}
function closeEditing(answer) {
	const { resolve, preview } = editing;
	if (preview) tutuca.leave([preview]);
	editing = null;
	resolve(answer);
}
// The hole's ask: a new component, from the starter. Answered with its name once it's
// registered, or "" when the editor is left without saving.
const createComponent = () =>
	openEditor(true, { id: newId(), name: freeName(STARTER.name), source: STARTER.source });
// A slot's ask: the component in it, by the name it's made by here. Only the library's
// components open; true once it's saved, false otherwise.
function editComponent(name) {
	const scope = lib.scopes.get(lib.screens.get(mounted.id).scope);
	const found = resolvesIn(scope).find((r) => r.name === name);
	if (!found || found.ref.startsWith(PREBUILT_PREFIX)) {
		say(`${name || "that"} comes with the studio: only components you made open in the editor`);
		return false;
	}
	return openEditor(false, lib.components.get(found.ref));
}
// Each type it registers, and whether a hole can make it: made with no fields, in a scope with
// only this module.
async function registersOf(c, b) {
	if (!b.ok) return [];
	const { scope } = child("probe");
	try {
		await tutuca.load(c.source, { scope, resolve: resolverOf(c) });
		return b.types.map((name) => {
			const { error } = tutuca.fits(name, {}, { scope });
			return error === ""
				? { name, ok: true, note: "a hole can make it" }
				: { name, ok: false, note: `a hole can't make it alone: ${error}` };
		});
	} finally {
		tutuca.leave(scope);
	}
}
// A diagnostic as the editor lists it; text is what the model reads, the
// lines it points at in sources (the draft's files by name) included, and
// whether it was there after the last build too (in seen, its key's).
const REPEATED =
	"\n  (this was there after your last change too, at the same line: what you changed didn't fix it; change what the line above shows)";
const diagnosticKey = (d, sources) =>
	`${d.code}|${d.message}|${sources[d.span.file]?.split("\n")[d.span.start.line - 1]?.trim() ?? ""}`;
const diagnosticRow = (d, sources, seen) => ({
	file: d.span.file,
	line: d.span.start.line,
	col: d.span.start.col,
	endLine: d.span.end.line,
	endCol: d.span.end.col,
	severity: d.severity,
	message: d.hint ? `${d.message} (${d.hint})` : d.message,
	text:
		diagnosticReport(d, sources) +
		(d.severity === "error" && seen.has(diagnosticKey(d, sources)) ? REPEATED : ""),
});

// The draft, as the editor has it now.
const draftAs = (id, name, source) => {
	if (editing?.draft.id !== id) throw new Error("that component isn't being edited");
	return Object.assign(editing.draft, { name, source });
};

// What the editor asks the page for.
Object.assign(asks, {
	build: async ([id, name, source]) => {
		const draft = draftAs(id, name, source);
		const b = await buildOf(draft);
		const registers = await registersOf(draft, b);
		// The errors of the build before, to tell the ones still there, and how many builds in a
		// row had only the same ones (stuck).
		const files = { [mainOf(name)]: source };
		const seen = editing.errors ?? new Set();
		const errors = new Set(b.diags.map((d) => diagnosticKey(d, files)));
		const same =
			errors.size > 0 && errors.size === seen.size && [...errors].every((k) => seen.has(k));
		editing.stuck = same ? (editing.stuck ?? 0) + 1 : 0;
		editing.errors = errors;
		return {
			ok: b.ok,
			status: b.ok
				? `built: registers ${b.types.join(", ")}`
				: "it didn't build: see the diagnostics",
			makeable: registers.filter((r) => r.ok).map(({ name }) => ({ name })),
			registers,
			diagnostics: b.diags.map((d) => diagnosticRow(d, files, seen)),
			stuck: editing.stuck,
		};
	},
	// In a scope inside the screen's chain, the module as last built, hiding a version of it
	// registered around; the type made there with no fields.
	preview: async ([id, type]) => {
		const { draft, scope: scopeRecord } = editing ?? {};
		if (draft?.id !== id || !draft.build?.ok) throw new Error("it doesn't build");
		const under = child("preview");
		if (editing.preview) tutuca.leave([editing.preview]);
		editing.preview = under.name;
		const fail = (message) => tellEditor("note", "failed", message);
		const around = await loadChain(scopeRecord, fail, under.scope);
		const scope = [...around, "preview"];
		await tutuca.load(draft.source, { scope, resolve: resolverOf(draft) });
		return { $make: type, scope, fields: {} };
	},
	// Kept, and registered in the screen's scope when it's new; an edited one's screen is made
	// again with it.
	saveComponent: async ([creating, id, name, source, chat]) => {
		if (
			!NAME.test(name) ||
			[...lib.components.values()].some((c) => c.id !== id && c.name === name)
		) {
			throw new Error(
				`a name is lowercase letters, digits and _, and unique in the library: ${name} isn't`,
			);
		}
		const draft = draftAs(id, name, source);
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
			.flatMap((r) =>
				(typesOf(r.component) ?? [])
					.filter((t) => b.types.includes(t))
					.map((t) => `${t} (${componentLabel(r.component)})`),
			);
		if (taken.length > 0) {
			const screen = lib.screens.get(mounted.id);
			const ask = `${taken.join(", ")} already made in ${scope.name}, for all its screens. Give ${screen.name} a scope of its own, under ${scope.name}, and register ${name} there?`;
			if (!creating || !confirm(ask)) {
				throw new Error(
					`${taken.join(", ")} already made in ${scope.name}: rename the component in ${name}.tutuca.ts, or make it in a scope of its own, where it hides ${scope.name}'s`,
				);
			}
			await keepLayout();
			const own = { id: newId(), name: screen.name, parent: scope.id, registrations: [] };
			await save("scopes", own);
			await save("screens", { ...lib.screens.get(screen.id), scope: own.id });
			tell("scopeAdded", own.id, own.name, own.parent);
			tell("screenMoved", screen.id, own.id);
			scope = editing.scope = own;
		}
		// An edited one other scopes register too changes for all of them, or
		// is saved as a copy registered here in its place, the others keeping
		// it as it was.
		const others =
			creating || !scope.registrations.some((r) => r.component === id)
				? []
				: [...lib.scopes.values()].filter(
						(s) => s !== scope && s.registrations.some((r) => r.component === id),
					);
		if (others.length > 0) {
			const was = lib.components.get(id).name;
			const where = others.map((s) => s.name).join(", ");
			const choice = await choose(
				`${was} is also in ${where}`,
				`Saved for all, ${where} change${others.length === 1 ? "s" : ""} with ${scope.name}. Saved as a copy, only ${scope.name} changes, and ${where} keep${others.length === 1 ? "s" : ""} ${was} as it was.`,
				[
					["copy", `Only ${scope.name}`],
					["all", "All of them"],
				],
			);
			if (choice === null) throw new Error("not saved");
			if (choice === "copy") {
				const copy = {
					id: newId(),
					name: name === was ? freeName(name) : name,
					source,
					uses: draft.uses,
					chat,
				};
				if (!(await buildOf(copy)).ok) throw new Error(`${copy.name}, the copy, doesn't build`);
				await save("components", copy);
				scope.registrations = scope.registrations.map((r) =>
					r.component === id ? { component: copy.id } : r,
				);
				await save("scopes", scope);
				say(`${copy.name} saved, registered in ${scope.name} in place of ${was}`);
				closeEditing(true);
				await keepLayout();
				tell("reopen");
				return "saved";
			}
		}
		await save("components", { id, name, source, uses: draft.uses, build: b, chat });
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
			await register(id, mounted.scope);
			closeEditing(name);
		} else {
			say(`${name} saved`);
			closeEditing(true);
			await keepLayout();
			tell("reopen");
		}
		return "saved";
	},
	// An example's source, asked first when it'd replace a changed one; a new component takes a
	// free name after it.
	example: async ([name, replacing]) => {
		if (replacing && !confirm(`Replace ${editing.draft.name}'s source with ${name}'s?`)) {
			return { ok: false, name: "", source: "" };
		}
		const source = await sources.read(EXAMPLES.get(name).source);
		return { ok: true, name: freeName(name), source };
	},
	leaveEditor: ([creating]) => {
		closeEditing(creating ? "" : false);
		return true;
	},
	// The assistant's: the model's turn, from the server (stopChat aborts it: answered "aborted").
	chat: async ([model, messages, name, source]) => {
		chatting?.abort();
		chatting = new AbortController();
		try {
			return await askChat(model, messages, { name, source }, chatting.signal);
		} catch (error) {
			if (error.name === "AbortError") throw new Error("aborted");
			throw error;
		} finally {
			chatting = null;
		}
	},
	stopChat: () => {
		chatting?.abort();
		return true;
	},
	prompt: ([name, source]) => askPrompt({ name, source }),
	rememberModel: ([model]) => {
		rememberModel(model);
		return true;
	},
	// The conversation kept with the component once it's in the library.
	keepChat: async ([id, messages]) => {
		if (editing?.draft.id === id) editing.draft.chat = messages;
		const c = lib.components.get(id);
		if (c) await save("components", { ...c, chat: messages });
		return true;
	},
});
let chatting = null; // the AbortController of the model's turn in flight
// The preview's state, told to the editor when it changed.
function tellPreviewState() {
	if (!editing) return;
	const preview = tutuca.state().editor?.preview;
	const state = preview ? JSON.stringify(preview, null, 2) : "";
	if (state === editing.state) return;
	editing.state = state;
	tellEditor("setState", state);
}

// ---- Export and import ---------------------------------------------------------------------

const download = (name, text, type) => {
	const href = URL.createObjectURL(new Blob([text], { type }));
	el("a", { href, download: name }).click();
	setTimeout(() => URL.revokeObjectURL(href), 1000);
};
const exportBundle = () =>
	download("tutuca-studio.json", JSON.stringify(toBundle(lib), null, 2), "application/json");
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
	if (files.some((f) => f.name.endsWith(".ts"))) return imported(await importModules(files));
	const file = files[0];
	if (!file) return imported(false);
	let records;
	try {
		records = fromBundle(JSON.parse(await file.text()));
	} catch (error) {
		say(`can't import ${file.name}: ${error.message}`);
		return imported(false);
	}
	const replaced = Object.entries(records).flatMap(([kind, rs]) =>
		rs.filter((r) => lib[kind].has(r.id) && kind !== "scopes").map((r) => r.name),
	);
	if (replaced.length > 0 && !confirm(`Importing replaces ${replaced.join(", ")}. Go on?`))
		return imported(false);
	await keepLayout();
	const shown = mounted?.id;
	unmount();
	for (const [kind, rs] of Object.entries(records)) for (const r of rs) await store.put(kind, r);
	lib = await store.load();
	tell("setLibrary", scopeRows(), screenRows());
	const next = lib.screens.get(shown) ?? screensInOrder()[0];
	if (next) tell("showScreen", next.id);
	say(
		`imported ${Object.values(records).reduce((n, rs) => n + rs.length, 0)} records from ${file.name}`,
	);
	imported(true);
});

// ---- Components as modules -----------------------------------------------------------------

// A component of the library is its module, name.tutuca.ts: exported, it's that file; imported
// into another library, it's a component there, registered in the shown screen's scope like one
// made there.

// The library's components the shown screen's scope chain registers, each as its module.
function exportComponents() {
	if (!mounted) return false;
	const chain = chainOf(lib.scopes.get(lib.screens.get(mounted.id).scope));
	const refs = chain.flatMap((s) => s.registrations.map((r) => r.component));
	const own = [...new Set(refs)].filter((ref) => !ref.startsWith(PREBUILT_PREFIX));
	if (own.length === 0) {
		say("this screen's scopes register none of your components: only those export");
		return false;
	}
	const names = own.map((ref) => {
		const c = lib.components.get(ref);
		download(mainOf(c.name), c.source, "text/plain");
		return mainOf(c.name);
	});
	say(`exported ${names.join(", ")}`);
	return true;
}
// What a module's file is as a component of the library, or why it can't be.
async function componentOf(file) {
	const source = await file.text();
	const same = [...lib.components.values()].find((c) => c.source === source);
	const named = file.name.replace(/\.tutuca\.ts$/, "").replace(/[^a-z0-9_]/g, "_");
	const name = NAME.test(named) ? named : "component";
	const c = same ?? { id: newId(), name: freeName(name), source, chat: [] };
	const build = await buildOf(c);
	if (!build.ok) {
		const first = build.diags[0];
		throw new Error(`it doesn't build: ${first?.message ?? "see it in the editor"}`);
	}
	return c;
}
// Why modules can't be imported now, or null when they can.
const cantImport = () => {
	if (editing)
		return "leave the editor first: imported components are registered in the screen's scope";
	if (!mounted) return "open a screen first: imported components are registered in its scope";
	return null;
};
// The modules' files, kept and registered in the shown screen's scope, which is made again
// with them. Each outcome is a toast and an event, and the bar keeps what was imported.
async function importModules(files) {
	const why = cantImport();
	if (why) {
		toast("error", "Nothing imported", [why]);
		say(why);
		return false;
	}
	const scope = lib.scopes.get(lib.screens.get(mounted.id).scope);
	const added = [];
	const failed = [];
	const fail = (file, reason) => {
		failed.push(`${file.name}: ${reason}`);
		note("failed", `can't import ${file.name}: ${reason}`);
	};
	for (const file of files) {
		if (!file.name.endsWith(".tutuca.ts")) {
			fail(
				file,
				"only components' .tutuca.ts modules import here (a bundle's .json goes through ⋯ → Import)",
			);
			continue;
		}
		let c;
		try {
			c = await componentOf(file);
		} catch (error) {
			fail(file, error.message);
			continue;
		}
		const taken = scope.registrations
			.filter((r) => r.component !== c.id)
			.flatMap((r) =>
				(typesOf(r.component) ?? [])
					.filter((t) => c.build.types.includes(t))
					.map((t) => `${t} (${componentLabel(r.component)})`),
			);
		if (taken.length > 0) {
			fail(
				file,
				`${taken.join(", ")} already made in ${scope.name}; import it in a scope of its own, where it hides ${scope.name}'s`,
			);
			continue;
		}
		await save("components", c);
		if (!scope.registrations.some((r) => r.component === c.id)) {
			scope.registrations.push({ component: c.id });
		}
		added.push(c);
	}
	if (failed.length > 0) {
		toast(
			"error",
			added.length === 0 ? "Nothing imported" : `${failed.length} not imported`,
			failed,
		);
	}
	if (added.length === 0) {
		say(`nothing imported: ${failed.join("; ")}`);
		return false;
	}
	await keepLayout();
	await save("scopes", scope);
	const lines = added.map((c) => `${c.name}: ${c.build.types.join(", ")}`);
	toast("success", `Imported into ${scope.name}`, lines);
	const said = `imported into ${scope.name}: ${lines.join(", ")}`;
	note("info", said);
	sayOnOpen = said;
	tell("reopen");
	return true;
}
// Files dropped anywhere on the page are taken, never opened by the browser: imported into the
// shown screen's scope when they can be, a toast saying why not otherwise. A drag from inside
// the page (a layout's) carries no files.
const dragsFiles = (e) => e.dataTransfer?.types.includes("Files");
const markDropping = (on) => {
	for (const c of UI.dropping.split(" ")) studioRoot.classList.toggle(c, on);
};
document.addEventListener("dragover", (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	// Still a copy when it can't import now: dropped, a toast says why.
	e.dataTransfer.dropEffect = "copy";
	markDropping(!cantImport());
});
document.addEventListener("dragleave", (e) => {
	if (dragsFiles(e) && !e.relatedTarget) markDropping(false);
});
document.addEventListener("drop", (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	markDropping(false);
	void importModules([...e.dataTransfer.files]);
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
// What the runtime reported since the last time, as the studio's events: the preview's
// components are the editor's to show (at editor.preview), the rest the studio's, with where
// they are.
let seenReports = 0;
function tellReports() {
	const reports = tutuca.reports();
	for (const r of reports.slice(seenReports)) {
		const lines = [];
		for (const log of r.logs ?? []) lines.push(["log", JSON.stringify(log)]);
		// An ask's answer nobody waits for isn't worth a line.
		const isAnswer = /\.(ok|error|unhandled)$/.test(r.name ?? "");
		if (r.outcome === "unhandled" && !isAnswer) lines.push(["info", `unhandled ${r.name}`]);
		if (r.outcome === "failed" || r.type === "renderFailed") {
			lines.push(["failed", r.error ?? `${r.name} failed`]);
		}
		for (const issue of r.issues ?? []) lines.push(["issue", JSON.stringify(issue)]);
		const at = r.at ?? [];
		const fromPreview = at[0] === "editor" && at[1] === "preview";
		for (const [kind, text] of lines) {
			if (fromPreview) tellEditor("note", kind, text);
			else note(kind, at.length > 0 ? `${text} (at ${at.join(".")})` : text);
		}
	}
	seenReports = reports.length;
}
tutuca.start(
	"Studio",
	{
		scopes: scopeRows(),
		screens: screenRows(),
		models: byProvider,
		model,
		examples: [...EXAMPLES.keys()].map((name) => ({ name })),
	},
	{ scope: STUDIO },
);
started = true;
tutuca.mount();
// After every change of what the studio shows.
new MutationObserver(() => {
	autofocus();
	tellReports();
	tellPreviewState();
	keepLayoutSoon();
}).observe(studioRoot, { childList: true, subtree: true, attributes: true, characterData: true });
const first = lib.screens.get(remembered()) ?? screensInOrder()[0];
if (first) tell("showScreen", first.id);

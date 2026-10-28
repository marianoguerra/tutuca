// The studio: components written as in the playground and kept in a library
// (IndexedDB, store.js), a tree of scopes each registering components under
// names picked here, and screens: a layout made in a scope, composed by
// filling its holes with what that scope can make, and kept as what to make
// (js/hydrate.js's capture), not as state. Opening a screen makes its scope
// chain from scratch, loads each scope's registrations into it (built again
// only when the sources or tcd changed), and mounts the layout on a dev host.
// Served with an API (scripts/studio-server.mjs), the editor also has an
// assistant (assistant.js): a model that edits the component, its changes
// built and its errors sent back to it.
import { defineRating } from "../components/media/rating.js";
import { capture, hydrate } from "../js/hydrate.js";
import { compilerClient, el, pageStyles } from "../js/page.js";
import { snapshot } from "../js/pbt.js";
import { load, readBytes } from "../js/tutuca-rt.js";
import { createEditor } from "../playground/deps/editor.js";
import { EXAMPLES } from "../playground/examples.js";
import { assistantPanel, checkServer, diagnosticText } from "./assistant.js";
import { fromBundle, openStore, toBundle } from "./store.js";

const UI = {
	body: "bg-base-200 text-base-content min-h-screen",
	app: "max-w-[1600px] mx-auto p-3 flex flex-col gap-3",
	header: "flex flex-wrap items-center gap-3",
	title: "text-xl font-bold",
	lead: "text-sm opacity-70 max-w-prose",
	link: "link link-primary text-sm",
	toolbar: "flex flex-wrap items-center gap-2",
	tabs: "st-tabs join",
	tab: "st-tab btn btn-sm join-item",
	tabOn: "st-tab btn btn-sm btn-primary join-item",
	button: "btn btn-sm",
	primary: "btn btn-sm btn-primary",
	danger: "btn btn-sm btn-ghost text-error",
	small: "btn btn-xs",
	status: "st-status text-sm opacity-70",
	columns: "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]",
	panel: "card card-border bg-base-100 p-2 gap-2 min-w-0",
	list: "flex flex-col gap-1",
	item: "st-item btn btn-sm btn-ghost justify-start font-mono",
	itemOn: "st-item btn btn-sm btn-active justify-start font-mono",
	input: "input input-sm",
	select: "select select-sm",
	label: "text-xs uppercase tracking-wide opacity-60",
	row: "flex flex-wrap items-center gap-2",
	fileTabs: "flex flex-wrap gap-1",
	fileTab: "btn btn-xs btn-ghost font-mono",
	fileTabOn: "btn btn-xs btn-active font-mono",
	editor: "st-editor h-[55vh] border border-base-300 rounded-box overflow-hidden",
	diags: "st-diagnostics font-mono text-xs max-h-40 overflow-auto flex flex-col",
	diag: "text-left px-2 py-1 border-b border-base-300 hover:bg-base-200 cursor-pointer",
	error: "text-error font-semibold",
	warning: "text-warning font-semibold",
	note: "text-info font-semibold",
	table: "table table-sm",
	ok: "text-success",
	bad: "text-error",
	layout: "st-layout textarea textarea-sm font-mono text-xs w-full h-40",
	stage: "st-stage rounded-box border border-dashed border-base-300 p-3 min-h-24 overflow-auto",
	events: "st-events font-mono text-xs max-h-48 overflow-auto flex flex-col",
	event: "py-0.5 border-b border-base-300",
	log: "text-success",
	issue: "text-warning",
	failed: "st-failed text-error",
	info: "opacity-70",
	work: "flex flex-col gap-2 xl:flex-row",
	chat: "st-chat flex flex-col gap-2 xl:w-[28rem] shrink-0 rounded-box border border-base-300 p-2",
	chatLog: "st-chat-log flex flex-col gap-2 overflow-auto max-h-[50vh] min-h-24 text-sm",
	chatInput: "st-chat-input textarea textarea-sm w-full h-20",
	chatPrompt: "font-mono text-xs whitespace-pre-wrap max-h-64 overflow-auto",
	chatUser: "st-chat-user self-end max-w-[90%] rounded-box bg-primary/10 px-3 py-2 whitespace-pre-wrap",
	chatAssistant: "st-chat-assistant max-w-[90%] rounded-box bg-base-200 px-3 py-2 whitespace-pre-wrap",
	chatTool: "st-chat-tool text-xs font-mono opacity-70",
	chatOk: "st-chat-ok text-xs text-success",
	chatError: "st-chat-error text-xs text-error",
	badge: "st-assistant badge badge-ghost badge-sm",
};

const styles = await pageStyles(Object.values(UI));
document.body.className = UI.body;
defineRating();
const tw = await load(new URL("../dist/tutuca-rt.wasm", import.meta.url));
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

// ---- The library ---------------------------------------------------------------------------

let lib = await store.load();
const ROOT = "root";
// A new library: a root scope with the layouts, so a first screen has holes.
if (!lib.scopes.has(ROOT)) {
	const root = { id: ROOT, name: "root", parent: null, registrations: [{ component: `${PREBUILT_PREFIX}layout`, names: {} }] };
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

const componentLabel = (ref) => (ref.startsWith(PREBUILT_PREFIX) ? `${ref.slice(PREBUILT_PREFIX.length)} (prebuilt)` : (lib.components.get(ref)?.name ?? "(deleted)"));
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
// once, an inner registration hiding an outer one. [{ name, scope, ref, as }].
const resolvesIn = (scope) => {
	const found = new Map();
	for (const s of chainOf(scope).reverse()) {
		for (const { component, names } of s.registrations) {
			for (const as of typesOf(component) ?? []) {
				const name = Object.hasOwn(names, as) ? names[as] : as;
				if (name !== null && !found.has(name)) found.set(name, { name, scope: s, ref: component, as });
			}
		}
	}
	return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
};

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
		const text = own ? own.tcd : prebuilt.has(name) ? await prebuiltTcd(name) : null;
		if (text === null) continue; // tcd reports it
		files[path] = text;
		await usedFiles(text, files);
	}
	return files;
}
const requestFor = async (c) => {
	const main = `${c.name}.tcd`;
	return { main, files: { ...(await usedFiles(c.tcd)), [main]: c.tcd }, impls: [{ path: `${c.name}.wax`, text: c.wax }] };
};

// The component's build, built again only when what it's built from (the
// request and tcd itself) changed since the last one.
async function buildOf(c) {
	const request = await requestFor(c);
	const key = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([await version(), request]))));
	if (c.build?.key === key) return c.build;
	const res = await compiler("build", request);
	c.build = { key, ok: res.ok, wasm: res.ok ? res.wasm : null, types: res.types ?? [], diags: res.diags ?? [] };
	await save("components", c);
	return c.build;
}
const wasmOf = async (ref) => {
	if (ref.startsWith(PREBUILT_PREFIX)) return prebuilt.get(ref.slice(PREBUILT_PREFIX.length)).wasm;
	const c = lib.components.get(ref);
	if (!c) throw new Error("its component was deleted");
	const build = await buildOf(c);
	if (!build.ok) throw new Error(`${c.name} doesn't build: see its diagnostics`);
	return build.wasm;
};

// ---- The page ------------------------------------------------------------------------------

const app = document.querySelector("#app");
app.className = UI.app;
app.textContent = "";
const status = el("span", { class: UI.status });
const say = (text) => {
	status.textContent = text;
};
const tabBar = el("div", { class: UI.tabs, role: "tablist" });
const importInput = el("input", { type: "file", accept: ".json,application/json", class: "hidden", "aria-label": "Import a bundle" });
const exportButton = el("button", { class: UI.button, title: "Download the library as a bundle" }, "Export");
const importButton = el("button", { class: UI.button, title: "Add a bundle's components, scopes and screens" }, "Import");
const main = el("div");
app.append(
	el(
		"header",
		{ class: UI.header },
		el("h1", { class: UI.title }, "tutuca-wax studio"),
		el("a", { class: UI.link, href: "../playground/" }, "playground"),
		el("a", { class: UI.link, href: "../demos/" }, "demos"),
		server?.assistant ? el("span", { class: UI.badge, title: "Served with an LLM assistant: open it from a component's editor" }, `assistant: ${server.models.length} model${server.models.length === 1 ? "" : "s"}`) : null,
	),
	el(
		"p",
		{ class: UI.lead },
		"Write components and keep them; register them in scopes under the names you pick; then make screens in a scope, filling a layout's holes with what that scope can make. Everything stays in this browser; export a bundle to take it elsewhere.",
	),
	el("div", { class: UI.toolbar }, tabBar, exportButton, importButton, importInput, status),
	main,
);

const TABS = { components: "Components", scopes: "Scopes", screens: "Screens" };
let tab = "components";
const show = (next) => {
	tab = next;
	tabBar.textContent = "";
	for (const [id, label] of Object.entries(TABS)) {
		tabBar.append(el("button", { class: id === tab ? UI.tabOn : UI.tab, role: "tab", onclick: () => show(id) }, label));
	}
	for (const [id, view] of Object.entries(views)) view.root.hidden = id !== tab;
	views[tab].render();
};

// ---- Components ----------------------------------------------------------------------------

const NAME = /^[a-z][a-z0-9_]*$/;
const freeName = (base) => {
	const taken = new Set([...lib.components.values()].map((c) => c.name));
	let name = base;
	for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
	return name;
};
// A playground example's sources, its uses of ../x/x.tcd made x.tcd, the
// library's flat paths.
const starterSources = async (ex) => {
	const text = async (path) => ex.sources?.[path] ?? new TextDecoder().decode(await readBytes(new URL(`../${path}`, import.meta.url)));
	const tcd = (await text(ex.main)).replace(/\buse\s+"\.\.\/(\w+)\/\1\.tcd"/g, 'use "$1.tcd"');
	return { tcd, wax: await text(ex.impl) };
};

const componentsView = (() => {
	const root = el("div", { class: UI.columns });
	const list = el("div", { class: UI.list });
	const starter = el("select", { class: UI.select, "aria-label": "Starter" });
	for (const ex of EXAMPLES) starter.append(el("option", { value: ex.id }, ex.title));
	const newButton = el("button", { class: UI.primary }, "New component");
	const title = el("input", { class: UI.input, "aria-label": "Component name" });
	const buildButton = el("button", { class: UI.primary, title: "Ctrl/Cmd-Enter" }, "Build");
	const deleteButton = el("button", { class: UI.danger }, "Delete");
	const assistantButton = el("button", { class: UI.button, title: "Ask a model to change this component" }, "Assistant");
	assistantButton.hidden = !server?.assistant;
	const fileTabs = el("div", { class: UI.fileTabs });
	const editorBox = el("div", { class: UI.editor });
	const diagList = el("div", { class: UI.diags });
	const typesBox = el("div");
	const work = el("div", { class: UI.work }, el("div", { class: "flex-1 min-w-0" }, editorBox));
	const detail = el(
		"section",
		{ class: UI.panel },
		el("div", { class: UI.row }, title, buildButton, assistantButton, deleteButton),
		fileTabs,
		work,
		el("p", { class: UI.label }, "diagnostics"),
		diagList,
		el("p", { class: UI.label }, "what it registers"),
		typesBox,
	);
	root.append(el("section", { class: UI.panel }, el("div", { class: UI.row }, starter, newButton), el("p", { class: UI.label }, "library"), list), detail);
	let selected = null;
	const editor = createEditor(editorBox, {
		onRun: () => build(),
		onChange: () => keepSources(),
	});
	const keepSources = () => {
		if (!selected) return;
		selected.tcd = editor.text(`${selected.name}.tcd`);
		selected.wax = editor.text(`${selected.name}.wax`);
		save("components", selected);
	};
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
	const renderTypes = async () => {
		typesBox.textContent = "";
		const build = selected?.build;
		if (!build?.ok) {
			typesBox.append(el("span", { class: UI.info }, build ? "it doesn't build" : "not built yet"));
			return;
		}
		const scope = runtime.scope();
		await tw.loadComponent(build.wasm.slice(), scope);
		const rows = build.types.map((t) => {
			let made = "a hole can make it";
			let ok = true;
			try {
				runtime.make(scope, t, {});
			} catch (error) {
				made = `a hole can't make it alone: ${error.message}`;
				ok = false;
			}
			return el("tr", {}, el("td", { class: "font-mono" }, t), el("td", { class: ok ? UI.ok : UI.bad }, made));
		});
		typesBox.append(el("table", { class: UI.table }, el("tbody", {}, ...rows)));
	};
	const open = (c) => {
		selected = c;
		for (const name of editor.names()) editor.remove(name);
		detail.hidden = !c;
		if (!c) return;
		title.value = c.name;
		editor.open(`${c.name}.tcd`, c.tcd, { lang: "tcd" });
		editor.open(`${c.name}.wax`, c.wax, { lang: "wax" });
		editor.show(`${c.name}.tcd`);
		renderFileTabs();
		renderDiagnostics(c.build?.diags ?? []);
		renderTypes();
		renderList();
		assistant?.render();
	};
	const renderList = () => {
		list.textContent = "";
		const all = [...lib.components.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
		for (const c of all) list.append(el("button", { class: c === selected ? UI.itemOn : UI.item, onclick: () => open(c) }, c.name));
		if (all.length === 0) list.append(el("span", { class: UI.info }, "nothing yet: start one from a starter"));
	};
	async function build() {
		if (!selected) return null;
		keepSources();
		say(`building ${selected.name}…`);
		try {
			const b = await buildOf(selected);
			say(b.ok ? `${selected.name} built: ${b.wasm.length} bytes, registers ${b.types.join(", ")}` : `${selected.name} didn't build: see the diagnostics`);
			renderDiagnostics(b.diags);
			await renderTypes();
			return b;
		} catch (error) {
			say(`the compiler failed: ${error.message}`);
			return null;
		}
	}
	// What the assistant is told of a build: the types it registers, or
	// tcd's diagnostics and the signatures of the functions still missing.
	async function check() {
		const c = selected;
		const b = await build();
		if (!b) return { ok: false, text: "The compiler failed; nothing was built." };
		const warnings = b.diags.filter((d) => d.severity !== "error").map(diagnosticText);
		if (b.ok) {
			const notes = warnings.length > 0 ? `\nWarnings:\n${warnings.join("\n")}` : "";
			return { ok: true, text: `It built: ${c.name} registers ${b.types.join(", ")}.${notes}` };
		}
		let text = `It didn't build. tcd's diagnostics:\n${b.diags.map(diagnosticText).join("\n")}`;
		try {
			const stub = await compiler("stub", await requestFor(c));
			if (stub.ok && stub.stub.trim()) text += `\n\nThe functions the .wax is missing, with the signatures it must have:\n${stub.stub}`;
		} catch {}
		return { ok: false, text };
	}
	const assistant = server?.assistant
		? assistantPanel({
				server,
				UI,
				component: () => selected,
				write: async ({ tcd, wax }) => {
					if (!selected) return;
					if (typeof tcd === "string") selected.tcd = tcd;
					if (typeof wax === "string") selected.wax = wax;
					await save("components", selected);
					open(selected);
				},
				check,
				keep: (c) => save("components", c),
			})
		: null;
	if (assistant) {
		work.append(assistant.root);
		assistantButton.addEventListener("click", () => {
			assistantButton.className = assistant.toggle() ? UI.primary : UI.button;
		});
	}
	newButton.addEventListener("click", async () => {
		const ex = EXAMPLES.find((e) => e.id === starter.value);
		const c = { id: newId(), name: freeName(ex.main.split("/").pop().replace(/\.tcd$/, "")), ...(await starterSources(ex)) };
		await save("components", c);
		open(c);
		await build();
	});
	buildButton.addEventListener("click", () => build());
	title.addEventListener("change", async () => {
		const name = title.value.trim();
		if (!NAME.test(name) || [...lib.components.values()].some((c) => c !== selected && c.name === name)) {
			say(`a name is snake_case and unique in the library: ${name} isn't`);
			title.value = selected.name;
			return;
		}
		keepSources();
		selected.name = name;
		await save("components", selected);
		open(selected);
	});
	deleteButton.addEventListener("click", async () => {
		const users = [...lib.scopes.values()].filter((s) => s.registrations.some((r) => r.component === selected.id));
		if (users.length > 0) {
			say(`${selected.name} is registered in ${users.map((s) => s.name).join(", ")}: remove it there first`);
			return;
		}
		await remove("components", selected.id);
		open(null);
	});
	return {
		root,
		render: () => {
			renderList();
			if (!selected) open([...lib.components.values()][0] ?? null);
		},
		open,
	};
})();

// ---- Scopes --------------------------------------------------------------------------------

const scopesView = (() => {
	const root = el("div", { class: UI.columns });
	const tree = el("div", { class: UI.list });
	const detail = el("section", { class: UI.panel });
	root.append(el("section", { class: UI.panel }, el("p", { class: UI.label }, "scopes"), tree), detail);
	let selected = lib.scopes.get(ROOT);
	const renderTree = () => {
		tree.textContent = "";
		const walk = (s, depth) => {
			tree.append(el("button", { class: s === selected ? UI.itemOn : UI.item, style: `padding-left: ${0.75 + depth}rem`, onclick: () => pick(s) }, s.name));
			for (const child of [...lib.scopes.values()].filter((c) => c.parent === s.id)) walk(child, depth + 1);
		};
		walk(lib.scopes.get(ROOT), 0);
	};
	const pick = (s) => {
		selected = s;
		render();
	};
	const renderDetail = () => {
		const s = selected;
		detail.textContent = "";
		const name = el("input", { class: UI.input, value: s.name, "aria-label": "Scope name" });
		name.disabled = s.id === ROOT;
		name.addEventListener("change", async () => {
			s.name = name.value.trim() || s.name;
			await save("scopes", s);
			render();
		});
		const childName = el("input", { class: UI.input, placeholder: "child scope's name", "aria-label": "Child scope name" });
		const addChild = el("button", { class: UI.button }, "Add child");
		addChild.addEventListener("click", async () => {
			const child = { id: newId(), name: childName.value.trim() || "scope", parent: s.id, registrations: [] };
			await save("scopes", child);
			pick(child);
		});
		const del = el("button", { class: UI.danger }, "Delete");
		del.hidden = s.id === ROOT;
		del.addEventListener("click", async () => {
			const children = [...lib.scopes.values()].some((c) => c.parent === s.id);
			const screens = [...lib.screens.values()].filter((sc) => sc.scope === s.id);
			if (children || screens.length > 0) {
				say(`${s.name} has ${children ? "child scopes" : `screens (${screens.map((sc) => sc.name).join(", ")})`}: delete them first`);
				return;
			}
			await remove("scopes", s.id);
			pick(lib.scopes.get(s.parent));
		});
		// Its registrations, each type of each with the name it goes by here.
		const regs = el("div", { class: "flex flex-col gap-2" });
		s.registrations.forEach((reg, i) => {
			const types = typesOf(reg.component);
			const header = el(
				"div",
				{ class: UI.row },
				el("span", { class: "font-mono font-semibold" }, componentLabel(reg.component)),
				el(
					"button",
					{
						class: UI.small,
						onclick: async () => {
							s.registrations.splice(i, 1);
							await save("scopes", s);
							render();
						},
					},
					"remove",
				),
			);
			const rows = (types ?? []).map((as) => {
				const value = Object.hasOwn(reg.names, as) ? (reg.names[as] ?? "") : as;
				const input = el("input", { class: `st-name ${UI.input}`, value, placeholder: "left out", "aria-label": `${as}'s name here` });
				input.addEventListener("change", async () => {
					const v = input.value.trim();
					if (v === as) delete reg.names[as];
					else reg.names[as] = v === "" ? null : v;
					await save("scopes", s);
					render();
				});
				return el("tr", {}, el("td", { class: "font-mono" }, as), el("td", {}, input));
			});
			regs.append(
				el(
					"div",
					{ class: "st-registration rounded-box border border-base-300 p-2" },
					header,
					types === null ? el("span", { class: UI.info }, "build it to see what it registers") : el("table", { class: UI.table }, el("tbody", {}, ...rows)),
				),
			);
		});
		const choose = el("select", { class: UI.select, "aria-label": "Component to register" });
		for (const c of lib.components.values()) choose.append(el("option", { value: c.id }, c.name));
		for (const name of PREBUILT) choose.append(el("option", { value: `${PREBUILT_PREFIX}${name}` }, `${name} (prebuilt)`));
		const register = el("button", { class: UI.button }, "Register");
		register.addEventListener("click", async () => {
			s.registrations.push({ component: choose.value, names: {} });
			await save("scopes", s);
			render();
		});
		const resolved = resolvesIn(s).map((r) =>
			el("tr", {}, el("td", { class: "font-mono" }, r.name), el("td", { class: UI.info }, `${componentLabel(r.ref)}'s ${r.as}${r.scope === s ? "" : `, from ${r.scope.name}`}`)),
		);
		detail.append(
			el("div", { class: UI.row }, name, del),
			el("div", { class: UI.row }, childName, addChild),
			el("p", { class: UI.label }, "registered here"),
			regs,
			el("div", { class: UI.row }, choose, register),
			el("p", { class: UI.label }, "what its holes offer (the names made here, its parents' included)"),
			el("table", { class: `st-resolves ${UI.table}` }, el("tbody", {}, ...resolved)),
		);
	};
	const render = () => {
		if (!lib.scopes.has(selected?.id)) selected = lib.scopes.get(ROOT);
		renderTree();
		renderDetail();
	};
	return { root, render };
})();

// ---- Screens -------------------------------------------------------------------------------

// A screen starts as a Vbox holding a hole, in a Screen to toggle editing it.
const DEFAULT_LAYOUT = { $make: "Screen", fields: { content: { $make: "Vbox", fields: { items: [{ $make: "Hole" }] } } } };

const screensView = (() => {
	const root = el("div", { class: UI.columns });
	const list = el("div", { class: UI.list });
	const newName = el("input", { class: UI.input, placeholder: "screen's name", "aria-label": "Screen name" });
	const newButton = el("button", { class: UI.primary }, "New screen");
	const detail = el("section", { class: UI.panel });
	const stage = el("div", { class: UI.stage });
	const events = el("div", { class: UI.events });
	root.append(el("section", { class: UI.panel }, el("div", { class: UI.row }, newName, newButton), el("p", { class: UI.label }, "screens"), list), detail);
	let selected = null;
	let mounted = null; // { screen, scope, host }

	const note = (kind, text) => events.prepend(el("div", { class: `${UI.event} ${UI[kind] ?? ""}` }, `${new Date().toLocaleTimeString()} ${kind}: ${text}`));

	// The screen's scope chain made from scratch, each scope's registrations
	// loaded into it, and its layout mounted there on a dev host.
	async function openScreen(screen) {
		mounted?.host.unmount();
		mounted = null;
		stage.replaceChildren();
		events.textContent = "";
		const chain = chainOf(lib.scopes.get(screen.scope));
		let scope = null;
		for (const s of chain) {
			scope = scope === null ? runtime.scope() : runtime.enter(scope, s.id);
			for (const reg of s.registrations) {
				try {
					const loaded = await tw.loadComponent((await wasmOf(reg.component)).slice(), scope, { names: reg.names });
					styles.add(loaded.classes);
				} catch (error) {
					note("failed", `${s.name}: can't register ${componentLabel(reg.component)}: ${error.message}`);
				}
			}
		}
		try {
			const host = runtime.createHost(document, stage, hydrate(runtime, scope, screen.layout), { dev: true });
			const seen = { logs: 0, unhandled: 0, failures: 0, issues: 0 };
			const run = host.run.bind(host);
			host.run = () => {
				run();
				for (const v of host.logs.slice(seen.logs)) note("log", JSON.stringify(snapshot(runtime, v)));
				for (const n of host.unhandled.slice(seen.unhandled)) note("info", `unhandled ${n}`);
				for (const e of host.failures.slice(seen.failures)) note("failed", e.message);
				for (const i of host.issues.slice(seen.issues)) note("issue", JSON.stringify(i));
				Object.assign(seen, { logs: host.logs.length, unhandled: host.unhandled.length, failures: host.failures.length, issues: host.issues.length });
			};
			host.mount();
			mounted = { screen, scope, host };
			say(`${screen.name} open in ${chain.map((s) => s.name).join(" / ")}`);
		} catch (error) {
			note("failed", `can't make ${screen.name}'s layout: ${error.message}`);
		}
	}

	const renderDetail = () => {
		detail.textContent = "";
		const screen = selected;
		if (!screen) {
			detail.append(el("span", { class: UI.info }, "no screen selected"));
			return;
		}
		const name = el("input", { class: UI.input, value: screen.name, "aria-label": "Screen name" });
		name.addEventListener("change", async () => {
			screen.name = name.value.trim() || screen.name;
			await save("screens", screen);
			renderList();
		});
		const scopeSelect = el("select", { class: UI.select, "aria-label": "Scope" });
		for (const s of lib.scopes.values()) scopeSelect.append(el("option", { value: s.id }, chainOf(s).map((x) => x.name).join(" / ")));
		scopeSelect.value = screen.scope;
		scopeSelect.addEventListener("change", async () => {
			screen.scope = scopeSelect.value;
			await save("screens", screen);
			await openScreen(screen);
		});
		const layoutBox = el("textarea", { class: UI.layout, spellcheck: "false", "aria-label": "Layout (JSON)" });
		layoutBox.value = JSON.stringify(screen.layout, null, 2);
		const openButton = el("button", { class: UI.button, title: "Make it again from what's kept" }, "Reopen");
		openButton.addEventListener("click", () => openScreen(screen));
		const keepButton = el("button", { class: UI.primary, title: "Keep the layout as it is now" }, "Save layout");
		keepButton.addEventListener("click", async () => {
			if (mounted?.screen !== screen) return;
			try {
				screen.layout = capture(runtime, mounted.scope, mounted.host.root());
			} catch (error) {
				say(`can't keep this layout: ${error.message}`);
				return;
			}
			await save("screens", screen);
			layoutBox.value = JSON.stringify(screen.layout, null, 2);
			say(`${screen.name}'s layout saved`);
		});
		const applyButton = el("button", { class: UI.button, title: "Keep the JSON above and reopen" }, "Apply JSON");
		applyButton.addEventListener("click", async () => {
			try {
				screen.layout = JSON.parse(layoutBox.value);
			} catch (error) {
				say(`not JSON: ${error.message}`);
				return;
			}
			await save("screens", screen);
			await openScreen(screen);
		});
		const del = el("button", { class: UI.danger }, "Delete");
		del.addEventListener("click", async () => {
			mounted?.host.unmount();
			mounted = null;
			await remove("screens", screen.id);
			selected = null;
			render();
		});
		detail.append(
			el("div", { class: UI.row }, name, scopeSelect, openButton, keepButton, del),
			stage,
			el("p", { class: UI.label }, "events"),
			events,
			el("details", {}, el("summary", { class: UI.label }, "layout as kept (JSON)"), layoutBox, el("div", { class: UI.row }, applyButton)),
		);
	};
	const pick = async (screen) => {
		selected = screen;
		renderList();
		renderDetail();
		if (screen) await openScreen(screen);
	};
	const renderList = () => {
		list.textContent = "";
		for (const s of lib.screens.values()) list.append(el("button", { class: s === selected ? UI.itemOn : UI.item, onclick: () => pick(s) }, s.name));
		if (lib.screens.size === 0) list.append(el("span", { class: UI.info }, "nothing yet"));
	};
	newButton.addEventListener("click", async () => {
		const screen = { id: newId(), name: newName.value.trim() || `screen ${lib.screens.size + 1}`, scope: ROOT, layout: structuredClone(DEFAULT_LAYOUT) };
		newName.value = "";
		await save("screens", screen);
		await pick(screen);
	});
	const render = () => {
		if (selected && !lib.screens.has(selected.id)) selected = null;
		renderList();
		if (!mounted || mounted.screen !== selected) renderDetail();
	};
	return { root, render, pick };
})();

const views = { components: componentsView, scopes: scopesView, screens: screensView };
for (const view of Object.values(views)) main.append(view.root);

// ---- Export and import ---------------------------------------------------------------------

exportButton.addEventListener("click", () => {
	const blob = new Blob([JSON.stringify(toBundle(lib), null, 2)], { type: "application/json" });
	const a = el("a", { href: URL.createObjectURL(blob), download: "tutuca-wax-studio.json" });
	a.click();
	URL.revokeObjectURL(a.href);
});
importButton.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
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
	for (const [kind, rs] of Object.entries(records)) for (const r of rs) await store.put(kind, r);
	lib = await store.load();
	say(`imported ${Object.values(records).reduce((n, rs) => n + rs.length, 0)} records from ${file.name}`);
	show(tab);
});

show("components");

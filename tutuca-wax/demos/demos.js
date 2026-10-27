// The demos page: loads the runtime, then the example component modules
// (dist/components/*.wasm) into a scope, and mounts each demo in its own
// host, with a panel that shows the root's state and what the host observed
// after every run. The first demo loads its modules when asked, into a scope
// of its own.
//
// Everything is styled with Tailwind and margaui classes, compiled in the page
// by margaui-css.wasm (vendor/margaui): the page's own classes (UI) and the
// ones each component module's views use, which loadComponent reports. Each
// time a module brings new ones, the whole set is compiled again.
import { defineRating } from "../components/media/rating.js";
import { classStyles, loadCssCompiler } from "../js/css.js";
import { fromJson as fromJsonIn } from "../js/json-example.js";
import { load } from "../js/tutuca-rt.js";

// The page's own classes, the components bring theirs. The first class of
// some is a marker that names the part (actions, events, an event's kind)
// for test/browser.test.mjs, which no stylesheet uses.
const UI = {
	body: "bg-base-200 text-base-content min-h-screen",
	header: "max-w-5xl mx-auto px-4 pt-7 pb-2",
	title: "text-2xl font-bold mb-1",
	lead: "opacity-70 max-w-prose",
	status: "mt-2 text-sm opacity-70",
	main: "max-w-5xl mx-auto px-4",
	footer: "max-w-5xl mx-auto px-4 pt-2 pb-8 text-sm opacity-70",
	code: "font-mono text-[0.9em]",
	demo: "demo card card-border bg-base-100 shadow-sm my-5",
	demoBody: "card-body gap-3",
	demoTitle: "card-title",
	demoText: "opacity-70 max-w-prose",
	cols: "grid gap-4 md:grid-cols-2",
	label: "text-xs uppercase tracking-wide opacity-60 mb-1",
	labelBelow: "text-xs uppercase tracking-wide opacity-60 mb-1 mt-3",
	stage: "stage rounded-box border border-dashed border-base-300 p-3 min-h-20",
	actions: "actions flex flex-wrap gap-1.5 mt-2",
	action: "btn btn-sm btn-dash",
	state: "bg-base-200 rounded-box p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-auto",
	events: "events font-mono text-xs max-h-40 overflow-auto mt-1",
	event: "py-0.5 border-b border-base-300",
	log: "log text-success",
	unhandled: "unhandled text-warning",
	failed: "failed text-error",
	issue: "issue text-warning",
	note: "note opacity-60",
	empty: "opacity-60",
	list: "list-disc pl-5",
	fresh: "fresh text-primary font-semibold",
};

// margaui's themes: light by default, dark when the system asks for it.
const vendor = (path) => new URL(`../vendor/margaui/${path}`, import.meta.url);
const themes = await Promise.all(["light", "dark"].map(async (t) => (await fetch(vendor(`themes/${t}.css`))).text()));
document.querySelector("#themes").textContent = themes.join("\n");
const dark = matchMedia("(prefers-color-scheme: dark)");
const followTheme = () => {
	document.documentElement.dataset.theme = dark.matches ? "dark" : "light";
};
followTheme();
dark.addEventListener("change", followTheme);

const styles = classStyles(await loadCssCompiler(vendor("margaui-css.wasm")), document.querySelector("#classes"), Object.values(UI));
document.body.className = UI.body;
document.querySelector("header").className = UI.header;
document.querySelector("h1").className = UI.title;
document.querySelector("header p").className = UI.lead;
document.querySelector("#status").className = UI.status;
document.querySelector("#demos").className = UI.main;
document.querySelector("body > footer").className = UI.footer;
for (const code of document.querySelectorAll("code")) code.className = UI.code;

const tw = await load(new URL("../dist/tutuca-rt.wasm", import.meta.url));
const { runtime } = tw;
const moduleUrl = (name) => new URL(`../dist/components/${name}.wasm`, import.meta.url);
// Loads a module into scope, and compiles the CSS again if it brings classes
// the page hasn't seen.
const loadComponent = async (name, into) => {
	const info = await tw.loadComponent(moduleUrl(name), into);
	if (styles.add(info.classes)) showStatus();
	return info;
};

const showStatus = () => {
	document.querySelector("#status").innerHTML =
		`runtime and component modules loaded; js-string builtins: <b>${tw.builtins ? "native" : "polyfilled"}</b>; CSS compiled for <b>${styles.classes().length}</b> classes`;
};
const scope = runtime.scope();
for (const name of ["counter", "todo_item", "todo_list", "json", "media", "layout"]) await loadComponent(name, scope);
// The custom element media's Rating holds.
defineRating();
showStatus();

const el = (tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	node.append(...children);
	return node;
};

// A demo card: title, description, the stage the component renders into,
// buttons below it, and the state and events panel next to it.
function card({ title, description }) {
	const stage = el("div", { class: UI.stage });
	const actions = el("div", { class: UI.actions });
	const state = el("pre", { class: UI.state });
	const events = el("ul", { class: UI.events });
	const section = el(
		"section",
		{ class: UI.demo },
		el(
			"div",
			{ class: UI.demoBody },
			el("h2", { class: UI.demoTitle }, title),
			el("p", { class: UI.demoText }, description),
			el(
				"div",
				{ class: UI.cols },
				el("div", {}, el("p", { class: UI.label }, "component"), stage, actions),
				el("div", {}, el("p", { class: UI.label }, "state"), state, el("p", { class: UI.labelBelow }, "events"), events),
			),
		),
	);
	document.querySelector("#demos").append(section);
	const note = (kind, text) => {
		events.prepend(el("li", { class: `${UI.event} ${UI[kind]}` }, `${new Date().toLocaleTimeString()}  ${kind}: ${text}`));
	};
	return { stage, actions, state, note };
}

// Shows what changed in card c after every run of host: the host calls run
// after each event, message and settled ask. show(root) is what the state
// panel shows.
function observe(host, c, show) {
	const run = host.run.bind(host);
	const seen = { logs: 0, unhandled: 0, failures: 0, issues: 0 };
	host.run = () => {
		run();
		for (const v of host.logs.slice(seen.logs)) c.note("log", JSON.stringify(v));
		for (const name of host.unhandled.slice(seen.unhandled)) c.note("unhandled", name);
		for (const e of host.failures.slice(seen.failures)) c.note("failed", e.message);
		for (const i of host.issues.slice(seen.issues)) c.note("issue", JSON.stringify(i));
		seen.logs = host.logs.length;
		seen.unhandled = host.unhandled.length;
		seen.failures = host.failures.length;
		seen.issues = host.issues.length;
		c.state.textContent = JSON.stringify(show(host.root()), null, 2);
	};
	return host;
}

// Mounts a component of type in a card. inspect turns the root into what the
// state panel shows; actions are buttons that send the root a message.
function demo({ title, description, type, fields, inspect, actions = [], asks = {} }) {
	const c = card({ title, description });
	let host;
	const mount = () => {
		host?.unmount();
		host = runtime.createHost(document, c.stage, runtime.make(scope, type, fields), { asks, dev: true });
		observe(host, c, (root) => ({ type: runtime.typeName(root), ...inspect(root) }));
		host.mount();
	};
	mount();
	for (const { label, send, args = [], hint } of actions) {
		c.actions.append(
			el("button", { class: UI.action, title: hint ?? "", onclick: () => {
				c.note("note", `send ${send}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
				host.send(send, args);
			} }, label),
		);
	}
	c.actions.append(el("button", { class: UI.action, onclick: () => {
		mount();
		c.note("note", "remounted");
	} }, "↺ start over"));
	return c;
}

const todoState = (root) => ({
	draft: runtime.get(root, "draft"),
	remaining: runtime.get(root, "remaining"),
	items: runtime.get(root, "items").map((c) => {
		const item = { id: runtime.get(c, "id"), text: runtime.get(c, "text"), done: runtime.get(c, "done") };
		// Only todo_card's TodoItem has a star.
		const starred = runtime.get(c, "starred");
		return starred === null ? item : { ...item, starred };
	}),
});

// Component modules loaded when asked: a scope that starts empty, a button per
// module, and what each one is. TodoList and TodoItem are separate modules:
// until a module has registered TodoItem in the scope, TodoList can't make one.
// todo_item and todo_card both implement TodoItem, with the same interface:
// whichever was loaded last makes the items added from then on.
{
	const c = card({
		title: "Loading components at runtime",
		description:
			"The page loaded the runtime, dist/tutuca-rt.wasm. Each component module is a .wasm of its own that imports the runtime's functions (module tutuca), exports tutuca_register and tutuca_abi_version, and shares the runtime's types by being built from the same prelude. This scope starts empty: load todo_list.wasm and TodoList mounts;  type a todo and add it, and it fails, since no module has registered TodoItem here. Load todo_item.wasm (a checkbox) or todo_card.wasm (a card with buttons, the text's length and a star) and add again: the modules compose through the scope, no remount needed. Both implement TodoItem's interface (init's id, text and done; the id and done properties; setDone; the removeMe notify), so TodoList works with either; load the other one too and it takes the name over: new items use it, the old ones keep theirs, and all done reaches them all.",
	});
	let cardScope;
	let host;
	let loaded;
	const show = () => {
		const modules = loaded.map(({ file, size, imports, exports, classes }) => {
			const counts = {};
			for (const i of imports) counts[i.module] = (counts[i.module] ?? 0) + 1;
			return { file, bytes: size, imports: counts, exports, classes: classes.length };
		});
		const root = host?.root();
		return root ? { modules, root: { type: runtime.typeName(root), ...todoState(root) } } : { modules };
	};
	const reset = () => {
		cardScope = runtime.scope();
		host = null;
		loaded = [];
		c.stage.replaceChildren(el("p", { class: UI.empty }, "no component mounted: load todo_list.wasm"));
		c.state.textContent = JSON.stringify(show(), null, 2);
	};
	const loadModule = async (name) => {
		const file = `${name}.wasm`;
		if (loaded.some((m) => m.file === file)) {
			c.note("note", `${file} is already loaded in this scope`);
			return;
		}
		try {
			const before = styles.classes().length;
			const info = await loadComponent(name, cardScope);
			loaded.push({ file, ...info });
			c.note("note", `loaded ${file}: ${info.size} bytes, ${info.imports.filter((i) => i.module === "tutuca").length} runtime functions imported, ${info.classes.length} classes`);
			const added = styles.classes().length - before;
			if (added > 0) c.note("note", `${added} new classes: CSS compiled again`);
		} catch (error) {
			c.note("failed", `${file}: ${error.message}`);
			return;
		}
		if (name === "todo_list" && !host) {
			c.stage.replaceChildren();
			host = runtime.createHost(document, c.stage, runtime.make(cardScope, "TodoList", {}));
			observe(host, c, show);
			host.mount();
		}
		c.state.textContent = JSON.stringify(show(), null, 2);
	};
	for (const name of ["todo_list", "todo_item", "todo_card"]) {
		c.actions.append(el("button", { class: UI.action, onclick: () => loadModule(name) }, `load ${name}.wasm`));
	}
	c.actions.append(el("button", { class: UI.action, onclick: () => {
		reset();
		c.note("note", "a new, empty scope");
	} }, "↺ start over"));
	reset();
}

const counterState = (root) =>
	runtime.typeName(root) === "Counter" ? { count: runtime.get(root, "count") } : { text: runtime.get(root, "text") };

demo({
	title: "Board: a loop of counters",
	description:
		"The root holds a list of Counter components rendered in a loop. add makes one through the scope (ctx_make); a counter's + notifies the Board, which counts it in total; x notifies too, and the Board removes the counter its source key names; reset all sends reset to each counter by selector.",
	type: "Board",
	fields: { counters: [], total: 0 },
	inspect: (root) => ({
		total: runtime.get(root, "total"),
		counters: runtime.get(root, "counters").map((c) => runtime.get(c, "count")),
	}),
});

demo({
	title: "Todos: a list of item components",
	description:
		"Composition: TodoList holds TodoItem components in its items field and renders each in a keyed loop. An item handles its own checkbox (toggle) and asks the list to remove it (x notifies removeMe; the list finds which by the source key). The list reads each item's done through the item's vtable to count what's left, makes new items through the scope, and sends every item setDone(true) by selector for all done. Drag an item onto another to move it there: items are draggable but handle no drop, so the drop reaches the list's on:drop, which reads the dragged item's key (dragKey) and the one dropped on (sourceKey).",
	type: "TodoList",
	fields: {
		items: ["read the README", "write a component", "compose two"].map((text, id) =>
			runtime.make(scope, "TodoItem", { id, text, done: id === 0 }),
		),
		nextId: 3,
	},
	inspect: todoState,
	actions: [
		{ label: "all done", send: "completeAll", hint: "the list sends setDone(true) to each item" },
		{ label: "setDraft + addTodo", send: "setDraft", args: ["from outside"], hint: "sets the draft; click add to make the item" },
	],
});

demo({
	title: "Counter: asks, swaps, failures",
	description:
		"A Counter as the root. Its buttons and input are its own handlers (+10 sends add with a literal 10; typing sends set with the input's value). The buttons below it send it messages from outside, as host.send: load asks the scope, which answers now with 42; fetch asks the host, which answers a second later with a random count; to label swaps the Counter for a Label; add \"x\" fails and commits nothing; nope has no handler.",
	type: "Counter",
	fields: { count: 1 },
	inspect: counterState,
	asks: {
		fetchCount: () => new Promise((resolve) => setTimeout(() => resolve(Math.floor(Math.random() * 100)), 1000)),
	},
	actions: [
		{ label: "load", send: "load", hint: "ctx_ask loadCount: the scope's handler replies now" },
		{ label: "fetch (1s)", send: "fetch", hint: "ctx_ask fetchCount: the host replies later" },
		{ label: "reset", send: "reset" },
		{ label: "add 5", send: "add", args: [5] },
		{ label: "to label", send: "toLabel", hint: "returns Swapped: the root becomes a Label" },
		{ label: 'add "x"', send: "add", args: ["x"], hint: "rejected: the transaction aborts" },
		{ label: "nope", send: "nope", hint: "no handler: observed as unhandled" },
	],
});

const fromJson = (v) => fromJsonIn(runtime, scope, v);

demo({
	title: "JSON: a viewer and editor",
	description:
		"A tree of components, one type per kind of JSON value, each with a read only main view and, for the ones that can change, an edit view styled like it. JsonEditor pushes its mode's view above the tree (pushView), so Edit switches the whole tree: keys, strings and numbers become inputs, booleans toggle, arrays and objects get move up, remove and add buttons, and an added value starts as a selector that swaps itself for the type picked. Every value answers json with its compact JSON text, which the collections compose and the editor indents. The commas come from the items loop's prepare (the last index) and enrich hooks.",
	type: "JsonEditor",
	fields: {
		value: fromJson({ name: "tutuca-wax", version: 2, wasm: true, tags: ["wax", "wasm-gc"], author: null, deps: {} }),
		mode: "view",
		showText: true,
	},
	inspect: (root) => ({ mode: runtime.get(root, "mode"), json: JSON.parse(runtime.get(root, "json")) }),
	actions: [
		{ label: "edit", send: "setMode", args: ["edit"] },
		{ label: "view", send: "setMode", args: ["view"] },
	],
});

demo({
	title: "SVG: a circle",
	description:
		"Dot's view is an svg: the vdom makes it and everything in it in the SVG namespace, and writes its props as attributes (viewBox keeps its case). Its shapes handle events like any element: click the circle to fill it, and − or + (each a g of a rect and a text, the handler on the g) to resize it.",
	type: "Dot",
	fields: { r: 20, filled: false },
	inspect: (root) => ({ r: runtime.get(root, "r"), filled: runtime.get(root, "filled") }),
	actions: [{ label: "grow", send: "grow" }, { label: "toggle", send: "toggle" }],
});

demo({
	title: "MathML: a sum",
	description:
		"Sum's view has a math element: the sum of 1 to n, its closed form with n put in, and its value, a property computed in the .wax. Click the formula (its handler is on math) or + for one more term, − for one less.",
	type: "Sum",
	fields: { n: 3 },
	inspect: (root) => ({ n: runtime.get(root, "n"), total: runtime.get(root, "total") }),
	actions: [{ label: "inc", send: "inc" }, { label: "dec", send: "dec" }],
});

demo({
	title: "Web component: a rating",
	description:
		"Rating holds tw-rating, a custom element (components/media/rating.js) with five stars in its shadow root. The view sets its stars property from the state, and handles rating-change, the CustomEvent it fires when a star is clicked, sending rate with the event's detail. rate 9 is outside rate's constraints: rejected, nothing changes.",
	type: "Rating",
	fields: { stars: 3 },
	inspect: (root) => ({ stars: runtime.get(root, "stars") }),
	actions: [
		{ label: "rate 5", send: "rate", args: [5] },
		{ label: "rate 9", send: "rate", args: [9], hint: "rejected: n must be within 0 and 5" },
	],
});

// What a Hole could become: the type names of its slot, as runtime.typeName gives them.
const layoutState = (root) => {
	const slots = ["items", "panels", "cells"].map((f) => runtime.get(root, f)).find(Array.isArray) ?? [];
	return { slots: slots.map((c) => ({ type: runtime.typeName(c), ...layoutState(c) })) };
};

demo({
	title: "Layouts: holes that ask what they can be",
	description:
		"Hbox, Vbox, Tabs and Grid hold components; + slot, + cell and the + tab add a Hole. A hole's + asks componentNames: the package's ask handler gets the asker's context, so it lists the types visible from the scope the hole was made in and its parents (ctx_component_names), sorted, each name once. Pick one and the hole swaps itself for it, made in its own scope: Counter and TodoItem come from the other modules loaded here, and a box picked holds holes of its own. A pick that can't be made (ctx_try_make's Err) keeps the hole, with why under the choices: its swap handler keeps its own state instead.",
	type: "Vbox",
	fields: { items: [runtime.make(scope, "Hole", {})] },
	inspect: layoutState,
});

// The vdom on its own: a keyed list, re-rendered from JS, with the DOM
// mutations each render caused.
{
	const c = card({
		title: "vdom: a keyed list",
		description:
			"No components here: the vnodes come from JS and the wasm module morphs the DOM. Keyed items keep their nodes when they move; new ones are colored. The state panel counts the DOM mutations the last render caused, so an unchanged render shows 0.",
	});
	const { h } = tw;
	let items = ["a", "b", "c", "d", "e"];
	let next = 0;
	let prev = null;
	let fresh = new Set();
	const draw = (why) => {
		const observer = new MutationObserver(() => {});
		observer.observe(c.stage, { subtree: true, childList: true, attributes: true, characterData: true });
		prev = tw.render(document, c.stage, [h("ul", { class: UI.list }, items.map((k) => h("li", { key: k, class: fresh.has(k) ? UI.fresh : "" }, `item ${k}`)))], prev);
		const records = observer.takeRecords();
		observer.disconnect();
		c.state.textContent = JSON.stringify({ items, "mutations in the last render": records.length }, null, 2);
		c.note("note", `${why}: ${records.length} mutations`);
	};
	// An action that changes the list clears the highlight of the items the
	// last one added; one that doesn't renders exactly what's there.
	const act = (label, fn, changes = true) => c.actions.append(el("button", { class: UI.action, onclick: () => {
		if (changes) fresh = new Set();
		fn();
		draw(label);
	} }, label));
	act("shuffle", () => {
		items = [...items].sort(() => Math.random() - 0.5);
	});
	act("reverse", () => {
		items = [...items].reverse();
	});
	act("add", () => {
		const k = `n${next++}`;
		fresh.add(k);
		items = [...items.slice(0, 2), k, ...items.slice(2)];
	});
	act("remove first", () => {
		items = items.slice(1);
	});
	act("re-render, unchanged", () => {}, false);
	draw("first render");
}

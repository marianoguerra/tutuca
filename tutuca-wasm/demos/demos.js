// The demos page: each demo is a root on a runtime of its own, made from pure-tutuca modules
// the page checks and compiles as it loads them, with a panel that shows the root's state and
// what the runtime reported after every change.
//
// Everything is styled with Tailwind and margaui classes, compiled in the page by
// margaui-css.wasm: the page's own (UI) and the ones the components come to show.
import { createRuntime } from "../dist/tutuca-wasm.js";
import { el, jsonTree, moduleSources, pageStyles } from "../js/page.js";
import { COMPILER, componentPath, MARGAUI, RUNTIME, SOURCES } from "../js/paths.js";

// The page's own classes. The first of some is a marker that names the part (actions, events,
// an event's kind), which no stylesheet uses.
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
	state:
		"bg-base-200 rounded-box p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-auto",
	events: "events font-mono text-xs max-h-40 overflow-auto mt-1",
	event: "py-0.5 border-b border-base-300",
	log: "log text-success",
	unhandled: "unhandled text-warning",
	failed: "failed text-error",
	issue: "issue text-warning",
	note: "note opacity-60",
	empty: "opacity-60",
};

const styles = await pageStyles(MARGAUI, Object.values(UI));
document.body.className = UI.body;
document.querySelector("header").className = UI.header;
document.querySelector("h1").className = UI.title;
for (const p of document.querySelectorAll("header p")) p.className = UI.lead;
document.querySelector("#status").className = UI.status;
document.querySelector("#demos").className = UI.main;
document.querySelector("body > footer").className = UI.footer;
for (const code of document.querySelectorAll("code")) code.className = UI.code;

const sources = moduleSources(SOURCES);
let compiled = 0;
const showStatus = () => {
	document.querySelector("#status").textContent =
		`${compiled} modules checked and compiled in this page; CSS compiled for ${styles.count()} classes`;
};

// The custom element media's Rating holds.
const { defineRating } = await import(new URL("components/media/rating.js", SOURCES));
defineRating();

// A demo card: title, description, the stage the component renders into, buttons below it, and
// the state and events panel next to it.
function card({ title, description }) {
	const stageBox = el("div", {});
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
				el("div", {}, el("p", { class: UI.label }, "component"), stageBox, actions),
				el(
					"div",
					{},
					el("p", { class: UI.label }, "state"),
					state,
					el("p", { class: UI.labelBelow }, "events"),
					events,
				),
			),
		),
	);
	document.querySelector("#demos").append(section);
	const note = (kind, text) => {
		const line = `${new Date().toLocaleTimeString()}  ${kind}: ${text}`;
		events.prepend(el("li", { class: `${UI.event} ${UI[kind]}` }, line));
	};
	// A new node for each mount: nothing of the last runtime's is left in it.
	const newStage = () => {
		const stage = el("div", { class: UI.stage });
		stageBox.replaceChildren(stage);
		styles.watch(stage);
		return stage;
	};
	return { newStage, actions, state, note };
}

// A runtime for a card, with the modules it needs loaded: what it reports shows in the card,
// and show(tutuca) is what the state panel shows, after every change.
async function runtimeFor(c, modules, { asks = {}, show }) {
	const stage = c.newStage();
	const tutuca = await createRuntime({
		document,
		rootNode: stage,
		asks,
		runtime: RUNTIME,
		compiler: COMPILER,
	});
	let seen = 0;
	const refresh = () => {
		const reports = tutuca.reports();
		for (const r of reports.slice(seen)) {
			for (const log of r.logs ?? []) c.note("log", JSON.stringify(log));
			if (r.outcome === "unhandled") c.note("unhandled", r.name);
			if (r.outcome === "failed" || r.type === "renderFailed") c.note("failed", r.error ?? r.name);
			for (const i of r.issues ?? []) {
				c.note("issue", i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason);
			}
		}
		seen = reports.length;
		try {
			c.state.textContent = JSON.stringify(show(tutuca), null, 2);
		} catch {
			c.state.textContent = "";
		}
	};
	new MutationObserver(refresh).observe(stage, {
		childList: true,
		subtree: true,
		attributes: true,
		characterData: true,
	});
	const load = async (name) => {
		const loaded = await sources.load(tutuca, componentPath(name));
		if (!loaded.ok) throw new Error(`${name}: ${loaded.diagnostics[0]?.message ?? "didn't load"}`);
		compiled++;
		showStatus();
		return loaded;
	};
	for (const name of modules) await load(name);
	return { tutuca, load, refresh, stage };
}

// A root of a type, made from fields, with buttons that send it messages from outside.
async function demo({
	title,
	description,
	modules,
	type,
	fields,
	inspect,
	actions = [],
	asks = {},
}) {
	const c = card({ title, description });
	let running = null;
	const mount = async () => {
		running = await runtimeFor(c, modules, {
			asks,
			show: (tutuca) => inspect(tutuca.state(), tutuca),
		});
		running.tutuca.start(type, fields);
		running.tutuca.mount();
		running.refresh();
	};
	await mount();
	// A message from outside, as a page would send one, and what it starts, once it settles.
	const sendFromOutside = async (name, args) => {
		c.note("note", `send ${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
		running.tutuca.send(name, args);
		running.refresh();
		await running.tutuca.idle();
		running.refresh();
	};
	for (const { label, send, args = [], hint } of actions) {
		c.actions.append(
			el(
				"button",
				{
					class: UI.action,
					title: hint ?? "",
					onclick: () => sendFromOutside(send, args),
				},
				label,
			),
		);
	}
	c.actions.append(
		el(
			"button",
			{
				class: UI.action,
				onclick: async () => {
					await mount();
					c.note("note", "remounted");
				},
			},
			"↺ start over",
		),
	);
}

const make = (type, fields = {}) => ({ $make: type, fields });

// ---- Loading modules as the page runs --------------------------------------------------------

{
	const c = card({
		title: "Loading components at runtime",
		description:
			"Each component module is text: the page checks it and compiles it to a WebAssembly module of its own, whose exports are the module's entries and whose only imports are what every pure-js module asks of its host. todo_list declares the TodoItem interface and holds whatever is registered as TodoItem: load it, then todo_item or todo_card (which registers itself under that name), and add an item.",
	});
	let running = null;
	let loaded = [];
	let mounted = false;
	const show = (tutuca) => ({
		modules: loaded,
		...(mounted ? { root: { ...tutuca.state(), remaining: tutuca.query("remaining") } } : {}),
	});
	const reset = async () => {
		loaded = [];
		mounted = false;
		running = await runtimeFor(c, [], { show });
		const empty = el("p", { class: UI.empty }, "no component mounted: load todo_list");
		c.state.textContent = JSON.stringify({ modules: [] }, null, 2);
		running.stage.replaceChildren(empty);
	};
	const loadModule = async (name) => {
		if (loaded.some((m) => m.module === name)) return c.note("note", `${name} is already loaded`);
		try {
			const started = performance.now();
			const info = await running.load(name);
			const ms = Math.round(performance.now() - started);
			const components = info.model.components.map((x) => info.model.register?.[x.name] ?? x.name);
			loaded.push({ module: name, components, wat: `${info.wat.length} characters` });
			c.note("note", `loaded ${name} in ${ms} ms: ${components.join(", ")}`);
		} catch (error) {
			return c.note("failed", error.message);
		}
		if (name === "todo_list" && !mounted) {
			running.tutuca.start("TodoList", {});
			running.tutuca.mount();
			mounted = true;
		}
		running.refresh();
	};
	for (const name of ["todo_list", "todo_item", "todo_card"]) {
		c.actions.append(
			el("button", { class: UI.action, onclick: () => loadModule(name) }, `load ${name}`),
		);
	}
	c.actions.append(
		el(
			"button",
			{
				class: UI.action,
				onclick: async () => {
					await reset();
					c.note("note", "a new, empty runtime");
				},
			},
			"↺ start over",
		),
	);
	await reset();
}

// ---- The demos ------------------------------------------------------------------------------

await demo({
	title: "Board: a loop of counters",
	description:
		"The root holds a list of Counter components rendered in a loop. add makes one through the scope (ctx.make); a counter's + notifies the Board, which counts it in total; x notifies too, and the Board removes the counter by the key the notification came through.",
	modules: ["counter"],
	type: "Board",
	fields: { counters: [], total: 0 },
	inspect: (state) => state,
});

await demo({
	title: "Todos: a list of item components",
	description:
		"Composition: TodoList holds TodoItem components in its items field and renders each in a keyed loop. An item handles its own checkbox (toggle) and asks the list to remove it (x notifies removeMe).",
	modules: ["todo_list", "todo_item"],
	type: "TodoList",
	fields: {
		items: ["read the README", "write a component", "compose two"].map((text, id) =>
			make("TodoItem", { id, text, done: id === 0 }),
		),
		nextId: 3,
	},
	inspect: (state, tutuca) => ({ ...state, remaining: tutuca.query("remaining") }),
	actions: [
		{
			label: "all done",
			send: "completeAll",
			hint: "the list applies setDone(true) to each item",
		},
		{
			label: "setDraft",
			send: "setDraft",
			args: ["from outside"],
			hint: "sets the draft; click add to make the item",
		},
	],
});

await demo({
	title: "Counter: asks, swaps, failures",
	description:
		"A Counter as the root. Its buttons and input are its own handlers (+10 sends add with a literal 10; typing sends set with the input's value). The buttons below it send it messages from outside, as a page would.",
	modules: ["counter"],
	type: "Counter",
	fields: { count: 1 },
	inspect: (state) => state,
	asks: {
		fetchCount: () =>
			new Promise((resolve) => setTimeout(() => resolve(Math.floor(Math.random() * 100)), 1000)),
	},
	actions: [
		{ label: "load", send: "load", hint: "ctx.ask loadCount: the module's handler answers now" },
		{ label: "fetch (1s)", send: "fetch", hint: "ctx.ask fetchCount: the page answers later" },
		{ label: "reset", send: "reset" },
		{ label: "add 5", send: "add", args: [5] },
		{ label: "to label", send: "toLabel", hint: "a swap: the root becomes a Label" },
		{ label: 'add "x"', send: "add", args: ["x"], hint: "its argument isn't a number" },
		{ label: "nope", send: "nope", hint: "no handler: reported as unhandled" },
	],
});

await demo({
	title: "JSON: a viewer and editor",
	description:
		"A tree of components, one type per kind of JSON value, each with a read only main view and, for the ones that can change, an edit view styled like it. JsonEditor pushes its mode's view above the tree, and every value under it renders with it.",
	modules: ["json"],
	type: "JsonEditor",
	fields: {
		value: jsonTree({
			name: "tutuca-wasm",
			version: 1,
			wasm: true,
			tags: ["pure-js", "wasm-gc"],
			author: null,
			deps: {},
		}),
		mode: "view",
		showText: true,
	},
	inspect: (state, tutuca) => ({ mode: state.mode, json: JSON.parse(tutuca.query("json")) }),
	actions: [
		{ label: "edit", send: "setMode", args: ["edit"] },
		{ label: "view", send: "setMode", args: ["view"] },
	],
});

await demo({
	title: "SVG: a circle",
	description:
		"Dot's view is an svg: the vdom makes it and everything in it in the SVG namespace, and writes its props as attributes (viewBox keeps its case). Its shapes handle events like any element: click the circle.",
	modules: ["media"],
	type: "Dot",
	fields: { r: 20, filled: false },
	inspect: (state) => state,
	actions: [
		{ label: "grow", send: "grow" },
		{ label: "toggle", send: "toggle" },
	],
});

await demo({
	title: "MathML: a sum",
	description:
		"Sum's view has a math element: the sum of 1 to n, its closed form with n put in, and its value, a query. Click the formula (its handler is on math) or the buttons.",
	modules: ["media"],
	type: "Sum",
	fields: { n: 3 },
	inspect: (state, tutuca) => ({ ...state, total: tutuca.query("total") }),
	actions: [
		{ label: "inc", send: "inc" },
		{ label: "dec", send: "dec" },
	],
});

await demo({
	title: "Web component: a rating",
	description:
		"Rating holds tw-rating, a custom element with five stars in its shadow root. The view sets its stars property from the state, and handles rating-change, the CustomEvent the element dispatches, reading the stars from the event.",
	modules: ["media"],
	type: "Rating",
	fields: { stars: 3 },
	inspect: (state) => state,
	actions: [
		{ label: "rate 5", send: "rate", args: [5] },
		{ label: "rate 9", send: "rate", args: [9], hint: "n must be within 0 and 5" },
	],
});

await demo({
	title: "Layouts: holes that ask what they can be",
	description:
		"A Screen holds a layout and toggles, with the icon at its corner, between using it and editing it: it pushes the layoutEdit view above its content. Edited, a layout holds Holes; a hole's + asks what its scope can make and swaps itself for the one picked.",
	modules: ["meta", "counter", "layout"],
	type: "Screen",
	fields: { content: make("Vbox", { items: [make("Hole")] }), editing: true },
	inspect: (state) => state,
});

showStatus();

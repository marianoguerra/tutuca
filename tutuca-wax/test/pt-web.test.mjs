// pure-tutuca in the browser, run in Node: dist/pure-tutuca/pure-tutuca.wasm (pure-tutuca and wax-mb's library
// compiled to wasm-gc) through js/pt-web.js, as the playground's worker runs
// it. A module it builds from the repo's files is the one the native pure-tutuca
// builds, and behaves as it does; errors come back as diagnostics at their
// lines.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { JSDOM } from "jsdom";
import { loadRuntimeFiles, loadPureTutuca } from "../js/pt-web.js";
import { examples } from "../js/pbt.js";
import { CANVAS_META, componentMeta, DISPLAY_META, displayLabel, load } from "../js/tutuca-rt.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
// The counter module the components are built from, a pure-tutuca module.
const PURE_COUNTER = "components/counter/counter.tutuca.ts";
// The well-known meta schemas the component modules use.
const META = "components/meta/meta.tutuca.ts";
let compiler;
let runtime;

before(async () => {
	compiler = await loadPureTutuca(new URL("dist/pure-tutuca/pure-tutuca.wasm", root));
	runtime = await loadRuntimeFiles(root);
});

test("pure-tutuca builds counter in wasm-gc, and the module behaves as the prebuilt one", async () => {
	const res = compiler.build({ main: PURE_COUNTER, files: { [PURE_COUNTER]: await read(PURE_COUNTER), [META]: await read(META) }, runtime });
	assert.deepEqual(res.diags, []);
	assert.equal(res.ok, true);
	assert.deepEqual(res.types, ["Counter", "Label", "Board"]);
	assert.match(res.glue, /fn Counter_vt_handle: handle_fn/);
	// The same module the native pure-tutuca built (scripts/build.mjs).
	assert.ok(Buffer.from(res.wasm).equals(await readFile(new URL("dist/components/counter.debug.wasm", root))), "differs from the native build");
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Board", { counters: [], total: 0 }), { dev: true }).mount();
	const button = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);
	const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
	click(button("add"));
	click(button("+"));
	assert.equal(tw.runtime.get(host.root(), "total"), 1);
	assert.deepEqual(host.issues, []);
	assert.deepEqual(host.failures, []);
});

test("pure-tutuca builds a pure-tutuca module in wasm-gc: its functions lowered, the module the native pure-tutuca built", async () => {
	const main = "../spec/pure-tutuca/conformance/accept/todo-list.tutuca.ts";
	const res = compiler.build({ main, files: { [main]: await read(main) }, runtime });
	assert.deepEqual(res.diags, []);
	assert.equal(res.ok, true);
	assert.deepEqual(res.types, ["PureTodoList"]);
	assert.match(res.impl, /fn PureTodoList_on_add\(state: &PureTodoList_state, ctx: &context\) -> &PureTodoList_state \{/);
	assert.ok(Buffer.from(res.wasm).equals(await readFile(new URL("dist/pure-tutuca/todo-list.debug.wasm", root))), "differs from the native build");
	// What pure-js rejects comes back at its place in the module.
	const broken = (await read(main)).replace("next.text = text;", "this.text = text;");
	const bad = compiler.build({ main, files: { [main]: broken }, runtime });
	assert.equal(bad.ok, false);
	assert.ok(bad.diags.some((d) => d.code.startsWith("purejs.") && d.span.file === main), JSON.stringify(bad.diags));
});

test("pure-tutuca builds a pure-tutuca module that imports a page's host module, given its declaration", async () => {
	const main = "../spec/pure-tutuca/conformance/accept/words.tutuca.ts";
	const hostModules = [JSON.parse(await read("../spec/pure-tutuca/host/words.json"))];
	const res = compiler.build({ main, files: { [main]: await read(main) }, runtime, hostModules });
	assert.deepEqual(res.diags, []);
	assert.match(res.impl, /host_call\(/);
	assert.ok(Buffer.from(res.wasm).equals(await readFile(new URL("dist/pure-tutuca/words.debug.wasm", root))), "differs from the native build");
	// Without it, the import is one pure-js doesn't know.
	const without = compiler.build({ main, files: { [main]: await read(main) }, runtime });
	assert.equal(without.ok, false);
	assert.ok(without.diags.some((d) => d.code.startsWith("purejs.")), JSON.stringify(without.diags));
});

// What pure-js rejects (a type it doesn't know) and what pure-tutuca does (a view
// sending a message the component hasn't) come back at their place in the
// module, and stop the build before compiling; check reports them with the
// types; model is the module's model.
test("errors in a module stop before compiling; check reports them with the types", async () => {
	const files = { [PURE_COUNTER]: await read(PURE_COUNTER), [META]: await read(META) };
	const counter = files[PURE_COUNTER];
	const unknownType = counter.replace("export type Counter = { count: number };", "export type Counter = { count: nope };");
	const res = compiler.check({ main: PURE_COUNTER, files: { ...files, [PURE_COUNTER]: unknownType } });
	assert.equal(res.ok, false);
	const line = unknownType.split("\n").findIndex((l) => l.includes("count: nope")) + 1;
	assert.ok(
		res.diags.some((d) => d.severity === "error" && d.code === "purejs.unknown-type" && d.span.file === PURE_COUNTER && d.span.start.line === line && /nope/.test(d.message)),
		JSON.stringify(res.diags),
	);
	const built = compiler.build({ main: PURE_COUNTER, files: { ...files, [PURE_COUNTER]: unknownType }, runtime });
	assert.equal(built.ok, false);
	assert.equal(built.wasm, undefined);
	assert.equal(built.contract, undefined);
	const unknownMessage = counter.replace('send("inc")', 'send("nope")');
	const bad = compiler.build({ main: PURE_COUNTER, files: { ...files, [PURE_COUNTER]: unknownMessage }, runtime });
	assert.equal(bad.ok, false);
	assert.equal(bad.wasm, undefined);
	assert.ok(
		bad.diags.some((d) => d.severity === "error" && d.code === "pure-tutuca.view.message" && d.span.file === PURE_COUNTER && /nope/.test(d.message)),
		JSON.stringify(bad.diags),
	);
	const { model } = compiler.model({ main: PURE_COUNTER, files });
	assert.deepEqual(
		model.components.map((c) => c.name),
		["Counter", "Board", "Label"],
	);
});

test("a use resolves relative to the main file, and a missing file is a diagnostic", async () => {
	const main = "components/todo_card/todo_card.tutuca.ts";
	const used = "components/todo_list/todo_list.tutuca.ts";
	const files = { [main]: await read(main), [used]: await read(used), [META]: await read(META) };
	assert.equal(compiler.check({ main, files }).ok, true);
	const res = compiler.check({ main, files: { [main]: files[main], [META]: files[META] } });
	assert.ok(res.diags.some((d) => /can't read \.\.\/todo_list\/todo_list\.tutuca\.ts/.test(d.message)));
	assert.equal(compiler.check({ main: "nowhere.tutuca.ts", files }).diags[0].message, "the request has no file nowhere.tutuca.ts");
});

// Modules whose examples are run here: the studio assistant's examples
// (studio/assistant/examples/), which its system prompt shows the model as
// modules that build, and the studio's own components (studio/studio.tutuca.ts).
// They build cleanly, and their examples hold.
test("the assistant's examples and the studio's module build without diagnostics, and their examples hold", async () => {
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const modules = [...["note", "checklist", "score", "stat", "tasks"].map((name) => `studio/assistant/examples/${name}`), "studio/studio"];
	for (const path of modules) {
		const name = path.split("/").pop();
		const main = `${name}.tutuca.ts`;
		const res = compiler.build({ main, files: { [main]: await read(`${path}.tutuca.ts`) }, runtime });
		assert.deepEqual(res.diags, [], name);
		assert.equal(res.ok, true, name);
		const scope = tw.runtime.scope();
		await tw.loadComponent(res.wasm, scope);
		const ran = examples({ runtime: tw.runtime, scope, model: res.pbtModel });
		assert.ok(ran.length > 0, name);
		assert.deepEqual(ran.filter((e) => !e.ok).map((e) => e.name), [], name);
	}
});

// The tasks starter shows the model an answer that asks again, a view
// testing a query, and an item's button sending its key; here they run,
// rendered.
test("the tasks example asks again for an idea already in the list, and its views test a query and send an item's key", async () => {
	const path = "studio/assistant/examples/tasks";
	const res = compiler.build({ main: "tasks.tutuca.ts", files: { "tasks.tutuca.ts": await read(`${path}.tutuca.ts`) }, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Tasks", {}), { dev: true }).mount();
	const draft = () => tw.runtime.get(host.root(), "draft");
	// One item: taken 1 is "answer the email".
	host.send("setDraft", ["answer the email"], { now: true });
	host.send("add", [], { now: true });
	host.send("suggestOne", [], { now: true });
	await host.settled();
	assert.equal(draft(), "take a walk");
	host.send("setDraft", [""], { now: true });
	const again = [...container.querySelectorAll("button")].find((b) => b.textContent === "again");
	again.dispatchEvent(new window.Event("click", { bubbles: true }));
	await host.settled();
	assert.equal(draft(), "answer the email");
	assert.ok(!container.textContent.includes("some hidden"));
	host.send("setShow", ["open"], { now: true });
	await host.settled();
	assert.ok(container.textContent.includes("some hidden"));
	assert.deepEqual(host.issues, []);
	assert.deepEqual(host.failures, []);
});

// A number is one kind, whole or not: made with whole ones, or sent one,
// where the type says number (here inside records in a list), a component's
// code reads them as the numbers they are.
test("a whole number where the type says number reads as one, at any depth", async () => {
	const main = "points.tutuca.ts";
	const files = {
		[main]: `import { field, span } from "tutuca/view";

export type Point = { x: number };
export type Points = { points: Point[]; readonly total: number };
export const Points = {
	defaults: { points: [] },
	queries: {
		get total(): number {
			let total = 0;
			for (const p of this.points) total += p.x;
			return total;
		},
	},
	on: {
		add: {
			pure: true,
			changes: ["points"],
			run(next, [p]: [Point]) {
				next.points.push(p);
			},
		},
	},
	view: span({}, field("total")),
	examples: {
		sums: {
			start: { points: [{ x: 1 }] },
			steps: [{ send: "add", args: [{ x: 2 }] }, { expect: { total: 3 } }],
		},
	},
};
export const register = { Points: "Points" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	assert.equal(tw.runtime.get(tw.runtime.make(scope, "Points", { points: [{ x: 1 }, { x: 2 }] }), "total"), 3);
	assert.deepEqual(
		examples({ runtime: tw.runtime, scope, model: res.pbtModel }).map((e) => [e.name, e.ok, e.failures]),
		[["sums", true, []]],
	);
});

// An answer's handler may emit, as a message's may; a reply without a
// handler is taken and changes nothing.
test("an ask's answer may notify, and a reply needs no handler", async () => {
	const main = "asker.tutuca.ts";
	const files = {
		[main]: `import { field, p } from "tutuca/view";

export interface AskerNotifies {
	done(): void;
}
export interface AskerAsks {
	count(): number;
	ping(): boolean;
}
export type Asker = { n: number };
export const Asker = {
	defaults: { n: 0 },
	constraints: { n: { int: true } },
	on: {
		go: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("count", []);
				ctx.ask("ping", []);
			},
		},
	},
	answers: {
		count: {
			ok(next, [count]: [number], ctx) {
				ctx.notify("done", []);
				next.n = count;
			},
		},
	},
	view: p({}, field("n")),
};
export const register = { Asker: "Asker" };
export const hostAsks = ["count", "ping"];
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Asker", {}), { dev: true, asks: { count: () => 3, ping: () => true } });
	host.send("go", [], { now: true });
	assert.equal(tw.runtime.get(host.root(), "n"), 3);
	// Asker is the root: its notify has no ancestor to handle it.
	assert.deepEqual(host.unhandled, ["done"]);
	assert.deepEqual(host.issues, []);
});

// A view tests what a loop's enrich and a query say (a view doesn't
// compare); a send sends what the event gives, the item's key, and the
// handler reads the item; one that reads the state is rejected.
test("views test enrich's binds and queries, and sends send an item's key", async () => {
	const main = "picker.tutuca.ts";
	const files = {
		[main]: `import { button, div, each, field, lookupBind, send, sourceKey, span, when } from "tutuca/view";

export type Fruit = { id: string; label: string };
export type Picker = { items: Fruit[]; picked: string; title: string; said: string; readonly pickedB: boolean };
export const Picker = {
	defaults: { items: [], picked: "", title: "fruit", said: "" },
	queries: {
		get pickedB(): boolean {
			return this.picked === "b";
		},
	},
	loops: {
		fruits: {
			enrich(key: number, item: Fruit) {
				return { isB: item.id === "b", notA: item.id !== "a" };
			},
		},
	},
	on: {
		pick: {
			pure: true,
			changes: ["picked"],
			constraints: { at: { keyOf: "items" } },
			run(next, [at]: [number]) {
				const item = this.items[at];
				if (item === undefined) return;
				next.picked = item.id;
			},
		},
		say: {
			pure: true,
			changes: ["said"],
			post(prev, next, []: []) {
				return next.said === prev.title;
			},
			run(next, []: []) {
				next.said = this.title;
			},
		},
	},
	view: div(
		{},
		each(
			field("items"),
			button(
				{
					class: when(lookupBind("isB"), "is-b", "not-b"),
					"aria-pressed": when(lookupBind("notA"), "true", "false"),
					"on:click": send("pick", sourceKey()),
				},
				field("label"),
			),
			"fruits",
		),
		button({ class: "say", "on:click": send("say") }, "say"),
		when(field("pickedB"), span({ class: "picked-b" }, "b!")),
	),
};
export const register = { Picker: "Picker" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	// The item's id read in the send: rejected, and a string where the key goes.
	assert.deepEqual(
		compiler.check({ main, files: { [main]: files[main].replace('send("pick", sourceKey())', 'send("pick", field("id"))') } }).diags.map((d) => d.code),
		["pure-tutuca.state-in-send"],
	);
	assert.deepEqual(
		compiler.check({ main, files: { [main]: files[main].replace('field("pickedB")', 'field("nope")') } }).diags.map((d) => d.code),
		["pure-tutuca.view.field"],
	);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const items = [
		{ id: "a", label: "Apple" },
		{ id: "b", label: "Banana" },
	];
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Picker", { items }), { dev: true }).mount();
	const buttons = () => [...container.querySelectorAll("button")];
	assert.deepEqual(
		buttons().slice(0, 2).map((b) => [b.className, b.getAttribute("aria-pressed")]),
		[
			["not-b", "false"],
			["is-b", "true"],
		],
	);
	buttons()[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(tw.runtime.get(host.root(), "picked"), "b");
	assert.ok(container.querySelector(".picked-b"));
	container.querySelector(".say").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(tw.runtime.get(host.root(), "said"), "fruit");
	assert.deepEqual(host.issues, []);
});

// An optional component: render renders nothing while it's null.
test("an empty optional component renders nothing", async () => {
	const main = "opt.tutuca.ts";
	const files = {
		[main]: `import { div, field, p, render, span, when } from "tutuca/view";

export type Child = { n: number };
export const Child = {
	defaults: { n: 0 },
	constraints: { n: { int: true } },
	view: span({ class: "child" }, field("n")),
};
export type Holder = { child: Child | null };
export const Holder = {
	defaults: { child: null },
	on: {
		open: {
			changes: ["child"],
			run(next, [], ctx) {
				next.child = ctx.make("Child", { n: 1 });
			},
		},
		close: {
			pure: true,
			changes: ["child"],
			run(next, []: []) {
				next.child = null;
			},
		},
	},
	view: div({}, render(field("child")), when(field("child"), p({}, "has"), p({}, "none"))),
};
export const register = { Child: "Child", Holder: "Holder" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Holder", {}), { dev: true }).mount();
	const shown = () => container.textContent;
	assert.equal(shown(), "none");
	host.send("open", [], { now: true });
	assert.equal(shown(), "1has");
	host.send("close", [], { now: true });
	assert.equal(shown(), "none");
	assert.deepEqual(host.failures, []);
});

// A scope's binds join the ones in place, but not value: renderIt still
// renders the loop's item, as in tutuca's JS, which drops value from them.
test("a scope can't bind value over the item renderIt renders", async () => {
	const main = "binds.tutuca.ts";
	const files = {
		[main]: `import { each, field, li, lookupBind, renderIt, span, ul, withBinds } from "tutuca/view";

export type Cell = { n: number };
export const Cell = {
	defaults: { n: 0 },
	constraints: { n: { int: true } },
	view: span({}, field("n")),
};
export type Row = { cells: Cell[] };
export const Row = {
	defaults: { cells: [] },
	binds: {
		extra() {
			return { value: "value", label: "Cell" };
		},
	},
	view: ul({}, each(field("cells"), withBinds("extra", li({}, lookupBind("label"), renderIt())))),
};
export const register = { Cell: "Cell", Row: "Row" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const cells = [tw.runtime.make(scope, "Cell", { n: 1 }), tw.runtime.make(scope, "Cell", { n: 2 })];
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Row", { cells }), { dev: true }).mount();
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent), ["Cell1", "Cell2"]);
	assert.deepEqual(host.failures, []);
});

// What isn't a node renders as String writes it, as in tutuca's JS: a map as
// "[object Object]", a key of any kind as its text; a loop needs something to
// loop over, so null fails as Object.entries(null) throws.
test("values render and key as String writes them, and a loop over null fails", async () => {
	const main = "texts.tutuca.ts";
	const files = {
		[main]: `import { div, each, field, li, lookupBind, p, ul } from "tutuca/view";

export type Texts = { v: unknown; xs: unknown };
export const Texts = {
	defaults: { v: null, xs: null },
	loops: {
		keyed: {
			key(key: unknown, item: unknown): unknown {
				return item;
			},
		},
	},
	view: div({}, p({}, field("v")), ul({}, each(field("xs"), li({}, lookupBind("value")), "keyed"))),
};
export const register = { Texts: "Texts" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const make = (v, xs) => tw.runtime.make(scope, "Texts", { v, xs });
	const host = tw.runtime.createHost(window.document, container, make({ a: 1 }, [true, 1.5, [1, null, 2]]), { dev: true }).mount();
	assert.equal(container.querySelector("p").textContent, "[object Object]");
	assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent), ["true", "1.5", "12"]);
	assert.deepEqual(host.failures, []);
	const nulls = tw.runtime.createHost(window.document, window.document.createElement("div"), make(null, null)).mount();
	assert.deepEqual(nulls.failures.map((e) => e.message), ["A loop source must be a list or a map"]);
});

// A constant value or checked is set as the property the vdom sets them as,
// each render, as optimize.js keeps them dynamic.
test("a constant value or checked is set as a property", async () => {
	const main = "inputs.tutuca.ts";
	const files = {
		[main]: `import { div, input } from "tutuca/view";

export type Inputs = {};
export const Inputs = { view: div({}, input({ value: "draft" }), input({ type: "checkbox", checked: true })) };
export const register = { Inputs: "Inputs" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Inputs", {})).mount();
	const [text, box] = container.querySelectorAll("input");
	assert.equal(text.value, "draft");
	assert.equal(box.checked, true);
	assert.deepEqual(host.failures, []);
});

// A component's meta is what it says about itself to hosts, by URI, read from
// the module's tutuca section without compiling it.
test("a component's meta is in the module's tutuca section, by registered name and URI", async () => {
	const main = "card.tutuca.ts";
	const files = {
		[main]: `import { p } from "tutuca/view";

export type Card = {};
export const Card = {
	meta: { "https://tutuca.dev/meta/canvas": { title: "Card", icon: "🃏", width: 320, transparent: true } },
	view: p({}, "card"),
};
export const register = { Card: "Card" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	assert.deepEqual(componentMeta(res.wasm).meta, {
		Card: { "https://tutuca.dev/meta/canvas": { title: "Card", icon: "🃏", width: 320, transparent: true } },
	});
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	await tw.loadComponent(res.wasm, tw.runtime.scope()); // The runtime ignores it.
});

// A meta schema a module declares is registered in the scope it's loaded in:
// metaOf reads a type's meta over its defaults, and a type whose meta breaks
// it can't be registered there (a module pure-tutuca can't check it against, since
// it doesn't import the schema).
test("meta schemas fill defaults and refuse a meta that breaks them", async () => {
	const build = (main, text) => {
		const res = compiler.build({ main, files: { [main]: text }, runtime });
		assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
		return res.wasm;
	};
	const schemas = build(
		"schemas.tutuca.ts",
		`export type Sizes = { width: number | null; wide: boolean };
export const Sizes = {
	metaSchema: "urn:example:sizes",
	defaults: { wide: true },
	constraints: { width: { min: 0 } },
};
`,
	);
	assert.deepEqual(componentMeta(schemas).meta_schemas, ["urn:example:sizes"]);
	const card = build(
		"card.tutuca.ts",
		`import { p } from "tutuca/view";

export type Card = {};
export const Card = { meta: { "urn:example:sizes": { width: 3 } }, view: p({}, "card") };
export type Bare = {};
export const Bare = { view: p({}, "bare") };
export const register = { Card: "Card", Bare: "Bare" };
`,
	);
	const bad = build(
		"bad.tutuca.ts",
		`import { p } from "tutuca/view";

export type Bad = {};
export const Bad = { meta: { "urn:example:sizes": { width: -1, color: "red" } }, view: p({}, "bad") };
export const register = { Bad: "Bad" };
`,
	);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(schemas, scope);
	await tw.loadComponent(card, scope);
	assert.deepEqual(rt.metaSchema(scope, "urn:example:sizes").defaults, { width: null, wide: true });
	assert.deepEqual(rt.typeMetaOf(scope, "Card", "urn:example:sizes"), { width: 3, wide: true });
	assert.deepEqual(rt.typeMetaOf(scope, "Bare", "urn:example:sizes"), { width: null, wide: true });
	assert.deepEqual(rt.typeMetaOf(scope, "Card", "urn:example:other"), {});
	assert.equal(rt.typeMetaOf(scope, "Nope", "urn:example:sizes"), null);
	assert.deepEqual(rt.metaOf(rt.make(scope, "Card", {}), "urn:example:sizes"), { width: 3, wide: true });
	// hasMeta and metaShapeProblems, as tutuca's.
	assert.equal(rt.hasMeta(rt.make(scope, "Card", {}), "urn:example:sizes"), true);
	assert.equal(rt.hasMeta(rt.make(scope, "Bare", {}), "urn:example:sizes"), false);
	assert.deepEqual(rt.metaProblems(rt.make(scope, "Card", {}), "urn:example:sizes"), []);
	// A schema's fields say their defaults.
	assert.deepEqual(rt.metaSchema(scope, "urn:example:sizes").fields.map((f) => [f.name, f.default]), [
		["width", null],
		["wide", true],
	]);
	await assert.rejects(() => tw.loadComponent(bad, scope), /Bad's meta urn:example:sizes: it has no key color/);
});

// The layout's hole lists the types it can become by their display meta.
test("a hole's choices are labeled and described by their display meta", async () => {
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	for (const name of ["meta", "layout"]) await tw.loadComponent(await readFile(new URL(`dist/components/${name}.wasm`, root)), scope);
	assert.deepEqual(tw.runtime.typeMetaOf(scope, "Hbox", DISPLAY_META), {
		title: "Horizontal box",
		icon: "➡️",
		description: "Components side by side.",
	});
	assert.deepEqual(tw.runtime.typeMetaOf(scope, "Hole", CANVAS_META), { width: 240, height: null, transparent: true });
	assert.equal(displayLabel(tw.runtime.typeMetaOf(scope, "Vbox", DISPLAY_META)), "⬇️ Vertical box");
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Screen", { editing: true })).mount();
	const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
	click(container.querySelector(".hole button"));
	await host.settle?.();
	const choices = [...container.querySelectorAll(".choices button")];
	const hbox = choices.find((b) => b.textContent === "➡️ Horizontal box");
	assert.ok(hbox, `no Horizontal box among ${choices.map((b) => b.textContent)}`);
	assert.equal(hbox.title, "Components side by side.");
	assert.deepEqual(host.failures, []);
});

// Pure messages (tutuca's pure: true and apply): a handler that takes no
// context, which a holder applies to a component it holds, synchronously,
// in its own task, with tutuca.apply; and runtime.apply, contractOf and
// supports from JS. A component with no views renders nothing.
test("pure messages are applied to held components, and break their contract with a code", async () => {
	const main = "shelf.tutuca.ts";
	const files = {
		[main]: `import { div, field, p, renderEach } from "tutuca/view";

export interface Item {
	setDone(done: boolean): Pure;
	picked(text: string): Notify;
}
export interface CardNotifies {
	picked(text: string): void;
}
export type Card = { text: string; done: boolean; archived: boolean };
export const Card = {
	implements: ["Item"],
	defaults: { text: "", done: false, archived: false },
	queries: {
		label(): string {
			return this.text;
		},
	},
	on: {
		setDone: {
			pure: true,
			changes: ["done"],
			why: "it's archived",
			pre(prev, [done]: [boolean]) {
				return !prev.archived;
			},
			post(prev, next, [done]: [boolean]) {
				return next.done === done;
			},
			run(next, [done]: [boolean]) {
				next.done = done;
			},
		},
		archive: {
			changes: ["archived"],
			run(next, [], ctx) {
				ctx.notify("picked", [this.text]);
				next.archived = true;
			},
		},
	},
	view: p({}, field("text")),
};
export type Shelf = { items: Item[] };
export const Shelf = {
	defaults: { items: [] },
	on: {
		markAll: {
			pure: true,
			changes: ["items"],
			run(next, []: []) {
				next.items = this.items.map((it) => tutuca.apply(it, "setDone", true));
			},
		},
	},
	view: div({}, renderEach(field("items"))),
};
export type Tally = { n: number };
export const Tally = {
	defaults: { n: 0 },
	constraints: { n: { int: true } },
	on: {
		add: {
			pure: true,
			constraints: { k: { int: true } },
			post(prev, next, [k]: [number]) {
				return next.n === prev.n + k;
			},
			run(next, [k]: [number]) {
				next.n = this.n + k;
			},
		},
	},
};
export const register = { Card: "Card", Shelf: "Shelf", Tally: "Tally" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const card = rt.make(scope, "Card", { text: "a" });
	const done = rt.apply(card, "setDone", [true]);
	assert.equal(rt.get(done.ok, "done"), true);
	assert.equal(rt.get(card, "done"), false, "applied outside a task, the component itself stays");
	const archived = rt.make(scope, "Card", { text: "b", archived: true });
	assert.deepEqual(rt.apply(archived, "setDone", [true]).err, {
		code: "pre",
		issues: ["pre"],
		detail: "it's archived",
		component: "Card",
		message: "setDone",
	});
	assert.equal(rt.apply(card, "archive").err.code, "not-pure");
	assert.equal(rt.apply(card, "nope").err.code, "unknown");
	assert.equal(rt.apply(card, "setDone", ["yes"]).err.code, "arg:0");
	assert.equal(rt.apply(card, "setDone", []).err.code, "args");
	const contract = rt.contractOf(card);
	assert.deepEqual(
		contract.implements.map(({ name, resolved, interface: it }) => [name, resolved, it.queries.map((q) => [q.name, q.returns.type]), it.notifies.map((n) => n.name)]),
		[["Item", true, [], ["picked"]]],
	);
	assert.deepEqual(contract.notifies, ["picked"]);
	assert.deepEqual(contract.queries[0].returns.type, "string");
	assert.deepEqual(rt.typeContractOf(scope, "Card"), contract);
	assert.equal(rt.typeContractOf(scope, "Nope"), null);
	assert.deepEqual(
		contract.messages.map((m) => [m.name, m.pure]),
		[
			["setDone", true],
			["archive", false],
		],
	);
	assert.deepEqual(contract.queries.map((q) => q.name), ["label"]);
	assert.deepEqual(rt.supports(card, "Item"), []);
	// Every gap, as tutuca's interfaceGaps lists them.
	assert.deepEqual(rt.supports(rt.make(scope, "Tally", {}), "Item"), ["it has no pure message setDone"]);
	assert.equal(rt.canApply(card, "setDone"), true);
	assert.equal(rt.canApply(card, "archive"), false);
	assert.equal(rt.canQuery(card, "label"), true);
	// In a task: the shelf applies setDone to each card, in its own task.
	const { window } = new JSDOM("");
	const shelfOf = (items) => rt.make(scope, "Shelf", { items });
	const container = window.document.createElement("div");
	const host = rt.createHost(window.document, container, shelfOf([card, rt.make(scope, "Card", { text: "c" })]), { dev: true }).mount();
	// From outside, a pure message applied at once to a component in the
	// tree (tutuca's host.apply), and a query and an address there.
	const records = [];
	host.listen((r) => records.push(r));
	host.apply("setDone", [true], { to: [["items", 1]] });
	assert.equal(rt.get(rt.get(host.root(), "items")[1], "done"), true);
	assert.throws(() => host.apply("archive", [], { to: [["items", 1]] }), (e) => e.code === "not-pure");
	assert.throws(() => host.apply("setDone", [true], { to: [["items", 9]] }), (e) => e.code === "not-component");
	assert.deepEqual(host.query("label", [], { to: [["items", 1]] }), { ok: "c" });
	assert.equal(host.query("label", [], { to: [["items", 9]] }).err.code, "not-component");
	assert.deepEqual(host.addressOf([["items", 1]]).path, ["items", 1]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(
		records.filter((r) => r.kind === "transition").map((r) => [r.mode, r.name, r.outcome]),
		[
			["apply", "setDone", "handled"],
			["apply", "archive", "failed"],
			["apply", "setDone", "failed"],
		],
	);
	host.send("markAll", [], { now: true });
	assert.deepEqual(
		rt.get(host.root(), "items").map((c) => rt.get(c, "done")),
		[true, true],
	);
	assert.deepEqual(host.failures, []);
	assert.deepEqual(host.issues, []);
	// A broken contract fails the task, saying why.
	const other = rt.createHost(window.document, window.document.createElement("div"), shelfOf([card, archived])).mount();
	other.send("markAll", [], { now: true });
	assert.match(other.failures[0].message, /Card can't apply setDone: pre \(it's archived\)/);
	assert.deepEqual(
		rt.get(other.root(), "items").map((c) => rt.get(c, "done")),
		[false, false],
		"the failed task changed nothing",
	);
	// A component with no views handles messages and renders nothing.
	const tally = rt.make(scope, "Tally", {});
	assert.equal(rt.get(rt.apply(tally, "add", [3]).ok, "n"), 3);
	const quiet = window.document.createElement("div");
	rt.createHost(window.document, quiet, tally).mount();
	assert.equal(quiet.textContent, "");
});

// namespace: makes the element, and what's in it, in that namespace, as
// tutuca's JS does: an SVG shape outside an svg element.
test("an element's namespace attribute makes it in that namespace", async () => {
	const main = "shapes.tutuca.ts";
	const files = {
		[main]: `import { circle, g } from "tutuca/view";

export type Shapes = {};
export const Shapes = { view: g({ namespace: "http://www.w3.org/2000/svg" }, circle({ r: "1" })) };
export const register = { Shapes: "Shapes" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Shapes", {})).mount();
	const svg = "http://www.w3.org/2000/svg";
	assert.equal(container.querySelector("g").namespaceURI, svg);
	assert.equal(container.querySelector("circle").namespaceURI, svg);
	assert.equal(container.querySelector("g").hasAttribute("namespace"), false);
});

// A task can leave an invariant broken for the tasks it queued; when the last
// of them fails, the queue is empty all the same, and the settled state is
// checked, as tutuca's JS checks it whenever the queue empties.
test("invariants are checked when the queue empties after a task that failed", async () => {
	const main = "gauge.tutuca.ts";
	const files = {
		[main]: `import { p } from "tutuca/view";

export interface GaugeAsks {
	count(): number;
}
export type Gauge = { ok: boolean };
export const Gauge = {
	defaults: { ok: true },
	invariants: {
		fine(): boolean {
			return this.ok;
		},
	},
	on: {
		spoil: {
			changes: ["ok"],
			run(next, [], ctx) {
				ctx.ask("count", []);
				next.ok = false;
			},
		},
	},
	answers: {
		count: {
			ok(next, [count]: [number], ctx) {},
		},
	},
	view: p({}, "x"),
};
export const register = { Gauge: "Gauge" };
export const hostAsks = ["count"];
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	// Not the number it's declared to answer with: the answer is rejected.
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Gauge", {}), { dev: true, asks: { count: () => "x" } });
	host.send("spoil", [], { now: true });
	assert.deepEqual(
		host.failures.map((e) => [e.rejection?.message, e.rejection?.answer]),
		[["count", "ok"]],
	);
	assert.deepEqual(
		host.issues.map((i) => [i.type, i.settled, i.issues.map((x) => x.reason)]),
		[["stateInvalid", true, ["invariant:fine"]]],
	);
});

// An ask handler answers now, wherever the module is registered, reading the
// asker's context (its scope) and logging; it can't send, which its context
// doesn't have.
test("an ask handler answers now, from the asker's scope, and logs, and can't send", async () => {
	const main = "oracle.tutuca.ts";
	const files = {
		[main]: `import { p } from "tutuca/view";

export interface OracleAsks {
	good(): number;
	names(): string[];
}
export type Oracle = { got: number; names: string[] };
export const Oracle = {
	defaults: { got: 0, names: [] },
	on: {
		askGood: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("good", []);
			},
		},
		askNames: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("names", []);
			},
		},
	},
	answers: {
		good: {
			ok(next, [got]: [number], ctx) {
				next.got = got;
			},
		},
		names: {
			ok(next, [names]: [string[]], ctx) {
				next.names = names;
			},
		},
	},
	view: p({}, "x"),
};
export const register = { Oracle: "Oracle" };
export const askHandlers = {
	good(): number {
		return 1;
	},
	names(ctx: AskCtx): string[] {
		ctx.log("x");
		return ctx.componentNames(false);
	},
};
`,
	};
	const sends = files[main].replace('ctx.log("x");', 'ctx.stopNext();');
	assert.deepEqual(
		compiler.check({ main, files: { [main]: sends } }).diags.map((d) => d.code),
		["purejs.unknown-method"],
	);
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Oracle", {}));
	host.send("askGood", [], { now: true });
	host.send("askNames", [], { now: true });
	assert.equal(tw.runtime.get(host.root(), "got"), 1);
	assert.deepEqual(tw.runtime.get(host.root(), "names"), ["Oracle"]);
	assert.deepEqual(host.logs, ["x"]);
	assert.deepEqual(host.failures, []);
});

// A component type is checked as tutuca's JS checks it, by the name the scope
// makes it by: where a Counter is loaded as Tally, a field of type Tally
// takes it.
test("a type loaded under another name is of that name", async () => {
	const main = "boxes.tutuca.ts";
	const files = {
		[main]: `import { div, field, p, render } from "tutuca/view";

export type Tally = { count: number };
export const Tally = {
	defaults: { count: 0 },
	constraints: { count: { int: true } },
	view: p({}, field("count")),
};
export type Box = { item: Tally };
export const Box = { view: div({}, render(field("item"))) };
export const register = { Tally: "Tally", Box: "Box" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags, []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope, { names: { Tally: null } });
	await tw.loadComponent(await readFile(new URL("dist/components/counter.wasm", root)), scope, { names: { Counter: "Tally" } });
	const item = tw.runtime.make(scope, "Tally", { count: 3 });
	assert.deepEqual(tw.runtime.issues(scope, "Box", { item }), []);
	const host = tw.runtime.createHost(null, null, tw.runtime.make(scope, "Box", { item }), { dev: true });
	assert.deepEqual(host.issues, []);
	assert.equal(tw.runtime.typeName(tw.runtime.get(host.root(), "item")), "Counter");
});

// pure-tutuca checks the event modifiers a view may write, and the runtime parses
// them: two lists, in two languages, that must name the same ones.
test("pure-tutuca and the runtime know the same event modifiers", async () => {
	const tcdList = (await read("pure-tutuca/check/views.mbt")).match(/pub let event_modifiers : Array\[String\] = \[([^\]]*)\]/)[1];
	const tcdMods = [...tcdList.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
	const imports = await read("src/imports.wax");
	const runtimeMods = [...imports.matchAll(/#\[import = "([a-z]+)"\]\s*const s_mod_\w+: js_string;/g)].map((m) => m[1]).sort();
	assert.ok(runtimeMods.length > 0);
	assert.deepEqual(tcdMods, runtimeMods);
});

// The constraints that read the component, a key of another field, are
// checked when it's made too, once it has its fields, as the field's own
// are: a required field that breaks one fails, another takes its default.
test("a key of another field, and a field's constraint, are checked when a component is made", async () => {
	const main = "picks.tutuca.ts";
	const files = {
		[main]: `import { field, p } from "tutuca/view";

export type Pick = { items: string[]; selected: number; n: number };
export const Pick = {
	defaults: { n: 2 },
	constraints: { selected: { keyOf: "items" }, n: { int: true, max: 2 } },
	view: p({}, field("n")),
};
export const register = { Pick: "Pick" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	assert.deepEqual(tw.runtime.issues(scope, "Pick", { items: ["a", "b"], selected: 1, n: 0 }), []);
	assert.throws(() => tw.runtime.make(scope, "Pick", { items: ["a", "b"], selected: 2 }), /selected/);
	assert.deepEqual(tw.runtime.issues(scope, "Pick", { items: ["a"], selected: 0, n: 3 }), [{ field: "n", problem: "invalid" }]);
	assert.equal(tw.runtime.get(tw.runtime.make(scope, "Pick", { items: ["a"], selected: 0, n: 3 }), "n"), 2);
});

// The score example's arithmetic, run: tallies of 5 (Math.floor and %), the
// leader, a percent rounded up, and points kept within the target.
test("the score example tallies, rounds and keeps points within the target", async () => {
	const path = "studio/assistant/examples/score";
	const res = compiler.build({ main: "score.tutuca.ts", files: { "score.tutuca.ts": await read(`${path}.tutuca.ts`) }, runtime });
	assert.equal(res.ok, true);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const score = tw.runtime.make(scope, "Score", { ours: 13, theirs: 7 });
	const get = (name) => tw.runtime.get(score, name);
	assert.equal(get("oursTally"), "▣▣ +3");
	assert.equal(get("theirsTally"), "▣ +2");
	assert.equal(get("status"), "Us leads by 6");
	assert.equal(get("left"), 17);
	assert.equal(get("percent"), 44);
	assert.equal(get("over"), false);
	const won = tw.runtime.make(scope, "Score", { ours: 30, theirs: 30, target: 30 });
	assert.equal(tw.runtime.get(won, "status"), "Tied");
	assert.equal(tw.runtime.get(tw.runtime.make(scope, "Score", { ours: 30, theirs: 2 }), "status"), "Us won");
});

test("a query takes arguments: the runtime checks them against its schema, then runs it", async () => {
	const main = "q/q.tutuca.ts";
	const text = `import { field, p } from "tutuca/view";
import { shout } from "tutuca/test/shout";

export type Lookup = { words: string[]; readonly count: number };
export const Lookup = {
	defaults: { words: [] },
	queries: {
		get count(): number {
			return this.words.length;
		},
		/** The word at i, or "" past the end. */
		nth(i: number): string {
			return this.words[i] ?? "";
		},
		plus(a: number, b: number): number {
			return a + b;
		},
		/** What the page's shout function makes of text. */
		shout(text: string): { loud: string } {
			return shout(text);
		},
	},
	view: p({}, field("count")),
};
export const register = { Lookup: "Lookup" };
`;
	const hostModules = [{ specifier: "tutuca/test/shout", module: "Shout", members: { shout: "(text: string) => { loud: string }" } }];
	const res = compiler.build({ main, files: { [main]: text }, runtime, hostModules });
	assert.deepEqual(
		res.diags.filter((d) => d.severity === "error"),
		[],
	);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const c = tw.runtime.make(scope, "Lookup", { words: ["a", "b"] });
	tw.runtime.defineHostFn("Shout.shout", (text) => {
		if (text === "") throw new Error("nothing to shout");
		return { loud: text.toUpperCase() };
	});
	assert.deepEqual(tw.runtime.query(c, "shout", ["hi"]), { ok: { loud: "HI" } });
	assert.deepEqual(tw.runtime.query(c, "nth", [1]), { ok: "b" });
	assert.deepEqual(tw.runtime.query(c, "nth", [5]), { ok: "" });
	assert.deepEqual(tw.runtime.query(c, "plus", [2, 3]), { ok: 5 });
	assert.equal(tw.runtime.query(c, "nth", ["x"]).err.code, "arg:0");
	assert.match(tw.runtime.query(c, "nth", []).err.detail, /argument/);
	assert.equal(tw.runtime.query(c, "nth", []).err.code, "args");
	assert.deepEqual(tw.runtime.query(c, "nope", []).err, { code: "unknown", issues: ["unknown"], detail: "no such query", component: "Lookup", message: "nope" });
	// A host call that throws fails the query, as any failure does, instead of throwing.
	const failed = tw.runtime.query(c, "shout", [""]).err;
	assert.equal(failed.code, "failed");
	assert.match(failed.detail, /nothing to shout/);
	const schema = tw.runtime.schema(c);
	assert.deepEqual(
		schema.queries.map((q) => [q.name, q.args.map((a) => a.name)]),
		[
			["nth", ["i"]],
			["plus", ["a", "b"]],
			["shout", ["text"]],
		],
	);
});

// What a task carries, as in tutuca's tree: its sender, so a handler replies
// to it (to the component that notified, from any hop; to the host, it's
// unhandled); a message for a place no component is at is dropped as
// orphaned; send without now waits for the next tick, with now it has run
// when send returns, as an event has.
test("tasks carry their sender: reply, orphaned, send now or later, events now", async () => {
	const main = "envelope.tutuca.ts";
	const files = {
		[main]: `import { button, div, field, input, render, send, targetValue } from "tutuca/view";

export interface ChildNotifies {
	pinged(): void;
}
export type Child = { pongs: number };
export const Child = {
	defaults: { pongs: 0 },
	constraints: { pongs: { int: true } },
	on: {
		ping: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("pinged", []);
			},
		},
		pong: {
			pure: true,
			changes: ["pongs"],
			run(next, []: []) {
				next.pongs = this.pongs + 1;
			},
		},
	},
	view: button({ class: "ping", "on:click": send("ping") }, field("pongs")),
};
export type Parent = { child: Child; text: string };
export const Parent = {
	defaults: { text: "" },
	on: {
		pinged: {
			changes: [],
			run(next, [], ctx) {
				ctx.reply("pong", []);
			},
		},
		echo: {
			changes: [],
			run(next, [], ctx) {
				ctx.reply("echoed", []);
			},
		},
		setText: {
			pure: true,
			changes: ["text"],
			run(next, [text]: [string]) {
				next.text = text;
			},
		},
	},
	view: div({}, render(field("child")), input({ class: "text", value: field("text"), "on:input": send("setText", targetValue()) })),
};
export const register = { Child: "Child", Parent: "Parent" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const records = [];
	const publish = (r) => records.push(r);
	const host = rt.createHost(window.document, container, rt.make(scope, "Parent", { child: rt.make(scope, "Child", {}), text: "" }), { dev: true, publish }).mount();
	const pongs = () => rt.get(rt.get(host.root(), "child"), "pongs");
	// The child notifies, the parent replies, the reply reaches the child.
	container.querySelector(".ping").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.equal(pongs(), 1);
	// What host.listen hears, as tutuca's: a Transition per task, in a chain
	// (cause, origin) from the host, and the host's events around them.
	const transitions = records.filter((r) => r.kind === "transition");
	assert.deepEqual(
		transitions.map(({ seq, cause, origin, mode, name, outcome, from, to }) => [seq, cause, origin, mode, name, outcome, from?.path ?? null, to.path]),
		[
			[1, null, 1, "send", "ping", "handled", null, ["child"]],
			[2, 1, 1, "notify", "pinged", "handled", ["child"], []],
			[3, 2, 1, "send", "pong", "handled", [], ["child"]],
		],
	);
	assert.deepEqual(transitions[0].emitted, [{ kind: "notify", name: "pinged", args: [] }]);
	assert.deepEqual(transitions[1].emitted, [{ kind: "reply", name: "pong", args: [] }]);
	assert.deepEqual(
		records.filter((r) => r.kind === "hostEvent").map((r) => [r.type, r.upTo ?? null]),
		[
			["started", null],
			["rendered", null],
			["settled", null],
			["rendered", 3],
			["settled", 3],
		],
	);
	assert.deepEqual(records.map((r) => r.n), records.map((_, i) => i + 1));
	records.length = 0;
	// From the host, a reply is unhandled: the host has no handlers.
	host.send("echo", [], { now: true });
	assert.deepEqual(host.unhandled, ["echoed"]);
	// Later: queued until the next tick.
	const seq = host.send("ping", [], { to: ["child"] });
	assert.equal(typeof seq, "number");
	assert.equal(pongs(), 1);
	await host.settled();
	assert.equal(pongs(), 2);
	// Nobody at the place it's sent to: orphaned.
	host.send("ping", [], { to: ["text"], now: true });
	assert.deepEqual(host.reports.filter((r) => r.type === "orphaned").map((r) => r.message), ["ping"]);
	assert.deepEqual(
		records.filter((r) => r.kind === "transition").map((r) => [r.name, r.outcome, r.unhandled]),
		[
			["echo", "handled", ["echoed"]],
			["ping", "handled", []],
			["pinged", "handled", []],
			["pong", "handled", []],
			["ping", "orphaned", []],
		],
	);
	// An event runs now, and so does what waited for the next tick: a run
	// takes the whole queue, the event first.
	const input = container.querySelector(".text");
	host.send("ping", [], { to: ["child"] });
	input.value = "a";
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.equal(rt.get(host.root(), "text"), "a");
	assert.equal(pongs(), 3);
	assert.deepEqual(host.failures, []);
	assert.deepEqual(host.issues, []);
	// Stopped, it says so and runs nothing more.
	host.send("ping", [], { to: ["child"] });
	host.unmount();
	await host.settled();
	assert.equal(pongs(), 3);
	assert.equal(records.at(-1).type, "stopped");
});

// Watches, as tutuca's sendAt with { settled, progress, timeout }: what a
// message causes is counted, and once none of it is left the watcher gets
// settled with a report; progress tells it along the way; a cancel drops
// what's queued and aborts the asks it waits for; a timeout cancels it.
test("a watch settles once what a message caused ran, and can be cancelled or time out", async () => {
	const main = "watched.tutuca.ts";
	const files = {
		[main]: `import { div, field, p, render } from "tutuca/view";
import { get } from "tutuca/data";

const SELF: string[] = [];

export interface WorkerAsks {
	slow(): number;
}
export type Worker = { steps: number };
export const Worker = {
	defaults: { steps: 0 },
	constraints: { steps: { int: true } },
	on: {
		work: {
			changes: [],
			run(next, [], ctx) {
				ctx.sendAt("step", [], SELF);
				ctx.sendAt("step", [], SELF);
			},
		},
		slowWork: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("slow", []);
			},
		},
		step: {
			pure: true,
			changes: ["steps"],
			run(next, []: []) {
				next.steps = this.steps + 1;
			},
		},
	},
	answers: {
		slow: {
			ok(next, [steps]: [number], ctx) {
				next.steps = steps;
			},
		},
	},
	view: p({}, field("steps")),
};
export type Boss = { worker: Worker; watch: number; outcome: string; tasks: number; seen: number };
export const Boss = {
	defaults: { watch: 0, outcome: "", tasks: 0, seen: 0 },
	constraints: { watch: { int: true }, tasks: { int: true }, seen: { int: true } },
	on: {
		start: {
			changes: ["watch"],
			run(next, [timeout]: [number], ctx) {
				next.watch = ctx.sendAt("work", [], "worker", { settled: "done", progress: "progressed", timeout }) ?? -1;
			},
		},
		startSlow: {
			changes: ["watch"],
			run(next, [timeout]: [number], ctx) {
				next.watch = ctx.sendAt("slowWork", [], "worker", { settled: "done", progress: "progressed", timeout }) ?? -1;
			},
		},
		stop: {
			changes: [],
			run(next, [], ctx) {
				ctx.cancel(this.watch);
			},
		},
		done: {
			pure: true,
			changes: ["outcome", "tasks"],
			run(next, [report]: [unknown]) {
				const outcome = get(report, "outcome");
				const tasks = get(report, "tasks");
				if (typeof outcome === "string") next.outcome = outcome;
				if (typeof tasks === "number") next.tasks = tasks;
			},
		},
		progressed: {
			pure: true,
			changes: ["seen"],
			run(next, [report]: [unknown]) {
				next.seen = this.seen + 1;
			},
		},
	},
	view: div({}, render(field("worker"))),
};
export const register = { Worker: "Worker", Boss: "Boss" };
export const hostAsks = ["slow"];
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	let signal = null;
	const slow = function () {
		signal = this.signal;
		return new Promise((resolve) => setTimeout(() => resolve(7), 50));
	};
	const records = [];
	const boss = () => rt.make(scope, "Boss", { worker: rt.make(scope, "Worker", {}), outcome: "", tasks: 0, seen: 0, watch: 0 });
	const get = (h, name) => rt.get(h.root(), name);
	// Settled once work and the two steps it sent ran, progress along the way.
	const host = rt.createHost(null, null, boss(), { dev: true, asks: { slow }, publish: (r) => records.push(r) }).mount();
	host.send("start", [-1], { now: true });
	assert.equal(rt.get(get(host, "worker"), "steps"), 2);
	assert.equal(get(host, "outcome"), "ok");
	assert.equal(get(host, "tasks"), 3);
	assert.ok(get(host, "seen") >= 1);
	assert.deepEqual(
		records.filter((r) => r.type?.startsWith("watch")).map((r) => [r.type, r.watch, r.outcome ?? null]),
		[
			["watchOpened", 1, null],
			["watchSettled", 1, "ok"],
		],
	);
	assert.deepEqual(
		records.filter((r) => r.kind === "transition" && r.watch === 1).map((r) => r.name),
		["work", "step", "step"],
	);
	// Cancelled, its ask's answer is dropped and its signal aborted.
	host.send("startSlow", [-1], { now: true });
	assert.equal(get(host, "outcome"), "ok");
	host.send("stop", [], { now: true });
	assert.equal(get(host, "outcome"), "cancelled");
	assert.equal(signal.aborted, true);
	assert.ok(records.some((r) => r.kind === "transition" && r.outcome === "dropped" && r.name === "slow"));
	await new Promise((resolve) => setTimeout(resolve, 80));
	await host.settled();
	assert.equal(rt.get(get(host, "worker"), "steps"), 2, "the answer of a cancelled ask is ignored");
	// Timed out.
	host.send("startSlow", [10], { now: true });
	await new Promise((resolve) => setTimeout(resolve, 30));
	await host.settled();
	assert.equal(get(host, "outcome"), "timeout");
	assert.deepEqual(host.failures, []);
	assert.deepEqual(host.issues, []);
	host.unmount();
});

// A view runs the component's queries, as tutuca's $query: query(name,
// args...), the arguments literals or value reads of the parameters' types.
test("views run the component's queries", async () => {
	const main = "q.tutuca.ts";
	const source = (view) => `import { field, p, query } from "tutuca/view";

export type Sum = { n: number };
export const Sum = {
	defaults: { n: 0 },
	constraints: { n: { int: true } },
	queries: {
		plus(k: number): number {
			return this.n + k;
		},
	},
	on: {
		inc: {
			pure: true,
			changes: ["n"],
			run(next, []: []) {
				next.n = this.n + 1;
			},
		},
	},
	view: ${view},
};
export const register = { Sum: "Sum" };
`;
	const codes = (view) => compiler.check({ main, files: { [main]: source(view) } }).diags.map((d) => d.code);
	assert.deepEqual(codes('p({}, query("nope"))'), ["pure-tutuca.view.query"]);
	assert.deepEqual(codes('p({}, query("plus"))'), ["pure-tutuca.view.arity"]);
	assert.deepEqual(codes('p({}, query("plus", "x"))'), ["pure-tutuca.view.query"]);
	const files = { [main]: source('p({ class: "sum" }, query("plus", field("n")), " ", query("plus", 10))') };
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const scope = tw.runtime.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const host = tw.runtime.createHost(window.document, container, tw.runtime.make(scope, "Sum", { n: 2 }), { dev: true }).mount();
	assert.equal(container.querySelector(".sum").textContent, "4 12");
	host.send("inc", [], { now: true });
	assert.equal(container.querySelector(".sum").textContent, "6 13");
	assert.deepEqual(host.failures, []);
});

// The render cache, as tutuca's CopyCache: a component renders again only
// when its instance, its view or a provided value it reads changed, and a
// cached page renders what an uncached one does.
test("the render cache reuses unchanged components and renders what no cache does", async () => {
	const main = "cached.tutuca.ts";
	const files = {
		[main]: `import { div, field, provided, render, renderEach, span } from "tutuca/view";

export type Cell = { n: number };
export const Cell = {
	defaults: { n: 0 },
	constraints: { n: { int: true } },
	on: {
		bump: {
			pure: true,
			changes: ["n"],
			run(next, []: []) {
				next.n = this.n + 1;
			},
		},
	},
	view: span({ class: "cell" }, field("n"), " ", provided("mode")),
	views: { plain: span({ class: "cell" }, field("n")) },
};
export type Grid = { mode: string; sets: number; cells: Cell[]; plain: Cell };
export const Grid = {
	defaults: { mode: "", sets: 0, cells: [] },
	constraints: { sets: { int: true } },
	provides: { mode: "mode" },
	on: {
		/** Counted, so the same mode still makes a new instance. */
		setMode: {
			pure: true,
			changes: ["mode", "sets"],
			run(next, [mode]: [string]) {
				next.mode = mode;
				next.sets = this.sets + 1;
			},
		},
		bump: {
			pure: true,
			changes: ["cells"],
			constraints: { i: { keyOf: "cells" } },
			run(next, [i]: [number]) {
				const cell = this.cells[i];
				if (cell === undefined) return;
				next.cells[i] = tutuca.apply(cell, "bump");
			},
		},
		add: {
			changes: ["cells"],
			run(next, [], ctx) {
				next.cells.push(ctx.make("Cell"));
			},
		},
	},
	view: div({}, renderEach(field("cells")), render(field("plain"), "plain")),
};
export const register = { Cell: "Cell", Grid: "Grid" };
`,
	};
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const { window } = new JSDOM("");
	const grid = () => rt.make(scope, "Grid", { mode: "a", cells: [0, 1, 2].map((n) => rt.make(scope, "Cell", { n })), plain: rt.make(scope, "Cell", { n: 9 }) });
	const mounted = (renderCache) => {
		const container = window.document.createElement("div");
		const host = rt.createHost(window.document, container, grid(), { dev: true, renderCache }).mount();
		return { host, container };
	};
	const cached = mounted(true);
	const uncached = mounted(false);
	const steps = [
		["bump", [1]],
		["setMode", ["b"]],
		["add", []],
		["bump", [3]],
		["setMode", ["b"]],
		["bump", [0]],
	];
	let last = cached.host.cacheStats();
	const misses = [];
	for (const [name, args] of steps) {
		cached.host.send(name, args, { now: true });
		uncached.host.send(name, args, { now: true });
		assert.equal(cached.container.innerHTML, uncached.container.innerHTML, `after ${name}`);
		const now = cached.host.cacheStats();
		misses.push(now.misses - last.misses);
		last = now;
	}
	// Bumping a cell renders the grid and that cell; the mode, every cell
	// that reads it but not the plain one, which doesn't; the same mode, the
	// grid alone (sets makes a new instance, but what the cells read is as it
	// was); adding, the grid and the new cell.
	assert.deepEqual(misses, [2, 4, 2, 2, 1, 2]);
	assert.deepEqual(uncached.host.cacheStats(), { hits: 0, misses: 0 });
	assert.deepEqual(cached.host.failures, []);
});

// A made default that can't be made says each field on the way, as
// tutuca's prefixed does; a component provides an item of a list field at
// the key another field holds, as tutuca's provides take any selector.
test("nested defaults say where they failed, and a provide is a field or an item of one", async () => {
	const main = "nest.tutuca.ts";
	const files = {
		[main]: `import { div, field, p, provided, render, span } from "tutuca/view";

export type Leaf = { id: number };
export const Leaf = { defaults: { id: 0 }, constraints: { id: { int: true } }, view: p({}, "leaf") };
export type Mid = { leaf: Leaf };
export const Mid = { view: p({}, "mid") };
export type Outer = { mid: Mid };
export const Outer = { view: p({}, "outer") };
export type Reader = { n: number };
export const Reader = { defaults: { n: 0 }, constraints: { n: { int: true } }, view: span({ class: "picked" }, provided("picked")) };
export type Picker = { names: string[]; current: number; reader: Reader };
export const Picker = {
	defaults: { names: [], current: 0 },
	constraints: { current: { int: true } },
	provides: { picked: { seqItem: "names", keyField: "current" } },
	view: div({}, render(field("reader"))),
};
export const register = { Mid: "Mid", Outer: "Outer", Reader: "Reader", Picker: "Picker" };
`,
	};
	assert.deepEqual(
		compiler.check({ main, files: { [main]: files[main].replace('{ seqItem: "names", keyField: "current" }', '{ seqItem: "current", keyField: "names" }') } }).diags.map((d) => d.code),
		["pure-tutuca.provide.field"],
	);
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	// Leaf isn't registered here: Mid's default can't be made, nor Outer's.
	assert.throws(() => rt.make(scope, "Outer", {}), /^Error: Outer\.mid: Mid\.leaf: No component type is registered as Leaf/);
	const { window } = new JSDOM("");
	const container = window.document.createElement("div");
	const picker = rt.make(scope, "Picker", { names: ["a", "b"], current: 1, reader: rt.make(scope, "Reader", {}) });
	rt.createHost(window.document, container, picker).mount();
	assert.equal(container.querySelector(".picked").textContent, "b");
});

// A public field is also a query, as tutuca's public: true: what others read it
// by, in the contract, through runtime.query, and what an interface's member
// takes.
test("a public field is a query too, and meets an interface's member", async () => {
	const main = "pub.tutuca.ts";
	const files = {
		[main]: `import { field, p } from "tutuca/view";

export interface Named {
	readonly name: string;
}
export type Tag = { name: string; hidden: number };
export const Tag = {
	implements: ["Named"],
	defaults: { name: "", hidden: 0 },
	constraints: { hidden: { int: true } },
	public: ["name"],
	view: p({}, field("name")),
};
export const register = { Tag: "Tag" };
`,
	};
	const bad = files[main].replace("export type Tag = { name: string;", "export type Tag = { name: number;").replace('defaults: { name: ""', "defaults: { name: 0");
	assert.deepEqual(compiler.check({ main, files: { [main]: bad } }).diags.map((d) => d.code), ["pure-tutuca.interface.type"]);
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const tag = rt.make(scope, "Tag", { name: "x" });
	assert.deepEqual(rt.query(tag, "name"), { ok: "x" });
	assert.equal(rt.query(tag, "hidden").err.code, "unknown");
	assert.equal(rt.canQuery(tag, "name"), true);
	assert.deepEqual(rt.contractOf(tag).queries.map((q) => [q.name, q.returns.type]), [["name", "string"]]);
	assert.deepEqual(rt.schema(tag).fields.map((f) => [f.name, f.public ?? false]), [
		["name", true],
		["hidden", false],
	]);
	assert.deepEqual(rt.supports(tag, "Named"), []);
});

// A component renders more than a page, by target, as tutuca's renders: its
// views for a target are written in the target's nodes (md's Paragraph,
// Strong), and render to plain data the target's renderer lowers.
test("views for a render target render to its nodes, as data", async () => {
	const main = "md.tutuca.ts";
	const files = {
		[main]: `import { field, h, li, p, renderEach } from "tutuca/view";

export type Item = { text: string };
export const Item = {
	defaults: { text: "" },
	view: li({}, field("text")),
	renders: { md: h("ListItem", {}, h("Paragraph", {}, field("text"))) },
};
export type Note = { title: string; count: number; items: Item[] };
export const Note = {
	defaults: { title: "", count: 0, items: [] },
	constraints: { count: { int: true } },
	view: p({}, field("title")),
	renders: {
		md: {
			main: h(
				"Root",
				{},
				h("Heading", { depth: 1 }, field("title")),
				h("Paragraph", {}, "Count: ", h("Strong", {}, field("count"))),
				h("List", {}, renderEach(field("items"))),
			),
			brief: h("Paragraph", {}, field("title")),
		},
	},
};
export type Plain = { n: number };
export const Plain = { defaults: { n: 0 }, constraints: { n: { int: true } }, view: p({}, field("n")) };
export const register = { Item: "Item", Note: "Note", Plain: "Plain" };
`,
	};
	const noMain = files[main].replace("main: h(", "other: h(");
	assert.ok(compiler.check({ main, files: { [main]: noMain } }).diags.some((d) => d.code === "pure-tutuca.view.main"));
	const res = compiler.build({ main, files, runtime });
	assert.deepEqual(res.diags.filter((d) => d.severity === "error"), []);
	const tw = await load(new URL("dist/tutuca-rt.wasm", root));
	const rt = tw.runtime;
	const scope = rt.scope();
	await tw.loadComponent(res.wasm, scope);
	const note = rt.make(scope, "Note", { title: "T", count: 2, items: [rt.make(scope, "Item", { text: "a" })] });
	const el = (tag, attrs, ...children) => ({ tag, attrs, children });
	assert.deepEqual(rt.renderTarget(note, "md"), [
		el(
			"Root",
			{},
			el("Heading", { depth: 1 }, "T"),
			el("Paragraph", {}, "Count: ", el("Strong", {}, "2")),
			el("List", {}, el("ListItem", {}, el("Paragraph", {}, "a"))),
		),
	]);
	assert.deepEqual(rt.renderTarget(note, "md", { view: "brief" }), [el("Paragraph", {}, "T")]);
	// One without views for the target fails, unless the target falls back
	// to the page's views.
	const plain = rt.make(scope, "Plain", { n: 1 });
	assert.throws(() => rt.renderTarget(plain, "md"), /Component Plain has no md render/);
	assert.deepEqual(rt.renderTarget(plain, "tui", { fallsBackToViews: true }), [el("p", {}, "1")]);
});

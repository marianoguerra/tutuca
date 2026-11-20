// tutuca/pure's componentModule: a component written as a pure-tutuca module (a pure-js module
// in the shape of component({...})), checked and compiled, then run as any component is.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { specOf } from "../../src/core/model/spec.js";
import { componentModule } from "../../src/pure/module.js";
import { Driver } from "../../src/testing/driver.js";
import { Scope } from "../../src/tutuca.js";
import { document, setupHost } from "../helpers.js";

const todoSource = readFileSync(
	new URL("../../components/pure-todo/todo.tutuca.ts", import.meta.url),
	"utf8",
);

const driverOf = (components, name, args) => {
	const scope = new Scope();
	scope.register(components);
	return new Driver({ root: scope.make(name, args) });
};

// tutuca-wasm's todo modules: todo_list declares the TodoItem interface, todo_item and todo_card
// implement it, importing it from todo_list.tutuca.ts.
const waxComponents = fileURLToPath(new URL("../../tutuca-wasm/components/", import.meta.url));
// How the module in file reads the modules it imports: relative to it, .ts added.
const resolveFrom = (file) => (spec) => {
	const p = join(dirname(file), spec.endsWith(".ts") ? spec : `${spec}.ts`);
	return existsSync(p) ? readFileSync(p, "utf8") : null;
};
const waxFile = (name) => join(waxComponents, name, `${name}.tutuca.ts`);
const waxModule = (name) =>
	componentModule(readFileSync(waxFile(name), "utf8"), { resolve: resolveFrom(waxFile(name)) });

describe("componentModule, modules that import each other", () => {
	test("a module implements an interface another declares, imported for its types", () => {
		const list = waxModule("todo_list");
		const item = waxModule("todo_item");
		assert.deepEqual([list.diagnostics, item.diagnostics], [[], []]);
		assert.deepEqual(Object.keys(list.interfaces), ["TodoItem"]);
		const scope = new Scope();
		scope.registerInterfaces(list.interfaces);
		scope.register({ ...list.components, ...item.components });
		const d = new Driver({ root: scope.make("TodoList", {}) });
		for (const text of ["milk", "bread"]) {
			d.send("setDraft", [text]);
			d.send("addTodo");
		}
		d.send("completeAll");
		assert.deepEqual(d.problems, []);
		assert.deepEqual(
			d.state.items.map((i) => [i.id, i.text, i.done]),
			[
				[0, "milk", true],
				[1, "bread", true],
			],
		);
		assert.equal(d.state.remaining, 0);
		d.send("moveItem", [1, 0]);
		assert.deepEqual(
			d.state.items.map((i) => i.text),
			["bread", "milk"],
		);
	});
	test("an import that isn't of types, or names nothing there, doesn't load", () => {
		const source = readFileSync(waxFile("todo_item"), "utf8");
		const resolve = resolveFrom(waxFile("todo_item"));
		const value = componentModule(
			source.replace("import type { TodoItem as", "import { TodoItem as"),
			{ resolve },
		);
		const missing = componentModule(source.replace("TodoItem as TodoItemInterface", "Nope"), {
			resolve,
		});
		assert.deepEqual(
			[value, missing].map((r) => r.diagnostics.map((d) => d.message)),
			[
				[
					'a component module is imported for its types: import type { ... } from "../todo_list/todo_list.tutuca.ts"',
				],
				["../todo_list/todo_list.tutuca.ts declares no type Nope"],
			],
		);
	});
});

describe("componentModule, tutuca-wasm's counter", () => {
	test("asks answered by the module and by the host, a swap, sends to children", () => {
		const counter = waxModule("counter");
		assert.deepEqual(counter.diagnostics, []);
		assert.deepEqual(
			[Object.keys(counter.askHandlers), counter.hostAsks],
			[["loadCount"], ["fetchCount"]],
		);
		const scope = new Scope();
		scope.register(counter.components);
		scope.registerAskHandlers({ ...counter.askHandlers, fetchCount: () => 7 });
		const d = new Driver({ root: scope.make("Board", {}) });
		d.send("addCounter");
		d.send("addCounter");
		d.send("add", [5], { to: { item: "counters", key: 0 } });
		d.send("inc", [], { to: { item: "counters", key: 1 } });
		assert.deepEqual([d.state.counters.map((c) => c.count), d.state.total], [[5, 2], 1]);
		d.send("resetAll");
		assert.deepEqual(
			d.state.counters.map((c) => c.count),
			[0, 0],
		);
		d.send("load", [], { to: { item: "counters", key: 0 } });
		d.send("fetch", [], { to: { item: "counters", key: 1 } });
		assert.deepEqual(
			d.state.counters.map((c) => c.count),
			[42, 7],
		);
		d.send("toLabel", [], { to: { item: "counters", key: 0 } });
		assert.equal(d.state.counters[0].text, "was 42");
		assert.deepEqual(d.problems, []);
	});
});

describe("componentModule, tutuca-wasm's pbt fixture", () => {
	test("its seeded bug breaks a post in tutuca too, and a guard refuses what isn't enabled", () => {
		const pbt = waxModule("pbt");
		assert.deepEqual(pbt.diagnostics, []);
		const d = driverOf(pbt.components, "Tally", { count: 8 });
		d.send("add", [3]);
		assert.deepEqual(d.problems, []);
		d.send("add", [4]);
		assert.equal(d.state.count, 16);
		const reasons = (driver) =>
			driver.problems.flatMap((p) => p.issues.map((i) => `${i.message}: ${i.reason}`));
		assert.deepEqual(reasons(d), ["add: post"]);
		const lamp = driverOf(pbt.components, "Lamp", {});
		lamp.send("repair");
		assert.equal(lamp.state.mode, "off");
		assert.deepEqual(reasons(lamp), ["repair: pre"]);
	});
});

describe("componentModule, tutuca-wasm's showcase", () => {
	test("a scope's binds, loop hooks, a seq item, a provided value, pushView and renderIt render", () => {
		const showcase = waxModule("showcase");
		assert.deepEqual(showcase.diagnostics, []);
		const { host, rootNode, C, failures, click } = setupHost(showcase.components, {
			dev: true,
			sync: true,
		});
		host.start(
			C.Shelf({
				books: [
					{ title: "Dune", year: 1965, read: true },
					{ title: "Emma", year: 1815, read: false },
					{ title: "Ulysses", year: 1922, read: false },
				],
				tags: ["a", "b", "c"],
				current: 1,
				theme: "dark",
				note: C.Note({ text: "pinned" }),
				notes: [C.Note({ text: "x" }), C.Note({ text: "y" })],
			}),
		);
		const texts = (selector) => [...rootNode.querySelectorAll(selector)].map((e) => e.textContent);
		assert.equal(rootNode.querySelector("h2").textContent, "3 books");
		assert.deepEqual(texts("ul li"), ["Dune (1965)", "Emma (1815)", "Ulysses (1922)"]);
		assert.deepEqual(texts(".by-year span"), ["Emma", "Ulysses", "Dune"]);
		assert.equal(rootNode.querySelector("p.tag").textContent, "b");
		assert.equal(rootNode.querySelector("progress + span").textContent, "1 of 3 read");
		assert.equal(rootNode.querySelector("small").className, "dark");
		assert.deepEqual(texts(".notes p.note"), ["x", "y"]);
		click(rootNode.querySelector("button"));
		assert.deepEqual(texts("ul li"), ["Emma (1815)", "Ulysses (1922)"]);
		assert.deepEqual(failures, []);
	});
	test("a drop logs what's dragged, its key the book's, and moves it; a book on a note names it", () => {
		const { components } = waxModule("showcase");
		const scope = new Scope();
		scope.register(components);
		const C = scope.components;
		const books = ["Dune", "Emma", "Ulysses"].map((title, i) => ({
			title,
			year: 1900 + i,
			read: false,
		}));
		const d = new Driver({
			root: C.Shelf({ books, notes: [C.Note({ text: "x" })] }),
			document,
		});
		const lis = () => [...d.rootNode.querySelectorAll("ul li")];
		d.drag(lis()[0], lis()[2]);
		assert.deepEqual(d.problems, []);
		assert.deepEqual(
			d.state.books.map((b) => b.title),
			["Emma", "Ulysses", "Dune"],
		);
		const moved = d.transitions.find((r) => r.name === "moveBook");
		assert.deepEqual(
			moved.logs.map(({ type, key, value }) => ({ type, key, title: value.title })),
			[{ type: "book", key: 0, title: "Dune" }],
		);
		d.drag(lis()[1], d.rootNode.querySelector(".notes p.note"));
		assert.deepEqual(
			d.state.notes.map((n) => n.text),
			["Ulysses"],
		);
	});
});

describe("componentModule, tutuca-wasm's kanban", () => {
	test("init's lanes, a card added with Enter, dragged between lanes and onto a card, tagged, removed", () => {
		const kanban = waxModule("kanban");
		assert.deepEqual(kanban.diagnostics, []);
		const scope = new Scope();
		scope.register(kanban.components);
		const d = new Driver({ root: scope.make("Kanban"), document });
		assert.deepEqual(d.problems, []);
		const text = (sel) => d.rootNode.querySelector(sel).textContent;
		const lanes = () =>
			[...d.rootNode.querySelectorAll(".kanban-lane")].map((l) =>
				[...l.querySelectorAll(".kanban-text")].map((t) => t.textContent),
			);
		const card = (s) =>
			[...d.rootNode.querySelectorAll(".kanban-card")].find((c) => c.textContent.includes(s));
		assert.deepEqual(lanes(), [
			["Drop a .wasm on a screen", "Export the board", "Cards forget their lane"],
			["Drag cards between lanes"],
			["Write the module"],
		]);
		assert.equal(text(".kanban-progress"), "1 of 5 done");
		const draft = d.rootNode.querySelector(".kanban-draft");
		d.fire("input", draft, { value: "A new idea" });
		d.fire("keydown", draft, { key: "a" });
		assert.equal(d.state.nextId, 6, "a key that isn't Enter adds nothing");
		const enter = new document.defaultView.KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		draft.dispatchEvent(enter);
		d.drain();
		assert.equal(enter.defaultPrevented, true);
		assert.equal(d.state.nextId, 7);
		assert.equal(lanes()[0].at(-1), "A new idea");
		d.drag(card("Drop a .wasm"), d.rootNode.querySelector('.kanban-lane[data-lane="doing"] h3'));
		d.drag(card("A new idea"), card("Drag cards"));
		assert.deepEqual(lanes()[1], [
			"A new idea",
			"Drag cards between lanes",
			"Drop a .wasm on a screen",
		]);
		assert.equal(d.rootNode.querySelector(".kanban-lane.over .kanban-count").textContent, "3/2");
		const tag = (s) => card(s).querySelector(".kanban-tag");
		d.fire("click", tag("A new idea"));
		assert.equal(tag("A new idea").textContent, "bug");
		assert.match(tag("A new idea").className, /badge-error/);
		d.fire("click", card("Cards forget").querySelector(".kanban-remove"));
		assert.equal(text(".kanban-progress"), "1 of 5 done");
		assert.deepEqual(d.problems, []);
	});
});

describe("componentModule, tutuca-wasm's json", () => {
	// A JSON value as the module's components.
	const fromJson = (scope, v) => {
		if (v === null) return scope.make("JsonNull");
		if (typeof v === "boolean") return scope.make("JsonBool", { value: v });
		if (typeof v === "number") return scope.make("JsonNumber", { value: v, text: String(v) });
		if (typeof v === "string") return scope.make("JsonString", { value: v });
		if (Array.isArray(v))
			return scope.make("JsonArray", { items: v.map((x) => fromJson(scope, x)) });
		return scope.make("JsonObject", {
			entries: Object.entries(v).map(([key, x]) =>
				scope.make("JsonEntry", { key, value: fromJson(scope, x) }),
			),
		});
	};
	const jsonScope = () => {
		const json = waxModule("json");
		assert.deepEqual(json.diagnostics, []);
		const scope = new Scope();
		scope.registerInterfaces(json.interfaces);
		scope.register(json.components);
		return scope;
	};

	test("defaults make the first component named; the text is JSON.stringify's", () => {
		const scope = jsonScope();
		const editor = scope.make("JsonEditor", { mode: "edit" });
		assert.equal(specOf(editor.value).name, "JsonNull");
		assert.equal(specOf(scope.make("JsonEntry", { key: "k" }).value).name, "JsonSelector");
		const doc = {
			name: 'say "hi"\n',
			count: 2.5,
			tags: ["a", 1, true, null],
			empty: [],
			nested: { none: {}, ok: false },
		};
		const d = new Driver({
			root: scope.make("JsonEditor", { value: fromJson(scope, doc), showText: true }),
			document,
		});
		assert.deepEqual(d.problems, []);
		assert.equal(d.rootNode.querySelector("pre").textContent, JSON.stringify(doc, null, 2));
	});

	test("the editor edits every value in place, a selector swapped for the kind picked", () => {
		const scope = jsonScope();
		const doc = { s: "x", n: 1, b: false, list: [1, 2] };
		const d = new Driver({
			root: scope.make("JsonEditor", { value: fromJson(scope, doc), showText: true }),
			document,
		});
		const text = () => JSON.parse(d.rootNode.querySelector("pre").textContent);
		const buttons = (label) =>
			[...d.rootNode.querySelectorAll("button")].filter((b) => b.textContent === label);
		d.fire("click", buttons("Edit")[0]);
		const inputs = () => [...d.rootNode.querySelectorAll("input:not([type=checkbox])")];
		const [keyS, valueS] = inputs();
		d.fire("input", valueS, { value: 'y"' });
		d.fire("input", keyS, { value: "str" });
		const number = d.rootNode.querySelector("input[inputmode=decimal]");
		d.fire("input", number, { value: "4e1" });
		d.fire("input", number, { value: "abc" });
		assert.ok(
			d.rootNode.querySelector("input[inputmode=decimal]").classList.contains("text-error"),
		);
		d.fire("click", buttons("false")[0]);
		d.fire("click", d.rootNode.querySelectorAll("button[title='Move up']")[4]);
		assert.deepEqual(text().list, [2, 1]);
		d.fire("click", d.rootNode.querySelectorAll("button[title=Remove]")[4]);
		d.fire("click", buttons("+ item")[0]);
		assert.deepEqual(text().list, [2, null]);
		d.fire("click", d.rootNode.querySelector("[aria-label='Pick a type'] button[title=string]"));
		d.fire("click", buttons("+ entry")[0]);
		d.fire(
			"click",
			[...d.rootNode.querySelectorAll("[aria-label='Pick a type'] button[title=array]")].at(-1),
		);
		assert.deepEqual(text(), { str: 'y"', n: 40, b: true, list: [2, ""], key5: [] });
		d.fire("click", buttons("View")[0]);
		assert.equal(inputs().length, 0);
		assert.deepEqual(d.problems, []);
	});
});

describe("componentModule, tutuca-wasm's layout", () => {
	test("a hole lists what its scope makes, labeled by their display meta, and becomes the one picked", () => {
		const layout = waxModule("layout");
		assert.deepEqual(layout.diagnostics, []);
		const scope = new Scope();
		scope.register(layout.components);
		scope.registerAskHandlers(layout.askHandlers);
		const d = new Driver({ root: scope.make("Screen", { editing: true }), document });
		assert.deepEqual(d.problems, []);
		const buttons = (label) =>
			[...d.rootNode.querySelectorAll("button")].filter((b) => b.textContent === label);
		d.fire("click", d.rootNode.querySelector("button[title='Put a component here']"));
		const choices = [...d.rootNode.querySelectorAll(".choices button")].map((b) => b.textContent);
		assert.deepEqual(choices, ["▦ Grid", "➡️ Horizontal box", "🗂 Tabs", "⬇️ Vertical box"]);
		d.fire("click", buttons("🗂 Tabs")[0]);
		assert.equal(specOf(d.state.content.items[0]).name, "Tabs");
		// The tabs start with one, named Tab 1 until it's given a name; + adds a second, shown.
		assert.deepEqual(
			[...d.rootNode.querySelectorAll(".tab-name")].map((i) => i.placeholder),
			["Tab 1"],
		);
		d.fire("click", d.rootNode.querySelector(".tab-add"));
		assert.equal(d.state.content.items[0].active, 1);
		d.fire("input", d.rootNode.querySelectorAll(".tab-name")[1], { value: "" });
		d.fire("change", d.rootNode.querySelectorAll(".tab-name")[1]);
		assert.deepEqual(d.state.content.items[0].labels, ["", "Tab 2"]);
		// Used, not edited: no chrome.
		d.fire("click", d.rootNode.querySelector(".screen-toggle"));
		assert.equal(d.rootNode.querySelector(".tab-add"), null);
		assert.deepEqual(d.problems, []);
	});
});

describe("componentModule", () => {
	test("the todo list loads, checks and runs", () => {
		const r = componentModule(todoSource);
		assert.deepEqual(
			r.diagnostics.map((d) => d.code),
			[],
		);
		const d = driverOf(r.components, "PureTodoList", {});
		d.send("setText", ["  milk  "]);
		d.send("add");
		d.send("setText", ["bread"]);
		d.send("add");
		d.send("toggle", [0]);
		assert.deepEqual(d.problems, []);
		assert.deepEqual(
			d.state.items.map((i) => [i.title, i.done]),
			[
				["milk", true],
				["bread", false],
			],
		);
		assert.equal(d.state.left, 1);
		assert.equal(d.state.leftText, "1 left");
		d.send("remove", [0]);
		assert.equal(d.state.items.length, 1);
	});
	test("its model says what it is", () => {
		const { model } = componentModule(todoSource);
		const c = model.components[0];
		assert.equal(c.name, "PureTodoList");
		assert.deepEqual(
			c.fields.map((f) => [f.name, f.type, f.default]),
			[
				["text", "string", ""],
				["items", "Item[]", []],
			],
		);
		assert.deepEqual(
			c.messages.map((m) => [m.name, m.args, m.pure]),
			[
				["setText", "[string]", true],
				["add", "[]", false],
				["toggle", "[number]", false],
				["remove", "[number]", false],
			],
		);
		assert.deepEqual(model.entries["PureTodoList.queries.leftText"], "string");
	});
	test("a handler that breaks a rule doesn't load", () => {
		const bad = todoSource.replace("next.text = text;", "this.text = text;");
		const r = componentModule(bad);
		assert.equal(r.ok, false);
		assert.deepEqual(
			r.diagnostics.map((d) => d.code),
			["immutable-target"],
		);
	});
	test("a helper that recurses doesn't load", () => {
		const bad = todoSource.replace("if (!item.done) n += 1;", "if (!item.done) n += open(items);");
		assert.deepEqual(
			componentModule(bad).diagnostics.map((d) => d.code),
			["recursive-call"],
		);
	});
});

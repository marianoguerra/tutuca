// The same pure-tutuca modules in tutuca (JavaScript) and in tutuca-wasm: the same messages,
// sent to both, leave the same states and report the same problems (a failure, a broken pre or
// post, an invalid field, a broken invariant), and show the same page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { componentModule } from "../../src/pure/module.js";
import { Driver, testEnv } from "../../src/testing/driver.js";
import { Scope } from "../../src/tutuca.js";
import { dom } from "../../test/helpers.js";
import { createRuntime } from "../js/tutuca-wasm.js";

const corpus = new URL("../../spec/pure-tutuca/conformance/accept/", import.meta.url);
// A module by its name in the corpus, or by its path from the repository's root.
const urlOf = (name) =>
	name.includes("/")
		? new URL(`../../${name}.tutuca.ts`, import.meta.url)
		: new URL(`${name}.tutuca.ts`, corpus);
const read = (name) => readFileSync(urlOf(name), "utf8");
// The modules a module imports types from, beside it.
const resolverOf = (name) => (spec) => {
	try {
		return readFileSync(new URL(spec.endsWith(".ts") ? spec : `${spec}.ts`, urlOf(name)), "utf8");
	} catch {
		return null;
	}
};

// The page's host modules the corpus imports, with the implementations both sides get.
const PAGE = {
	words: {
		split: (text) => text.split(" "),
		count: (text, word) => text.split(" ").filter((w) => w === word).length,
		stats: (text) => {
			const words = text.split(" ").filter((w) => w !== "");
			const longest = words.reduce((a, w) => (w.length > a.length ? w : a), "");
			return words.length > 0
				? { words: words.length, longest, first: words[0] }
				: { words: 0, longest };
		},
		lie: () => 42,
		boom: () => {
			throw new Error("boom");
		},
	},
};
const hostModules = Object.entries(PAGE).map(([name, impls]) => ({
	...JSON.parse(readFileSync(new URL(`../../host/${name}.json`, corpus), "utf8")),
	impls,
}));

// What went wrong, in words both say: "failed", a message's issues, a state's "<field or
// component>: <reason>".
const jsIssues = (records) =>
	records.flatMap((r) => [
		...(r.error === undefined || r.error === null ? [] : ["failed"]),
		...r.issues.map((i) =>
			i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason,
		),
	]);
const wasmIssues = (reports) =>
	reports.flatMap((r) => [
		...(r.outcome === "failed" ? ["failed"] : []),
		...(r.issues ?? []).map((i) =>
			i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason,
		),
	]);

// What a page shows, with each element's event id renumbered by where it first appears: the
// ids only have to tell elements apart, and each runtime counts its own.
const shown = (node) => {
	const seen = new Map();
	return node.innerHTML.replace(/data-eid="(\d+)"/g, (_, id) => {
		if (!seen.has(id)) seen.set(id, seen.size);
		return `data-eid="${seen.get(id)}"`;
	});
};

async function sides(modules, type, fields, { asks = {} } = {}) {
	const scope = new Scope();
	const page = dom().document;
	const wasmNode = page.createElement("main");
	const wasm = await createRuntime({ env: testEnv(), document: page, rootNode: wasmNode, asks });
	scope.registerAskHandlers(asks);
	for (const name of modules) {
		const resolve = resolverOf(name);
		const r = componentModule(read(name), { hostModules, resolve });
		assert.deepEqual(
			r.diagnostics.map((d) => d.code),
			[],
			name,
		);
		scope.registerInterfaces(r.interfaces);
		scope.registerAskHandlers(r.askHandlers);
		scope.registerMetaSchemas(r.metaSchemas);
		scope.register(r.components);
		const loaded = await wasm.load(read(name), { hostModules, resolve, register: {} });
		assert.deepEqual(loaded.diagnostics, [], `${name} in tutuca-wasm`);
		assert.deepEqual(loaded.model, r.model, `${name}: one model`);
	}
	const js = new Driver({ root: scope.make(type, fields), document: dom().document });
	wasm.start(type, fields);
	wasm.mount();
	return {
		send(name, args = [], options = {}) {
			const jsBefore = js.reports.length;
			const wasmBefore = wasm.reports().length;
			js.send(name, args, options);
			wasm.send(name, args, options);
			return {
				js: jsIssues(js.problems.filter((r) => js.reports.indexOf(r) >= jsBefore)).sort(),
				wasm: wasmIssues(wasm.reports().slice(wasmBefore)).sort(),
			};
		},
		// An event on the nth element that has event bindings, in each page: with a value or a
		// checked when given, as typing or ticking leaves the element before the event.
		fire(n, type, { value, checked, ...init } = {}) {
			const jsBefore = js.reports.length;
			const wasmBefore = wasm.reports().length;
			for (const root of [js.rootNode, wasmNode]) {
				const node = root.querySelectorAll("[data-eid]")[n];
				assert.ok(node, `there is no element ${n} with event bindings`);
				if (value !== undefined) node.value = value;
				if (checked !== undefined) node.checked = checked;
				const { Event, KeyboardEvent } = node.ownerDocument.defaultView;
				const Kind = "key" in init ? KeyboardEvent : Event;
				node.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, ...init }));
			}
			return {
				js: jsIssues(js.problems.filter((r) => js.reports.indexOf(r) >= jsBefore)).sort(),
				wasm: wasmIssues(wasm.reports().slice(wasmBefore)).sort(),
			};
		},
		// Drags the nth element matching a selector onto the mth matching another, in each page,
		// firing the events a browser does.
		drag([from, n], [onto, m]) {
			const jsBefore = js.reports.length;
			const wasmBefore = wasm.reports().length;
			for (const root of [js.rootNode, wasmNode]) {
				const source = root.querySelectorAll(from)[n];
				const target = root.querySelectorAll(onto)[m];
				assert.ok(source && target, `there is ${from} ${n} and ${onto} ${m}`);
				const { Event } = root.ownerDocument.defaultView;
				const fire = (type, node) =>
					node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
				fire("dragstart", source);
				for (const type of ["dragenter", "dragover", "drop"]) fire(type, target);
				fire("dragend", source);
			}
			return {
				js: jsIssues(js.problems.filter((r) => js.reports.indexOf(r) >= jsBefore)).sort(),
				wasm: wasmIssues(wasm.reports().slice(wasmBefore)).sort(),
			};
		},
		// Lets what was asked of the page be answered, in both.
		async idle() {
			await new Promise((done) => setTimeout(done, 0));
			js.drain();
			await wasm.idle();
		},
		js: () => JSON.parse(JSON.stringify(js.state)),
		wasm: () => wasm.state(),
		html: () => ({ js: shown(js.rootNode), wasm: shown(wasmNode) }),
	};
}

// Sends each step to both sides, comparing after each.
async function walk(modules, type, fields, steps, options) {
	const s = await sides(modules, type, fields, options);
	assert.deepEqual(s.wasm(), s.js(), "made");
	assert.equal(s.html().wasm, s.html().js, "made: what the page shows");
	for (const [name, args, init] of steps) {
		// A step is a message (to the root, or where its { to } says), an event on an element (its
		// name a number), or a drag of one element onto another.
		const issues =
			typeof name === "number"
				? s.fire(name, args, init)
				: name === "drag"
					? s.drag(args, init)
					: s.send(name, args, init);
		await s.idle();
		const at = `after ${name}(${JSON.stringify(args ?? [])}${init ? ` ${JSON.stringify(init)}` : ""})`;
		assert.deepEqual(issues.wasm, issues.js, `${at}: what went wrong`);
		assert.deepEqual(s.wasm(), s.js(), at);
		assert.equal(s.html().wasm, s.html().js, `${at}: what the page shows`);
	}
}

describe("tutuca-wasm does what tutuca does", () => {
	test("counter: a pure message with Math.min, an argument, a notify, and a non-whole count", () =>
		walk(["counter"], "Counter", { count: 98 }, [
			["inc"],
			["inc"],
			["inc"],
			["bump", [-50]],
			["bump", [0]],
			["bump", [80]],
			["bump", [-60]],
			["bump", [0.5]],
		]));
	test("todo-list: trimming, an alias of a list item, splice from the end, a helper with for-of", () =>
		walk(["todo-list"], "PureTodoList", {}, [
			["setText", ["  milk "]],
			["add"],
			["setText", ["eggs"]],
			["add"],
			["setText", ["   "]],
			["add"],
			["toggle", [1]],
			["toggle", [7]],
			["toggle", [-1]],
			["remove", [-1]],
			["remove", [0]],
			["remove", [0]],
		]));
	test("gauge: a pre, a post and an invariant entry, each broken alone", () =>
		walk(["gauge"], "Gauge", {}, [
			["raise", [12]],
			["raise", [-12]],
			["drop"],
			["raise", [5]],
			["setMax", [3]],
			["setMax", [20]],
		]));
	test("bag: tutuca/data's range, without and kindOf, and Object, Number and Array", () =>
		walk(["bag"], "Bag", {}, [
			["label", [3]],
			["label", [0]],
			["tag", ["a"]],
			["tag", ["b"]],
			["tag", ["a"]],
			["double"],
			["untag", ["a"]],
			["untag", ["zzz"]],
			["copyTags"],
			["kind", [null]],
			["kind", [1]],
			["kind", [1.5]],
			["kind", ["x"]],
			["kind", [[1]]],
			["kind", [{ a: 1 }]],
			["kind", [true]],
			["label", [2000000]],
		]));
	test("words: a page's host module, its results checked against their declared types", () =>
		walk(["words"], "Words", {}, [
			["read", ["the cat and the hat"]],
			["read", [""]],
			["read", ["hello"]],
			["lie"],
			["boom"],
			["read", ["a b"]],
		]));
	test("scope-make: ctx.componentNames and ctx.tryMake, a name that isn't one failing as a result", () =>
		walk(["scope-make"], "Picker", {}, [
			["pick", ["Leaf"]],
			["pick", ["Nope"]],
			["pick", ["Picker"]],
			["become", ["Nope"]],
			["become", ["Leaf"]],
		]));
	test("todo-items: ctx.make of a TodoItem, tutuca.apply of its pure message, filter", () =>
		walk(["todo-item", "todo-items"], "TodoItems", {}, [
			["add"],
			["add"],
			["completeAll"],
			["add"],
		]));
});

describe("tutuca-wasm hears what tutuca hears", () => {
	test("todo-list: typing, a click, and events inside a loop's items with their sourceKey", () =>
		walk(["todo-list"], "PureTodoList", {}, [
			[0, "input", { value: "milk" }],
			[1, "click"],
			[0, "input", { value: "eggs" }],
			[1, "click"],
			[0, "input", { value: "tea" }],
			[1, "click"],
			[4, "change", { checked: true }],
			[3, "click"],
			[2, "change", { checked: true }],
			[5, "click"],
			[3, "click"],
		]));
	test("todo-items: events on child components, and a notification going up from one", () =>
		walk(["todo-item", "todo-items"], "TodoItems", {}, [
			["add"],
			["add"],
			["add"],
			[2, "change", { checked: true }],
			[4, "change", { checked: true }],
			[2, "change", { checked: false }],
			[3, "click"],
			[5, "click"],
		]));
});

describe("tutuca-wasm asks, answers and addresses what tutuca does", () => {
	// A Board of counters: each a child that notifies, asks, and may swap itself for a Label.
	const board = (steps, options) =>
		walk(["tutuca-wasm/components/counter/counter"], "Board", {}, steps, options);
	test("counter: a child's notification handled by its parent, by the key it came through", () =>
		board([
			[0, "click"],
			[0, "click"],
			[0, "click"],
			[2, "click"],
			[2, "click"],
			[7, "click"],
			[3, "click"],
			[4, "input", { value: "41" }],
			[4, "input", { value: "4x" }],
			[5, "click"],
			[2, "click"],
		]));
	test("counter: sendAt to each child, and a child that swaps itself for another component", () =>
		board([
			["addCounter"],
			["addCounter"],
			[2, "click"],
			[6, "click"],
			["toLabel", [], { to: { item: "counters", key: 0 } }],
			["resetAll"],
			["addCounter"],
			["inc", [], { to: { item: "counters", key: 2 } }],
		]));
	test("counter: an ask its module answers now, one the page answers, now and later, and one nobody does", async () => {
		const at = { to: { item: "counters", key: 0 } };
		const steps = [
			["addCounter"],
			["load", [], at],
			["inc", [], at],
			["fetch", [], at],
			["inc", [], at],
		];
		await board(steps, { asks: { fetchCount: () => 7 } });
		await board(steps, { asks: { fetchCount: () => Promise.resolve(9) } });
		await board(steps, {
			asks: {
				fetchCount: () => {
					throw new Error("no network");
				},
			},
		});
		await board(steps);
	});
});

describe("tutuca-wasm drags and drops what tutuca does", () => {
	test("kanban: lanes made by init, a card typed and added with Enter, dragged to a lane and onto a card", () =>
		walk(["tutuca-wasm/components/kanban/kanban"], "Kanban", {}, [
			[0, "input", { value: "A new idea" }],
			[0, "keydown", { key: "a" }],
			[0, "keydown", { key: "Enter" }],
			["drag", [".kanban-card", 0], [".kanban-lane h3", 1]],
			["drag", [".kanban-card", 2], [".kanban-card", 3]],
			["drag", [".kanban-card", 1], [".kanban-lane h3", 2]],
		]));
});

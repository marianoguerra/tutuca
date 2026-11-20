// pure-tutuca's corpus (../spec/pure-tutuca/conformance/accept), compiled by the pure-tutuca compiler
// (its functions lowered to Wax, dist/pure-tutuca/) and loaded by tutuca's
// componentModule, the reference: the same messages, sent to both, leave the
// same states and report the same problems (a failure, a broken pre or post,
// an invalid field or invariant).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { JSDOM } from "jsdom";
import { componentModule } from "../../src/pure/module.js";
import { Driver } from "../../src/testing/driver.js";
import { Scope } from "../../src/tutuca.js";
import { load } from "../js/tutuca-rt.js";
import { PURE_MODULES } from "../scripts/build.mjs";

const corpus = new URL("../../spec/pure-tutuca/conformance/accept/", import.meta.url);
const vdom = await load(new URL("../dist/tutuca-rt.wasm", import.meta.url));
const R = vdom.runtime;

// A wasm value as JSON: a component as its fields (its schema says which).
const plain = (v) => {
	if (Array.isArray(v)) return v.map(plain);
	if (v === null || typeof v !== "object") return v;
	let schema = null;
	try {
		schema = R.schema(v);
	} catch {}
	if (schema === null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
	return Object.fromEntries(schema.fields.map((f) => [f.name, plain(R.get(v, f.name))]));
};

// The page's host modules the corpus imports, with the implementations both
// sides get: spec/pure-tutuca/host/<name>.json and these.
const PAGE = {
	words: {
		split: (text) => text.split(" "),
		count: (text, word) => text.split(" ").filter((w) => w === word).length,
		stats: (text) => {
			const words = text.split(" ").filter((w) => w !== "");
			const longest = words.reduce((a, w) => (w.length > a.length ? w : a), "");
			return words.length > 0 ? { words: words.length, longest, first: words[0] } : { words: 0, longest };
		},
		lie: () => 42,
		boom: () => {
			throw new Error("boom");
		},
	},
};
const pageModules = Object.entries(PAGE).map(([name, impls]) => ({
	...JSON.parse(readFileSync(new URL(`../../host/${name}.json`, corpus), "utf8")),
	impls,
}));

// The two sides of a case: modules (the corpus's names), the root's type and
// what it's made from.
async function sides(modules, type, fields) {
	const scope = new Scope();
	for (const name of modules) {
		const r = componentModule(readFileSync(new URL(`${name}.tutuca.ts`, corpus), "utf8"), { hostModules: pageModules });
		assert.deepEqual(
			r.diagnostics.map((d) => d.code),
			[],
			name,
		);
		scope.register(r.components);
	}
	const js = new Driver({ root: scope.make(type, fields) });
	for (const m of pageModules) for (const [name, fn] of Object.entries(m.impls)) R.defineHostFn(`${m.module}.${name}`, fn);
	const wscope = R.scope();
	for (const name of modules) await vdom.loadComponent(await readFile(new URL(`../dist/pure-tutuca/${name}.wasm`, import.meta.url)), wscope);
	const { window } = new JSDOM("");
	const host = R.createHost(window.document, window.document.createElement("div"), R.make(wscope, type, fields), { dev: true });
	host.mount();
	// What went wrong, in words both say: "failed", "pre", "post", a message's
	// other issues, and a state's "<field or component>: <reason>".
	const jsIssues = (records) =>
		records.flatMap((r) => [
			...(r.error === undefined || r.error === null ? [] : ["failed"]),
			...r.issues.map((i) => (i.check === "state" ? `${i.field ?? i.component}: ${i.reason}` : i.reason)),
		]);
	const wasmIssues = (reports) =>
		reports.flatMap((r) => {
			if (r.type === "taskFailed") return ["failed"];
			if (r.type === "messageInvalid") return r.issues;
			if (r.type === "stateInvalid") return r.issues.map((i) => `${i.field ?? i.component}: ${i.reason}`);
			return [];
		});
	return {
		send(name, args = []) {
			const jsBefore = js.reports.length;
			const wasmBefore = host.reports.length;
			js.send(name, args);
			host.send(name, args, { now: true });
			return {
				js: jsIssues(js.problems.filter((r) => js.reports.indexOf(r) >= jsBefore)).sort(),
				wasm: wasmIssues(host.reports.slice(wasmBefore)).sort(),
			};
		},
		js: () => JSON.parse(JSON.stringify(js.state)),
		root: () => host.root(),
	};
}

// Sends each step to both sides, comparing after each.
async function walk(modules, type, fields, steps) {
	const s = await sides(modules, type, fields);
	assert.deepEqual(plain(s.root()), s.js(), "made");
	for (const [name, args] of steps) {
		const issues = s.send(name, args);
		const at = `after ${name}(${JSON.stringify(args ?? [])})`;
		assert.deepEqual(issues.wasm, issues.js, `${at}: what went wrong`);
		assert.deepEqual(plain(s.root()), s.js(), at);
	}
}

describe("pure-tutuca: the compiled wasm does what tutuca does", () => {
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
		walk(["todo-item", "todo-items"], "TodoItems", {}, [["add"], ["add"], ["completeAll"], ["add"]]));
});

// The model pure-tutuca writes (format 2) is the one tutuca's componentModule gives:
// spec/pure-tutuca/golden, generated by node scripts/pure-tutuca-goldens.js.
describe("pure-tutuca: the compiler's model is tutuca's", () => {
	for (const name of PURE_MODULES) {
		test(name, () => {
			const golden = JSON.parse(readFileSync(new URL(`../../spec/pure-tutuca/golden/accept-${name}.json`, import.meta.url), "utf8"));
			const model = JSON.parse(readFileSync(new URL(`../dist/pure-tutuca/${name}.model.json`, import.meta.url), "utf8"));
			assert.deepEqual(model, golden.model);
		});
	}
});

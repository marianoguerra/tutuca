import assert from "node:assert/strict";
import test from "node:test";
import {
	ClassCompiler,
	classNamesOf,
	classUsesOf,
	classValueUsesOf,
	collectClasses,
} from "../../src/css/classes.js";
import { CLASSES_META, declaredClassesOf } from "../../src/meta/index.js";
import { $if, $query, component, each, field, h, lookupBind } from "../../src/tutuca.js";

test("collectClasses finds constant classes in nested $if branches", () => {
	const v = h(
		"div",
		{ class: "flex  gap-2" },
		h("span", {
			class: $if(field("a"), $if(field("b"), "x y", "z"), "w"),
		}),
		h("span", { class: field("dynamic"), title: "not-a-class" }),
		each(field("items"), h("i", { class: "item" })),
	);
	assert.deepEqual(collectClasses(v), new Set(["flex", "gap-2", "x", "y", "z", "w", "item"]));
	const all = new Set(["kept"]);
	assert.equal(collectClasses(v, all), all);
	assert.ok(all.has("kept") && all.has("item"));
});

test("classUsesOf notes what computes a class, and only inside a class attribute", () => {
	const v = h(
		"div",
		{ class: field("rootClass"), title: field("title") },
		h("span", { class: $if(field("on"), $query("tone", "x"), "off") }),
		each(field("items"), h("b", { class: lookupBind("chip") })),
	);
	const { classes, dynamic } = classUsesOf(v);
	assert.deepEqual(classes, new Set(["off"]));
	assert.deepEqual(
		dynamic.map((n) => n.constructor.kind),
		["field", "query", "lookupBind"],
	);
	assert.equal(dynamic[0].name, "rootClass");
});

test("a $if's condition is no class, even a constant one", () => {
	const v = h("i", { class: $if("always", "a", "b") });
	assert.deepEqual(collectClasses(v), new Set(["a", "b"]));
	assert.deepEqual(classUsesOf(v).dynamic, []);
});

test("classValueUsesOf reads a class attribute's value", () => {
	const { classes, dynamic } = classValueUsesOf($if(field("on"), "a b", field("other")));
	assert.deepEqual(classes, new Set(["a", "b"]));
	assert.deepEqual(
		dynamic.map((n) => n.name),
		["other"],
	);
});

test("classNamesOf adds the classes components declare in their classes meta", () => {
	const C = component({
		name: "C",
		meta: { [CLASSES_META]: { classes: "on  off\n  md:h-full" } },
		views: { main: h("div", { class: field("cls") }, h("p", { class: "p-2" })) },
		queries: {
			get cls() {
				return "on";
			},
		},
	});
	assert.deepEqual(classNamesOf([C]).sort(), ["md:h-full", "off", "on", "p-2"]);
	assert.deepEqual(declaredClassesOf(C), ["on", "off", "md:h-full"]);
});

test("ClassCompiler compiles once per batch, and again only for new classes", async () => {
	const calls = [];
	const compile = (classes) => {
		calls.push([...classes].sort());
		return Promise.resolve(classes.join(","));
	};
	const style = { isConnected: true, textContent: "" };
	const A = component({ name: "A", views: { main: h("div", { class: "a" }) } });
	const B = component({ name: "B", views: { main: h("div", { class: "a b" }) } });
	const compiler = new ClassCompiler(compile, ["k"]).watch(style);
	assert.equal(compiler.add([A]), true);
	await new Promise((r) => setTimeout(r));
	assert.deepEqual(calls, [["a", "k"]]);
	assert.equal(style.textContent, "k,a");
	assert.equal(compiler.add([A]), false);
	await new Promise((r) => setTimeout(r));
	assert.equal(calls.length, 1);
	compiler.add([B]);
	await new Promise((r) => setTimeout(r));
	assert.deepEqual(calls[1], ["a", "b", "k"]);
});

// The scenarios of spec/view/view.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { component } from "../src/component/class.js";
import { t } from "../src/component/types.js";
import * as sem from "../src/view/sem.js";
import { $if, $query, evalExpr, field, frag, h, renderRoot } from "../src/view/view.js";

const render = (view) => renderRoot(component({ name: "Root", view }).make());
const rootOf = (...children) => [sem.component("Root", children)];

test("literals are views: text, or nothing for null", () => {
	assert.deepEqual(render("hello"), rootOf(sem.text("hello")));
	assert.deepEqual(render(42), rootOf(sem.text("42")));
	assert.deepEqual(render(false), rootOf(sem.text("false")));
	assert.deepEqual(render(null), rootOf());
});

test("elements, with attributes and children", () => {
	const b = h("b", {}, "world");
	const p = h("p", { class: "loud", title: "greeting" }, "Hello, ", b, "!");
	assert.deepEqual(
		render(p),
		rootOf(
			sem.el(p.tid, "p", null, null, { class: "loud", title: "greeting" }, [
				sem.text("Hello, "),
				sem.el(b.tid, "b", null, null, {}, [sem.text("world")]),
				sem.text("!"),
			]),
		),
	);
});

test("several roots", () => {
	const i = h("i");
	assert.deepEqual(
		render(frag("a", frag("b", null), i)),
		rootOf(sem.text("a"), sem.text("b"), sem.el(i.tid, "i", null, null, {}, [])),
	);
});

test("each h is its own template", () => {
	assert.notEqual(h("p").tid, h("p").tid);
});

test("a class with views needs a main one; one with none renders nothing", () => {
	assert.throws(() => component({ name: "C", views: { compact: "x" } }), /C has no main view/);
	assert.deepEqual(renderRoot(component({ name: "Quiet" }).make()), [sem.component("Quiet", [])]);
});

test("keys become strings; null keys are no keys; namespace is a slot", () => {
	const keyed = h("p", { key: field("id"), namespace: "svg-ns" });
	assert.deepEqual(
		evalExpr({ it: { id: 7 } }, keyed),
		sem.el(keyed.tid, "p", "svg-ns", "7", {}, []),
	);
	assert.deepEqual(evalExpr({ it: {} }, keyed), sem.el(keyed.tid, "p", "svg-ns", null, {}, []));
});

test("nested h calls are element values in props", () => {
	const b = h("b", {}, "B");
	const p = h("p", { title: b });
	assert.deepEqual(
		evalExpr({}, p),
		sem.el(
			p.tid,
			"p",
			null,
			null,
			{ title: sem.el(b.tid, "b", null, null, {}, [sem.text("B")]) },
			[],
		),
	);
});

test("rendering a value that is not a component fails", () => {
	assert.throws(() => renderRoot({}), TypeError);
});

test("attributes and children read fields", () => {
	const p = h("p", { title: field("name") }, "Hello, ", field("name"), "!");
	const Greeting = component({ name: "Greeting", fields: { name: t.string() }, view: p });
	assert.deepEqual(renderRoot(Greeting.make({ name: "Ada" })), [
		sem.component("Greeting", [
			sem.el(p.tid, "p", null, null, { title: "Ada" }, [
				sem.text("Hello, "),
				sem.text("Ada"),
				sem.text("!"),
			]),
		]),
	]);
});

test("a missing field renders nothing; a field holding a list splices", () => {
	const Root = component({
		name: "Root",
		fields: { xs: t.array() },
		view: frag(field("missing"), field("xs")),
	});
	assert.deepEqual(renderRoot(Root.make({ xs: ["a", 1] })), rootOf(sem.text("a"), sem.text("1")));
	assert.throws(() => evalExpr({ it: null }, field("boom")), TypeError);
});

test("literals work in every expression body", () => {
	for (const [v, expected] of [
		["hello", [sem.text("hello")]],
		[42, [sem.text("42")]],
		[false, [sem.text("false")]],
		[null, []],
	]) {
		assert.deepEqual(render($if(true, v, "wrong")), rootOf(...expected));
		assert.deepEqual(render($if(false, "wrong", v)), rootOf(...expected));
	}
});

test("truthiness picks the branch; only the chosen branch is evaluated", () => {
	const ctx = { it: null };
	for (const v of [false, 0, "", null, NaN]) {
		assert.equal(evalExpr(ctx, $if(v, field("boom"), "selected")), "selected");
	}
	for (const v of [true, 1, "false", {}]) {
		assert.equal(evalExpr(ctx, $if(v, "selected", field("boom"))), "selected");
	}
});

test("$if selects attribute values, and a query reads with arguments", () => {
	const p = h(
		"p",
		{ class: $if(field("loud"), "loud", "quiet") },
		$if($query("startsWith", "A"), "first", "later"),
	);
	const Greeting = component({
		name: "Greeting",
		fields: { name: t.string(), loud: t.boolean() },
		view: p,
		queries: {
			startsWith(letter) {
				return this.name.startsWith(letter);
			},
		},
	});
	const rendered = (args) => renderRoot(Greeting.make(args))[0].children[0];
	assert.deepEqual(
		rendered({ name: "Ada", loud: true }),
		sem.el(p.tid, "p", null, null, { class: "loud" }, [sem.text("first")]),
	);
	assert.deepEqual(
		rendered({ name: "Bob" }),
		sem.el(p.tid, "p", null, null, { class: "quiet" }, [sem.text("later")]),
	);
});

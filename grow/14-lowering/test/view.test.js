// The scenarios of spec/view/view.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { component } from "../src/component/class.js";
import * as sem from "../src/view/sem.js";
import { evalExpr, frag, h, renderRoot } from "../src/view/view.js";

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
	const keyed = h("p", { key: 7, namespace: "svg-ns" });
	assert.deepEqual(evalExpr({}, keyed), sem.el(keyed.tid, "p", "svg-ns", "7", {}, []));
	const unkeyed = h("p", { key: null });
	assert.deepEqual(evalExpr({}, unkeyed), sem.el(unkeyed.tid, "p", null, null, {}, []));
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

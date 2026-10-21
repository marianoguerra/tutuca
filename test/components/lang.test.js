import assert from "node:assert/strict";
import test from "node:test";
import { LangError, langComponents, sample } from "../../components/lang/index.js";
import { Driver } from "../../src/test/pbt.js";
import { specOf } from "../../src/tutuca.js";
import { document, scopeWith, testGenericProperties, testLintsClean, textOf } from "../helpers.js";

const setup = () => scopeWith(langComponents).components;

testLintsClean("Lang", langComponents);

testGenericProperties(langComponents);

const codeOf = (C, notation) => {
	const root = C.Editor({ notation, program: sample(C) });
	return new Driver({ root, document }).rootNode
		.querySelector("pre")
		.textContent.replace(/\s+/g, "");
};
const squash = (s) => s.replace(/\s+/g, "");

test("the sample reads as each notation", () => {
	const C = setup();
	assert.equal(
		codeOf(C, "lisp"),
		squash(`(define x 7) (define name "ada") (define debug false)
			(define total (+ (* x 2) 1)) (define big (and (> total 10) (= (len name) 3)))
			(if (or big debug) (upper (concat name "!")) (str (max x 3)))`),
	);
	assert.equal(
		codeOf(C, "python"),
		squash(`x = 7 name = "ada" debug = False total = ((x * 2) + 1)
			big = ((total > 10) and (len(name) == 3))
			(upper(concat(name, "!")) if (big or debug) else str(max(x, 3)))`),
	);
	assert.equal(
		codeOf(C, "js"),
		squash(`let x = 7; let name = "ada"; let debug = false; let total = ((x * 2) + 1);
			let big = ((total > 10) && (len(name) === 3));
			((big || debug) ? upper(concat(name, "!")) : str(max(x, 3)))`),
	);
	assert.equal(
		codeOf(C, "forth"),
		squash(`7 VALUE x s" ada" VALUE name false VALUE debug x 2 * 1 + VALUE total
			total 10 > name len 3 = and VALUE big
			big debug or IF name s" !" concat upper ELSE x 3 max str THEN .`),
	);
});

test("the editor shows what the program evaluates to", () => {
	const C = setup();
	assert.equal(C.Editor({ program: sample(C) }).output, '"ADA!"');
	assert.equal(C.Editor({ notation: "forth", program: sample(C) }).output, 's" ADA!"');
	assert.match(textOf(C.Editor({ program: sample(C) })), /⇒"ADA!"/);
});

const run = (C, result, statements = []) => C.Program({ statements, result }).execute();
const n = (C, value) => C.Num({ value, text: String(value) });
const s = (C, value) => C.Str({ value });

test("evaluation is dynamically typed", () => {
	const C = setup();
	assert.equal(run(C, C.Arith({ op: "+", left: s(C, "a"), right: s(C, "b") })), "ab");
	assert.equal(run(C, C.Arith({ op: "%", left: n(C, 7), right: n(C, 3) })), 1);
	assert.equal(run(C, C.Compare({ op: "<", left: s(C, "a"), right: s(C, "b") })), true);
	assert.equal(run(C, C.Compare({ op: "==", left: s(C, "1"), right: n(C, 1) })), false);
	// and/or give back an operand and skip the right side when the left decides.
	assert.equal(run(C, C.Logic({ op: "or", left: n(C, 0), right: s(C, "x") })), "x");
	assert.equal(run(C, C.Logic({ op: "and", left: n(C, 0), right: C.Var({ name: "nope" }) })), 0);
	assert.equal(run(C, C.If({ cond: s(C, ""), ifTrue: n(C, 1), ifFalse: n(C, 2) })), 2);
	assert.equal(run(C, C.Call({ fn: "str", args: [C.Bool({ value: true })] })), "true");
	const x = C.Assign({ name: "x", value: n(C, 4) });
	assert.equal(run(C, C.Arith({ op: "*", left: C.Var({ name: "x" }), right: n(C, 2) }), [x]), 8);
});

test("evaluation errors", () => {
	const C = setup();
	const fails = (result, message) =>
		assert.throws(
			() => run(C, result),
			(e) => e instanceof LangError && message.test(e.message),
		);
	fails(
		C.Arith({ op: "+", left: s(C, "a"), right: n(C, 1) }),
		/needs numbers, got string and number/,
	);
	fails(C.Compare({ op: "<", left: C.Bool(), right: C.Bool() }), /two numbers or two strings/);
	fails(C.Arith({ op: "/", left: n(C, 1), right: n(C, 0) }), /division by zero/);
	fails(C.Var({ name: "y" }), /y is not defined/);
	fails(C.Call({ fn: "len", args: [n(C, 1)] }), /len needs a string/);
	fails(C.Hole(), /empty hole/);
	assert.equal(C.Editor().output, "Error: the program has an empty hole");
	assert.ok(C.Editor().isError);
});

test("editing clears nodes, fills holes and keeps call arguments fitting", () => {
	const C = setup();
	const root = C.Editor({
		mode: "edit",
		program: C.Program({ result: C.Call({ fn: "abs", args: [n(C, -2)] }) }),
	});
	const d = new Driver({ root, document });
	const $ = (selector) => d.rootNode.querySelector(selector);
	const fire = (type, el, value) => {
		if (value !== undefined) el.value = value;
		const { Event, MouseEvent } = document.defaultView;
		el.dispatchEvent(new (type === "click" ? MouseEvent : Event)(type, { bubbles: true }));
		d.drain();
	};
	assert.equal(d.state.output, "2");
	fire("change", $('[aria-label="function"]'), "max");
	assert.equal(d.state.program.result.args.length, 2);
	assert.equal(d.state.output, "Error: the program has an empty hole");
	fire("click", $('[aria-label="Pick a node"]'));
	fire("click", $('[data-kind="Num"]'));
	fire("input", d.rootNode.querySelectorAll('[aria-label="number"]')[1], "5");
	assert.equal(d.state.output, "5");
	fire("change", $('[aria-label="function"]'), "upper");
	assert.equal(d.state.program.result.args.length, 1);
	assert.equal(d.state.output, "Error: upper needs a string, got number");
	// The argument comes before the call in the page, so its ✕ is the first.
	fire("click", d.rootNode.querySelectorAll('button[title="Clear"]')[0]);
	fire("click", $('[aria-label="Pick a node"]'));
	fire("click", $('[data-kind="Str"]'));
	fire("input", $('[aria-label="string"]'), "hi");
	assert.equal(d.state.output, '"HI"');
	assert.deepEqual(d.problems, []);
});

test("+ on a statement adds one after it, or before it on Ctrl+click", () => {
	const C = setup();
	const root = C.Editor({ mode: "edit", program: sample(C) });
	const d = new Driver({ root, document });
	const names = () => d.state.program.statements.map((s) => s.name);
	const insert = (i, ctrlKey = false) => {
		const { MouseEvent } = document.defaultView;
		const button = d.rootNode.querySelectorAll('button[title^="Add a statement after"]')[i];
		button.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey }));
		d.drain();
	};
	insert(0);
	assert.deepEqual(names(), ["x", "v6", "name", "debug", "total", "big"]);
	insert(2, true);
	assert.deepEqual(names(), ["x", "v6", "v7", "name", "debug", "total", "big"]);
	assert.equal(d.state.program.statements[1].value.constructor, C.Hole().constructor);
	assert.deepEqual(d.problems, []);
});

const dragSetup = (program) => {
	const C = setup();
	const d = new Driver({ root: C.Editor({ mode: "edit", program: program(C) }), document });
	const all = (selector) => [...d.rootNode.querySelectorAll(selector)];
	const drop = (from, to, ctrlKey = false) => {
		const { Event, MouseEvent } = document.defaultView;
		from.dispatchEvent(new Event("dragstart", { bubbles: true }));
		for (const type of ["dragenter", "dragover"])
			to.dispatchEvent(new Event(type, { bubbles: true }));
		to.dispatchEvent(new MouseEvent("drop", { bubbles: true, ctrlKey }));
		from.dispatchEvent(new Event("dragend", { bubbles: true }));
		d.drain();
	};
	return { C, d, all, drop };
};
const nameOf = (v) => specOf(v).name;
// a = 5, then a hole plus 1.
const holeProgram = (C) =>
	C.Program({
		statements: [C.Assign({ name: "a", value: n(C, 5) })],
		result: C.Arith({ op: "+", left: C.Hole(), right: n(C, 1) }),
	});

test("a node dragged into a hole moves there and leaves a hole behind", () => {
	const { d, all, drop } = dragSetup(holeProgram);
	drop(all('[data-dragtype="node"]')[0], all('[aria-label="Pick a node"]')[0]);
	assert.equal(nameOf(d.state.program.statements[0].value), "Hole");
	assert.equal(d.state.program.result.left.value, 5);
	assert.equal(d.state.output, "Error: the program has an empty hole");
	assert.deepEqual(d.problems, []);
});

test("Ctrl while dropping copies the node instead", () => {
	const { d, all, drop } = dragSetup(holeProgram);
	drop(all('[data-dragtype="node"]')[0], all('[aria-label="Pick a node"]')[0], true);
	assert.equal(d.state.program.statements[0].value.value, 5);
	assert.equal(d.state.program.result.left.value, 5);
	assert.equal(d.state.output, "6");
	assert.deepEqual(d.problems, []);
});

test("a node can't be dropped into a hole inside itself", () => {
	const { d, all, drop } = dragSetup(holeProgram);
	const before = d.state;
	// The grip of the result's + comes after its operands'.
	drop(all('[data-dragtype="node"]').at(-1), all('[aria-label="Pick a node"]')[0]);
	assert.equal(d.state, before);
	assert.deepEqual(d.problems, []);
});

test("statements reorder by dragging", () => {
	const { d, all, drop } = dragSetup((C) =>
		C.Program({
			statements: ["a", "b", "c"].map((name, i) => C.Assign({ name, value: n(C, i) })),
			result: C.Var({ name: "a" }),
		}),
	);
	const names = () => d.state.program.statements.map((s) => s.name);
	const grips = () => all('[data-dragtype="statement"]');
	drop(grips()[2], grips()[0].parentElement);
	assert.deepEqual(names(), ["c", "a", "b"]);
	drop(grips()[0], grips()[2].parentElement);
	assert.deepEqual(names(), ["a", "c", "b"]);
	// A node dropped on a statement doesn't move it.
	drop(all('[data-dragtype="node"]')[0], grips()[0].parentElement);
	assert.deepEqual(names(), ["a", "c", "b"]);
	assert.deepEqual(d.problems, []);
});

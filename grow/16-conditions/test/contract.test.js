import assert from "node:assert/strict";
import test from "node:test";
import { act } from "../src/component/action.js";
import { component } from "../src/component/class.js";
import { apply, ContractError, interfaceGaps, query } from "../src/component/contract.js";
import { iface } from "../src/component/interface.js";
import { Scope } from "../src/component/scope.js";
import { t } from "../src/component/types.js";

const TodoItem = iface("TodoItem", {
	pure: { setDone: [t.boolean()] },
	queries: { done: { returns: t.boolean() }, matches: { args: [t.string()] } },
});

const Card = component({
	name: "Card",
	implements: TodoItem,
	fields: { text: t.string(), isDone: t.boolean() },
	invariants: {
		shortText() {
			return this.text.length < 10;
		},
	},
	on: {
		setDone: {
			pure: true,
			args: [t.boolean()],
			run(next, [done]) {
				next.isDone = done;
			},
		},
		setText: {
			pure: true,
			args: [t.string()],
			pre: (self) => !self.isDone,
			run(next, [text]) {
				next.text = text;
			},
		},
		bump(next) {
			next.text += "!";
		},
	},
	queries: {
		done: {
			returns: t.boolean(),
			get() {
				return this.isDone;
			},
		},
		get label() {
			return `${this.isDone ? "✓ " : ""}${this.text}`;
		},
		matches: {
			args: [t.string()],
			run(text) {
				return this.text.includes(text);
			},
		},
		bad: {
			returns: t.number(),
			get() {
				return "no";
			},
		},
		sneaky() {
			this.text = "changed";
		},
	},
});

const List = component({
	name: "List",
	fields: { items: t.array(t.component("Card")) },
	on: {
		completeAll: {
			pure: true,
			run(next) {
				for (let i = 0; i < next.items.length; i++) {
					next.items[i] = apply(next.items[i], "setDone", true);
				}
			},
		},
	},
	queries: {
		get remaining() {
			return this.items.filter((it) => !query(it, "done")).length;
		},
	},
});

const throwsCode = (fn, code) =>
	assert.throws(fn, (error) => error instanceof ContractError && error.code === code);

test("apply steps an instance by one of its pure messages; query reads it", () => {
	const card = Card.make({ text: "milk" });
	const done = apply(card, "setDone", true);
	assert.equal(query(card, "done"), false);
	assert.equal(query(done, "done"), true);
	assert.equal(query(done, "label"), "✓ milk");
	assert.equal(query(done, "matches", "il"), true);
	// Queries read like fields on the instance too.
	assert.equal(done.label, "✓ milk");
});

test("a pure message applies others, on the draft its handler writes on", () => {
	const list = List.make({ items: [Card.make({ text: "a" }), Card.make({ text: "b" })] });
	assert.equal(query(list, "remaining"), 2);
	const next = apply(list, "completeAll");
	assert.equal(query(next, "remaining"), 0);
	assert.equal(query(list, "remaining"), 2);
	// The same through act: apply inside a handler joins its step.
	assert.equal(query(act(List, list, "completeAll", []).next, "remaining"), 0);
});

test("a call that breaks the contract throws, and says what it broke", () => {
	const card = Card.make({ text: "milk" });
	throwsCode(() => apply(card, "nope"), "unknown");
	throwsCode(() => apply(card, "bump"), "not-pure");
	throwsCode(() => apply(card, "setDone"), "args");
	throwsCode(() => apply(card, "setDone", "yes"), "arg:0");
	throwsCode(() => apply(apply(card, "setDone", true), "setText", "x"), "pre");
	throwsCode(() => apply(card, "setText", "far too long a text"), "invariant:shortText");
	throwsCode(() => query(card, "nope"), "unknown");
	throwsCode(() => query(card, "matches", 3), "arg:0");
	throwsCode(() => query(card, "bad"), "returns");
	throwsCode(() => query({}, "label"), "not-component");
	assert.throws(() => query(card, "sneaky"), TypeError); // a query can't write
});

test("a component implements an interface, or says what it lacks", () => {
	const card = Card.make();
	assert.deepEqual(interfaceGaps(card, TodoItem), []);
	const Other = iface("Other", { messages: { bump: [t.number()] }, queries: { other: {} } });
	assert.deepEqual(interfaceGaps(card, Other), [
		"its message bump takes other arguments",
		"its query other is missing",
	]);
	assert.deepEqual(interfaceGaps(card, "TodoItem"), ["no interface TodoItem in its scope"]);
});

test("a scope checks what a class says it implements", () => {
	const scope = new Scope();
	scope.registerInterfaces({ TodoItem });
	const Named = component({ name: "Named", implements: "TodoItem" });
	assert.throws(
		() => scope.register({ Named }),
		/Named can't be registered: its message setDone is missing/,
	);
	const { Card: card } = scope.register({ Card });
	assert.deepEqual(interfaceGaps(card(), "TodoItem"), []);
});

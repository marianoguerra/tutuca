// A component's contract: pure messages applied and queries run by name, synchronously, against
// any component; interfaces registered in scopes, resolved where a component is registered.
import assert from "node:assert/strict";
import test from "node:test";
import {
	$query,
	apply,
	ContractError,
	canApply,
	canQuery,
	component,
	contractOf,
	field,
	Host,
	h,
	iface,
	implementsIface,
	interfaceGaps,
	query,
	Scope,
	t,
} from "../../src/tutuca.js";

const TodoItem = iface("TodoItem", {
	pure: { setDone: [t.boolean()] },
	queries: { done: { returns: t.boolean() }, label: { returns: t.string() } },
	notifies: { removeMe: [] },
});
const Card = component({
	name: "Card",
	implements: ["TodoItem"],
	fields: { done: t.boolean(false).public(), text: t.string(""), hits: t.number(0) },
	on: {
		setDone: {
			pure: true,
			args: [t.boolean()],
			post: (_prev, next, [done]) => next.done === done,
			run(next, [done]) {
				next.done = done;
			},
		},
		setText: {
			pure: true,
			args: [t.string()],
			pre: (prev) => !prev.done,
			run(next, [text]) {
				next.text = text;
			},
		},
		bump(next, _args, ctx) {
			next.hits += 1;
			ctx.notify("bumped", []);
		},
		wrong: { pure: true, run: () => ({ not: "a card" }) },
	},
	queries: {
		label: {
			returns: t.string(),
			get() {
				return this.done ? `✓ ${this.text}` : this.text;
			},
		},
		matches: {
			args: [t.string()],
			returns: t.boolean(),
			run(word) {
				return this.text.includes(word);
			},
		},
		bad: {
			returns: t.number(),
			get() {
				return "not a number";
			},
		},
		sneaky() {
			this.hits = 99;
			return this.hits;
		},
	},
	invariants: {
		shortText() {
			return this.text.length < 10;
		},
	},
	view: h("li", {}, field("label"), " ", $query("matches", "a")),
});
const List = component({
	name: "List",
	fields: { items: t.array(t.component("TodoItem")) },
	on: {
		completeAll: {
			pure: true,
			run(next) {
				for (let i = 0; i < next.items.length; i++)
					next.items[i] = apply(next.items[i], "setDone", true);
			},
		},
	},
	queries: {
		get remaining() {
			return this.items.filter((it) => !query(it, "done")).length;
		},
	},
});
const setup = () => {
	const scope = new Scope();
	scope.registerInterfaces({ TodoItem });
	const { Card: makeCard, List: makeList } = scope.register({ Card, List });
	return { scope, makeCard, makeList };
};
const throwsCode = (fn, code) =>
	assert.throws(fn, (e) => e instanceof ContractError && e.code === code);

test("apply on a committed component returns a new one and leaves it as it was", () => {
	const { makeCard } = setup();
	const card = makeCard({ text: "milk" });
	const done = apply(card, "setDone", true);
	assert.notEqual(done, card);
	assert.equal(card.done, false);
	assert.equal(done.done, true);
	assert.equal(query(done, "label"), "✓ milk");
});

test("apply in a pure message changes the child draft in the caller's transaction", () => {
	const { makeCard, makeList } = setup();
	const list = makeList({ items: [makeCard({ text: "a" }), makeCard({ text: "b" })] });
	assert.equal(query(list, "remaining"), 2);
	const next = apply(list, "completeAll");
	assert.equal(query(next, "remaining"), 0);
	assert.equal(query(list, "remaining"), 2);
});

test("a query on a draft reads what the draft holds so far", () => {
	const { makeCard, makeList } = setup();
	const list = makeList({ items: [makeCard({ text: "a" })] });
	const host = new Host();
	host.scope.registerInterfaces({ TodoItem });
	host.scope.register({ Card, List });
	let seen = null;
	const Probe = component({
		name: "Probe",
		fields: { list: t.component("List") },
		on: {
			go(next) {
				apply(next.list.items[0], "setDone", true);
				seen = query(next.list.items[0], "done");
			},
		},
	});
	host.scope.register({ Probe });
	host.start(host.scope.make("Probe", { list }));
	host.send("go", [], { now: true });
	assert.equal(seen, true);
	assert.equal(host.root.list.items[0].done, true);
});

test("each way an operation breaks its contract has its code", () => {
	const { makeCard } = setup();
	const card = makeCard({ text: "milk" });
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
	assert.throws(() => query(card, "sneaky")); // a query can't write a frozen component
	assert.equal(canApply(card, "setDone"), true);
	assert.equal(canApply(card, "bump"), false);
	assert.equal(canQuery(card, "done"), true);
	assert.equal(canQuery(card, "text"), false); // private field
});

test("a post that doesn't hold is reported", () => {
	const Liar = component({
		name: "Liar",
		fields: { done: t.boolean(false) },
		on: { setDone: { pure: true, args: [t.boolean()], post: () => false, run() {} } },
	});
	throwsCode(() => apply(Liar.make(), "setDone", true), "post");
});

test("a sent pure message runs without a ctx", () => {
	const host = new Host();
	host.scope.registerInterfaces({ TodoItem });
	const { Card: makeCard } = host.scope.register({ Card });
	let got = "unset";
	const Spy = component({
		name: "Spy",
		fields: {},
		on: {
			poke: {
				pure: true,
				run(_next, _args, ctx) {
					got = ctx;
				},
			},
		},
	});
	const { Spy: makeSpy } = host.scope.register({ Spy });
	host.start(makeSpy());
	host.send("poke", [], { now: true });
	assert.equal(got, undefined);
	host.start(makeCard({ text: "x" }));
	host.apply("setDone", [true]);
	assert.equal(host.query("label"), "✓ x");
});

test("views read get queries as fields and call queries with args", () => {
	const { makeCard } = setup();
	const card = makeCard({ text: "a cat", done: true });
	assert.equal(card.label, "✓ a cat");
	assert.equal(Card.views.main.children[2].eval({ it: card }), true);
});

test("interfaces are resolved in the scope a component is registered in", () => {
	const bare = new Scope();
	assert.throws(() => bare.register({ Card }), /TodoItem, which isn't an interface here/);
	const { scope, makeCard } = setup();
	const inner = scope.enter("inner");
	const Other = iface("TodoItem", { queries: { other: {} } });
	inner.registerInterfaces({ TodoItem: Other });
	assert.throws(() => inner.register({ Card }), /query other is missing/);
	const card = makeCard({});
	assert.equal(implementsIface(card, TodoItem), true);
	assert.equal(implementsIface(card, Other), false);
	assert.deepEqual(interfaceGaps(card, "TodoItem"), []);
});

test("an Interface instance in implements needs no registration", () => {
	const Counter = iface("Counter", { queries: { count: { returns: t.number() } } });
	const C = component({
		name: "C",
		implements: [Counter],
		fields: { count: t.number(0).public() },
	});
	const scope = new Scope();
	const { C: makeC } = scope.register({ C });
	assert.equal(implementsIface(makeC(), Counter), true);
	assert.equal(t.component(Counter).isValid(makeC(), scope), true);
	const NotC = component({ name: "NotC", implements: [Counter], fields: { count: t.number(0) } });
	assert.throws(() => scope.register({ NotC }), /query count is missing/);
});

test("a component registered under an interface's name must implement it", () => {
	const scope = new Scope();
	scope.registerInterfaces({ TodoItem });
	const Plain = component({ name: "Plain", fields: {} });
	assert.throws(() => scope.register({ TodoItem: Plain }), /can't be registered as TodoItem/);
});

test("an interface registered after a component is checked as it is made", () => {
	const scope = new Scope();
	const Plain = component({ name: "Plain", implements: ["Later"], fields: {} });
	assert.throws(() => scope.register({ Plain }));
	const Loose = component({ name: "Loose", fields: {} });
	scope.register({ Loose });
	scope.registerInterfaces({ Loose: iface("Loose", { pure: { x: [] } }) });
	assert.throws(() => scope.make("Loose"), /pure message x is missing/);
});

test("t.component of an interface name takes any component implementing it", () => {
	const { scope, makeCard } = setup();
	const Plain = component({ name: "Plain", fields: {} });
	const { Plain: makePlain } = scope.register({ Plain });
	const type = t.component("TodoItem");
	assert.equal(type.isValid(makeCard(), scope), true);
	assert.equal(type.isValid(makePlain(), scope), false);
});

test("contractOf describes what a component offers, and no state", () => {
	const { makeCard } = setup();
	const contract = contractOf(makeCard());
	assert.equal(contract.name, "Card");
	assert.deepEqual(
		contract.implements.map((i) => [i.name, i.resolved]),
		[["TodoItem", true]],
	);
	assert.deepEqual(
		contract.messages.map((m) => [m.name, m.pure]),
		[
			["setDone", true],
			["setText", true],
			["bump", false],
			["wrong", true],
		],
	);
	assert.deepEqual(
		contract.queries.map((q) => q.name),
		["done", "label", "matches", "bad", "sneaky"],
	);
	assert.equal(contractOf(Card).name, "Card");
});

test("a name is one thing: a query can't also be a field or a method", () => {
	assert.throws(
		() =>
			component({
				name: "X",
				fields: { a: t.number() },
				queries: {
					get a() {
						return 1;
					},
				},
			}),
		/query a is also a field/,
	);
	assert.throws(
		() => component({ name: "X", methods: { a() {} }, queries: { a() {} } }),
		/query a is also a method/,
	);
});

test("a failed pre says why when the handler has a why", () => {
	const Box = component({
		name: "Box",
		fields: { n: t.number() },
		on: {
			setN: {
				pure: true,
				args: [t.number()],
				pre: (_self, [n]) => n >= 0,
				why: (_self, [n]) => `${n} is negative`,
				run(next, [n]) {
					next.n = n;
				},
			},
		},
	});
	assert.throws(
		() => apply(Box.make(), "setN", -1),
		(e) => e.code === "pre" && e.detail === "-1 is negative",
	);
});

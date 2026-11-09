// What the host reports of each task: one Transition, with its outcome, what it emitted, what
// its dev checks found and where its chain started.
import assert from "node:assert/strict";
import test from "node:test";
import { Driver } from "../../src/testing/driver.js";
import {
	Address,
	component,
	DispatchPath,
	Frame,
	HOST,
	Task,
	Transition,
	t,
} from "../../src/tutuca.js";
import { scopeWith } from "../helpers.js";

const childPath = new DispatchPath([new Frame(["child"], null, null, true)]);
const Child = component({
	name: "Child",
	fields: { n: t.number() },
	on: {
		bump: {
			pure: true,
			run(next) {
				next.n += 1;
			},
		},
		ping(_next, _args, ctx) {
			ctx.notify("pinged", [1]);
		},
		boom(next) {
			next.n = 99;
			throw new Error("boom");
		},
	},
});
const Middle = component({ name: "Middle", fields: { child: t.component("Child") } });
const Parent = component({
	name: "Parent",
	fields: { child: t.component("Child"), seen: t.number(), got: t.any(null), jobs: t.number() },
	on: {
		pinged(next, [n]) {
			next.seen += n;
		},
		load(_next, _args, ctx) {
			ctx.ask("double", [21]);
		},
		writeChild(next) {
			next.child.n = 5; // the child's field, not through its messages
		},
		startAndCancel(_next, _args, ctx) {
			const id = ctx.sendAt("bump", [], (p) => p.field("child"), { settled: "done" });
			ctx.cancel(id);
		},
		done() {},
	},
	answers: {
		double: {
			ok(next, [n]) {
				next.got = n;
			},
		},
	},
});

const start = (
	components = { Parent, Child, Middle },
	root = (C) => C.Parent({ child: C.Child() }),
) => {
	const scope = scopeWith(components);
	scope.registerAskHandlers({ double: ([n]) => n * 2 });
	const driver = new Driver({ root: root(scope.components) });
	return Object.assign(driver, { C: scope.components });
};
const quietly = (fn) => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		return fn();
	} finally {
		console.warn = warn;
	}
};

test("a handled task's transition says what it sent and where its chain started", () => {
	const driver = start();
	driver.send(childPath, "ping");
	const [ping, pinged] = driver.transitions;
	assert.ok(ping instanceof Transition);
	assert.deepEqual(
		[ping.outcome, ping.mode, ping.name, ping.emitted],
		["handled", "send", "ping", [{ kind: "notify", name: "pinged", args: [1] }]],
	);
	assert.equal(ping.from, HOST);
	assert.deepEqual(
		[pinged.outcome, pinged.mode, pinged.cause, pinged.origin],
		["handled", "notify", ping.seq, ping.seq],
	);
	assert.equal(driver.state.seen, 1);
	assert.equal(pinged.after, driver.state);
	assert.equal(ping.before.child.n, 0);
});

const Top = component({
	name: "Top",
	fields: { middle: t.component("Middle"), seen: t.number() },
	on: {
		pinged(next, [n]) {
			next.seen += n;
		},
	},
});
test("a notification's hops without a handler pass it on, in the same chain", () => {
	const driver = start({ Top, Middle, Child }, (C) =>
		C.Top({ middle: C.Middle({ child: C.Child() }) }),
	);
	const leaf = new DispatchPath([
		new Frame(["middle"], null, null, true),
		new Frame(["child"], null, null, true),
	]);
	driver.send(leaf, "ping");
	const [ping, ...hops] = driver.transitions;
	assert.deepEqual(
		hops.map((r) => [r.name, r.outcome, r.origin]),
		[
			["pinged", "passed", ping.seq],
			["pinged", "handled", ping.seq],
		],
	);
	assert.equal(driver.state.seen, 1);
});

test("a task nobody handles, and one that throws, keep the state", () => {
	const driver = start();
	const before = driver.state;
	quietly(() => driver.send(new DispatchPath(), "nope"));
	driver.send(childPath, "boom");
	const [nope, boom] = driver.transitions;
	assert.deepEqual([nope.outcome, nope.unhandled], ["unhandled", ["nope"]]);
	assert.deepEqual([boom.outcome, boom.error.message], ["failed", "boom"]);
	assert.equal(boom.after, boom.before);
	assert.equal(driver.state, before);
	assert.deepEqual(
		driver.problems.map((r) => r.name),
		["boom"],
	);
});

test("a task for a node that's gone is stale, or orphaned when nothing is there", () => {
	const driver = start();
	const old = Address.at(childPath, driver.state);
	const { C } = driver;
	driver.restart(C.Parent({ child: C.Child() })); // a new child where the old one was
	driver.host.pushTask(new Task("bump", [], HOST, old, null));
	const gone = new Address(new DispatchPath([new Frame(["gone"], null, null, true)]), 1);
	driver.host.pushTask(new Task("bump", [], HOST, gone, null));
	driver.drain();
	assert.deepEqual(
		driver.transitions.map((r) => [r.outcome, String(r.to.keyPath)]),
		[
			["stale", ".child"],
			["orphaned", ".gone"],
		],
	);
});

test("an ask is asked, and its answer is a transition caused by it", () => {
	const driver = start();
	driver.send(new DispatchPath(), "load");
	const [load, ask, answer] = driver.transitions;
	assert.deepEqual(
		[ask.mode, ask.outcome, ask.cause, answer.name, answer.mode, answer.outcome, answer.cause],
		["ask", "asked", load.seq, "double.ok", "answer", "handled", ask.seq],
	);
	assert.equal(answer.origin, load.seq);
	assert.equal(driver.state.got, 42);
});

test("a task whose settle scope is cancelled before it runs is dropped", () => {
	const driver = start();
	driver.send(new DispatchPath(), "startAndCancel");
	const outcomes = driver.transitions.map((r) => [r.name, r.outcome]);
	assert.deepEqual(outcomes, [
		["startAndCancel", "handled"],
		["bump", "dropped"],
		["done", "handled"],
	]);
	assert.equal(driver.state.child.n, 0);
});

test("host.apply is a transition of mode apply, failed when it throws", () => {
	const driver = start();
	driver.host.apply("bump", [], { to: childPath });
	assert.throws(() => driver.host.apply("nope", [], { to: childPath }));
	const [bump, nope] = driver.transitions;
	assert.deepEqual([bump.mode, bump.outcome, bump.name], ["apply", "handled", "bump"]);
	assert.equal(bump.after.child.n, 1);
	assert.equal(bump.before.child.n, 0);
	assert.deepEqual(
		[nope.mode, nope.outcome, nope.error.name],
		["apply", "failed", "ContractError"],
	);
});

test("what dev checks find is in the issues of the task that caused it", () => {
	const driver = start();
	driver.send(new DispatchPath(), "writeChild");
	const [write] = driver.transitions;
	assert.deepEqual(
		write.issues.map((i) => [i.check, i.message, i.reason]),
		[["message", "writeChild", "foreign-write:Child.n"]],
	);
	assert.deepEqual(driver.problems, [write]);
});

test("a transition as data has no roots, nodes or tasks in it", () => {
	const driver = start();
	driver.send(childPath, "ping");
	driver.send(childPath, "boom");
	for (const record of driver.reports) {
		const json = JSON.parse(JSON.stringify(record));
		for (const key of ["before", "after", "instance", "task", "root"])
			assert.ok(!(key in json), key);
	}
	const boom = JSON.parse(JSON.stringify(driver.transitions.at(-1)));
	assert.deepEqual(
		[boom.from, boom.to, boom.error],
		["host", ".child", { name: "Error", message: "boom" }],
	);
	const ns = driver.reports.map((r) => r.n);
	assert.deepEqual(
		ns,
		ns.map((_, i) => i + 1),
	);
});

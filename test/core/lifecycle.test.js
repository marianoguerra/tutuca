// What the host reports besides its tasks: one Lifecycle per thing that happened to it, told
// apart by phase, with what dev checks found in its issues.
import assert from "node:assert/strict";
import test from "node:test";
import { Driver } from "../../src/testing/driver.js";
import {
	$if,
	component,
	DispatchPath,
	field,
	h,
	isProblem,
	Lifecycle,
	render,
	send,
	t,
} from "../../src/tutuca.js";
import { document, scopeWith, setupHost } from "../helpers.js";

const Counter = component({
	name: "Counter",
	fields: { count: t.number().min(0), limit: t.number(3) },
	view: h("button", { "on:click": send("inc") }, field("count")),
	invariants: {
		underLimit() {
			return this.count <= this.limit;
		},
	},
	on: {
		inc(next) {
			next.count += 1;
		},
		watched(_next, _args, ctx) {
			ctx.sendAt("inc", [], (p) => p, { settled: "done" });
		},
		done() {},
	},
});
const start = (fields = {}, { rendered = false } = {}) => {
	const C = scopeWith({ Counter }).components;
	const root = Object.assign(C.Counter(), fields); // as is: the factory would fix it
	return new Driver({ root, document: rendered ? document : null });
};
const phases = (driver) => driver.lifecycle.map((r) => r.phase);

test("a host reports it started, with what's wrong with the root it started with", () => {
	const ok = start();
	assert.deepEqual(phases(ok), ["started"]);
	assert.ok(ok.lifecycle[0] instanceof Lifecycle);
	const bad = start({ count: null });
	const [started] = bad.lifecycle;
	assert.deepEqual(
		started.issues.map((i) => [i.check, i.field, i.reason]),
		[["state", "count", "invalid"]],
	);
	assert.ok(isProblem(started));
});

test("a render says the last task it shows, and the queue settles once per root", () => {
	const driver = start({}, { rendered: true });
	driver.send(new DispatchPath(), "inc");
	const [inc] = driver.transitions;
	assert.deepEqual(phases(driver), ["started", "rendered", "rendered", "settled"]);
	const [, first, second, settled] = driver.lifecycle;
	assert.deepEqual([first.upTo, second.upTo, settled.upTo], [null, inc.seq, inc.seq]);
	driver.send(new DispatchPath(), "nope");
	assert.equal(phases(driver).filter((p) => p === "settled").length, 1, "the root didn't change");
});

test("the invariants a root breaks once the queue settles are the settled report's issues", () => {
	const driver = start({ count: 3 });
	driver.send(new DispatchPath(), "inc");
	const settled = driver.lifecycle.at(-1);
	assert.equal(settled.phase, "settled");
	assert.deepEqual(
		settled.issues.map((i) => i.reason),
		["invariant:underLimit"],
	);
	assert.deepEqual(driver.problems, [settled]);
});

test("a settle scope reports it opened and how it settled", () => {
	const driver = start();
	driver.send(new DispatchPath(), "watched");
	const scopes = driver.lifecycle.filter((r) => r.phase.startsWith("scope"));
	assert.deepEqual(
		scopes.map(({ phase, outcome, tasks }) => [phase, outcome, tasks]),
		[
			["scopeOpened", undefined, undefined],
			["scopeSettled", "ok", 1],
		],
	);
	assert.equal(scopes[0].scope, scopes[1].scope);
	assert.equal(String(scopes[0].watcher), String(driver.transitions[0].to));
});

test("a render that fails is reported, and so is the host stopping", () => {
	const Boom = component({
		name: "Boom",
		fields: { n: t.number() },
		views: {
			main: h("button", { "on:click": send("inc") }, $if(field("n"), render(field("n")), "ok")),
		},
		on: {
			inc(next) {
				next.n++;
			},
		},
	});
	const reports = [];
	const { host, rootNode, C, click } = setupHost(
		{ Boom },
		{ sync: true, onReport: (r) => reports.push(r) },
	);
	host.start(C.Boom());
	click(rootNode.querySelector("button"));
	host.stop();
	const failed = reports.filter((r) => r.kind === "lifecycle" && isProblem(r));
	assert.deepEqual(
		failed.map((r) => [r.phase, r.upTo, typeof r.error.message]),
		[["renderFailed", reports.find((r) => r.name === "inc").seq, "string"]],
	);
	assert.equal(reports.at(-1).phase, "stopped");
});

test("changes from a sync engine are external changes, and a failing engine is named", () => {
	const reports = [];
	const { host, C } = setupHost({ Counter }, { sync: true, onReport: (r) => reports.push(r) });
	host.start(C.Counter());
	let link = null;
	const pusher = {
		name: "pusher",
		attach(l) {
			link = l;
		},
		commit() {
			throw new Error("quota");
		},
	};
	host.attachSync(pusher);
	link.apply((root) => {
		root.count = 2;
	});
	host.send("inc", [], { now: true });
	const [external] = reports.filter((r) => r.phase === "externalChange");
	assert.equal(external.source, "pusher");
	assert.deepEqual([external.before.count, external.after.count], [0, 2]);
	const [failed] = reports.filter((r) => r.phase === "syncFailed");
	assert.deepEqual([failed.engine, failed.error.message], ["pusher", "quota"]);
});

test("a lifecycle report as data has no roots, events or vdom in it", () => {
	const driver = start({ count: null }, { rendered: true });
	driver.click("button");
	for (const record of driver.lifecycle) {
		const json = JSON.parse(JSON.stringify(record));
		for (const key of ["root", "before", "after", "ctx", "newVDom", "curVDom", "event"]) {
			assert.ok(!(key in json), `${record.phase} ${key}`);
		}
		assert.equal(json.kind, "lifecycle");
	}
	const ns = driver.reports.map((r) => r.n);
	assert.ok(ns.every((n, i) => i === 0 || n > ns[i - 1]));
});

// A host with no document: components that only handle messages, driven by host.send, the way
// a DOM event is, and awaited with whenIdle.
import assert from "node:assert/strict";
import test from "node:test";
import { component, DispatchPath, Host, h, Selector, send, t } from "../../src/tutuca.js";

const Worker = component({
	name: "Worker",
	fields: { log: t.array() },
	on: {
		work(next, [x], ctx) {
			next.log.push(x);
			ctx.notify("done", [x]);
			ctx.ask("llm", [x]);
		},
	},
	answers: {
		llm: {
			ok(next, [answer]) {
				next.log.push(answer);
			},
		},
	},
});
const Agent = component({
	name: "Agent",
	fields: { seen: t.array(), worker: t.component("Worker") },
	on: {
		prompt(_next, [x], ctx) {
			ctx.sendAt("work", [x], (p) => p.field("worker"));
		},
		done(next, [x]) {
			next.seen.push(x);
		},
		mark(next, [x]) {
			next.seen.push(x);
		},
	},
});
const headless = () => {
	const host = new Host();
	const { Agent: makeAgent } = host.scope.register({ Agent, Worker });
	host.scope.registerAskHandlers({ llm: async ([x]) => `answer(${x})` });
	host.start(makeAgent({}));
	return host;
};

test("a component with no views renders nothing and still handles messages", async () => {
	assert.equal(Agent.views.main.eval({}), "");
	const host = headless();
	host.send("prompt", ["hi"]);
	await host.whenIdle();
	assert.deepEqual(host.root.seen, ["hi"]);
	assert.deepEqual(host.root.worker.log, ["hi", "answer(hi)"]);
});

test("send reaches a component down a selector, a selector fn or a dispatch path", async () => {
	const host = headless();
	host.send("work", ["a"], { to: new Selector().field("worker") });
	host.send("work", ["b"], { to: (p) => p.field("worker") });
	host.send("mark", ["c"], { to: new DispatchPath() });
	await host.whenIdle();
	assert.deepEqual(host.root.worker.log, ["a", "b", "answer(a)", "answer(b)"]);
	assert.deepEqual(host.root.seen, ["c", "a", "b"]);
});

test("a send now runs before send returns, ahead of the queued ones", async () => {
	const host = headless();
	host.send("mark", ["queued"]);
	host.send("mark", ["now"], { now: true });
	assert.deepEqual(host.root.seen, ["now", "queued"]);
	await host.whenIdle();
});

test("whenIdle waits for the answers of asks in flight", async () => {
	const host = headless();
	let release;
	host.scope.registerAskHandlers({ llm: () => new Promise((r) => (release = r)) });
	host.send("work", ["x"], { to: (p) => p.field("worker") });
	let idle = false;
	const waiting = host.whenIdle().then(() => (idle = true));
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(idle, false);
	assert.equal(host.scheduler.pending, 1);
	release("late");
	await waiting;
	assert.deepEqual(host.root.worker.log, ["x", "late"]);
});

test("a component with event handlers registers on a host with no root node", () => {
	const Button = component({ name: "Button", view: h("button", { "on:click": send("mark") }) });
	const host = new Host();
	host.scope.register({ Button });
	host.start(host.scope.components.Button());
	assert.equal(host.rootNode, null);
});

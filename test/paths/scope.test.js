// Settle scopes (src/tree/scope.js): a message sent with a watch tells its sender once it and
// everything it caused ran, across asks answered later, inside other scopes, cancelled or not.
import assert from "node:assert/strict";
import test from "node:test";
import { HOST, MessageContext, mint, Scheduler, Target, Task } from "../../src/tree/index.js";
import { DispatchPath } from "../../src/tree/path.js";

// root holds a worker; root's handlers start work on it, the worker's do it.
const setup = (handlers, askHandlers = {}) => {
	const store = {
		root: mint({ kind: "root", log: [], worker: mint({ kind: "worker", n: 0 }) }),
		get: () => store.root,
		set: (r) => (store.root = r),
	};
	const scheduler = new Scheduler({
		kinds: {
			handler: (node, { mode, name, outcome }) => {
				const run = handlers[node.kind]?.[mode === "answer" ? `${name}.${outcome}` : name];
				return run && { run };
			},
			askHandler: (_node, name) => askHandlers[name] ?? null,
		},
		store,
		transact: (r, path, fn) => path.setIn(r, fn(path.getIn(r))),
		hooks: {
			context: (task, _node, nextRequest) => new MessageContext(task, nextRequest),
			observe: () => {},
		},
	});
	const run = () => {
		while (!scheduler.isEmpty) scheduler.step();
	};
	const send = (name, args = []) => {
		const task = new Task(name, args, HOST, new Target(new DispatchPath()), null);
		task.prepare(store.get());
		scheduler.push(task);
		run();
	};
	const settle = async () => {
		for (let i = 0; i < 20 && !scheduler.isIdle; i++) {
			await new Promise((r) => setTimeout(r, 0));
			run();
		}
	};
	return { store, scheduler, run, send, settle, log: () => store.get().log };
};
const worker = (s) => s.field("worker");
const logged = (n, entry) => ({ ...n, log: [...n.log, entry] });
// The root starts name on the worker, watched, and logs how it settled.
const starter = (name, args = [], watch = {}) => ({
	start: (_n, _a, ctx) => {
		ctx.sendAt(name, args, worker, { settled: ["done", ["w"]], ...watch });
	},
	done: (n, [tag, report]) => logged(n, `${tag}:${report.outcome}:${report.tasks}`),
});

test("a send settles after the messages it causes and a notification it bubbles", () => {
	const { send, log } = setup({
		root: { ...starter("work"), heard: (n) => logged(n, "heard") },
		worker: {
			work: (n, _a, ctx) => {
				ctx.sendAt("more", [], (s) => s);
				return n;
			},
			more: (n, _a, ctx) => {
				ctx.notify("heard");
				return { ...n, n: n.n + 1 };
			},
		},
	});
	send("start");
	// work, more, and the notification's hop at the root: 3 tasks, then done.
	assert.deepEqual(log(), ["heard", "w:ok:3"]);
});

test("a scope waits for an ask answered later, and one answered at once", async () => {
	const { send, settle, log, store } = setup(
		{
			root: starter("work"),
			worker: {
				work: (n, _a, ctx) => {
					ctx.ask("now");
					ctx.ask("later");
					return n;
				},
				"now.ok": (n) => ({ ...n, n: n.n + 1 }),
				"later.ok": (n) => ({ ...n, n: n.n + 10 }),
			},
		},
		{ now: () => 1, later: () => new Promise((r) => setTimeout(() => r(2), 5)) },
	);
	send("start");
	assert.deepEqual(log(), []); // The later answer hasn't come.
	await settle();
	assert.equal(store.get().worker.n, 11);
	assert.deepEqual(log(), ["w:ok:5"]);
});

test("a scope inside another settles first, and the outer waits for it", () => {
	const { send, log } = setup({
		root: {
			start: (_n, _a, ctx) => {
				ctx.sendAt("outer", [], worker, { settled: ["done", ["outer"]] });
			},
			// The worker as it is when the outer scope settles: the inner one's settled ran.
			done: (n, [tag, report]) => logged(n, `${tag}:${report.outcome}:${n.worker.n}`),
		},
		worker: {
			outer: (_n, _a, ctx) => {
				ctx.sendAt("inner", [], (s) => s, { settled: "innerDone" });
			},
			inner: (_n, _a, ctx) => {
				ctx.sendAt("leaf", [], (s) => s);
			},
			leaf: (n) => ({ ...n, n: n.n + 1 }),
			innerDone: (n, [report]) => {
				return { ...n, n: n.n + 100 + report.tasks };
			},
		},
	});
	send("start");
	// leaf's 1, then innerDone's 100 and the inner scope's 2 tasks (inner, leaf).
	assert.deepEqual(log(), ["outer:ok:103"]);
});

test("a handler that throws in the scope makes it failed, and it still settles", () => {
	const { send, log } = setup({
		root: starter("work"),
		worker: {
			work: (_n, _a, ctx) => {
				ctx.sendAt("boom", [], (s) => s);
			},
			boom: () => {
				throw new Error("boom");
			},
		},
	});
	send("start");
	assert.deepEqual(log(), ["w:failed:2"]);
});

test("a message to a node that was replaced is dropped and releases its scope", () => {
	const { send, log } = setup({
		root: {
			...starter("work"),
			replace: (n) => ({ ...n, worker: mint({ kind: "worker", n: 0 }) }),
		},
		worker: {
			work: (_n, _a, ctx) => {
				ctx.sendAt("later", [], (s) => s); // Stale once the root replaces it.
				ctx.notify("replace");
			},
			later: (n) => ({ ...n, n: 1 }),
		},
	});
	send("start");
	assert.equal(log().length, 1);
	assert.match(log()[0], /^w:ok:/);
});

test("cancelling drops what's queued, aborts what's asked and ignores its answer", async () => {
	let signal = null;
	const { send, settle, log, store } = setup(
		{
			root: {
				start: (n, _a, ctx) => ({
					...n,
					job: ctx.sendAt("work", [], worker, { settled: ["done", ["w"]] }),
				}),
				stop: (n, _a, ctx) => {
					ctx.cancel(n.job);
				},
				done: (n, [tag, report]) => logged(n, `${tag}:${report.outcome}`),
			},
			worker: {
				work: (_n, _a, ctx) => {
					ctx.ask("slow");
				},
				"slow.ok": (n) => ({ ...n, n: 99 }),
			},
		},
		{
			slow: (_args, read) => {
				signal = read.signal;
				return new Promise((r) => setTimeout(() => r(1), 5));
			},
		},
	);
	send("start");
	send("stop");
	assert.equal(signal.aborted, true);
	assert.deepEqual(log(), ["w:cancelled"]);
	await settle();
	assert.equal(store.get().worker.n, 0); // The answer came, and nothing waited for it.
});

test("a scope cancelled by its timeout says timeout", () => {
	const { send, scheduler, log } = setup(
		{
			root: starter("work", [], { timeout: 10 }),
			worker: {
				work: (_n, _a, ctx) => {
					ctx.ask("never");
				},
			},
		},
		{ never: () => new Promise(() => {}) },
	);
	let opened = null;
	scheduler.hooks.scopeOpened = (s) => (opened = s);
	send("start");
	assert.equal(opened.timeout, 10);
	// What the host's timer does once the time is up.
	scheduler.cancelScope(opened.id, "timeout");
	while (!scheduler.isEmpty) scheduler.step();
	assert.deepEqual(log(), ["w:timeout:2"]);
});

test("a detached ask doesn't hold its scope open", () => {
	const { send, log } = setup(
		{
			root: starter("work"),
			worker: {
				work: (_n, _a, ctx) => {
					ctx.ask("forever", [], { detached: true });
				},
			},
		},
		{ forever: () => new Promise(() => {}) },
	);
	send("start");
	assert.deepEqual(log(), ["w:ok:1"]);
});

test("progress is told after what runs in the scope, one at a time", () => {
	const { send, log } = setup({
		root: {
			start: (_n, _a, ctx) => {
				ctx.sendAt("work", [3], worker, { settled: "done", progress: "step" });
			},
			step: (n, [report]) => logged(n, `step:${report.tasks}`),
			done: (n, [report]) => logged(n, `done:${report.tasks}`),
		},
		worker: {
			work: (n, [left], ctx) => {
				if (left > 0) ctx.sendAt("work", [left - 1], (s) => s);
				return { ...n, n: n.n + 1 };
			},
		},
	});
	send("start");
	const entries = log();
	assert.equal(entries.at(-1), "done:4");
	assert.ok(entries.filter((e) => e.startsWith("step:")).length >= 1);
});

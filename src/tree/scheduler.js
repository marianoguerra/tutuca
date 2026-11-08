// The scheduler: spec/tree's tree-> over one queue. arrive is its env rule (an event runs at once,
// ahead of the queue), an ask's answer its respond rule (one answered now runs next, as an urgent
// response; one answered later is appended, as a normal one), and step its run rule (the head of
// the queue runs, as one transaction). receiver is the routing policy: by-path-checked.
import { AskTask, hidden, NotifyTask, Task } from "./messages.js";

/**
 * Which handler key a message is for: spec/tree's hkey.
 * @typedef {{ mode: "send" | "notify" | "answer", name: string, outcome?: string }} HKey
 *
 * What the nodes do: the handler a node has for a key, and the one that answers an ask made
 * from it (spec/tree's kinds, and the host's handlers).
 * @typedef {{
 *   handler(instance: object, hkey: HKey): { run: Function } | undefined,
 *   askHandler(instance: object, name: string): Function | null,
 * }} Kinds
 *
 * Where the root lives: the scheduler reads it before a task and sets it after one commits.
 * @typedef {{ get(): object, set(root: object): void }} Store
 *
 * One transaction: a new root from root, with the value at path replaced by what fn returns for
 * a mutable draft of it (immer's produce, in tutuca).
 * @typedef {(root: object, path: import("./path.js").KeyPath, fn: (leaf: object) => object) => object} Transact
 *
 * What the host hears and adds:
 * - context: the MessageContext a handler gets (a host's extends the tree's)
 * - beforeCommit: called with a task's change before it's the root; returns what to call once it
 *   is. Throwing fails the task.
 * - committed: after a task's change is the root and what it sent is queued
 * - observe: what happened (stale, orphaned, lost, unhandled, taskFailed, taskHandled)
 * - wake: something was queued by arrive or push
 * - scopeOpened, scopeSettled: a settle scope (settle.js) started counting, and settled; the host
 *   arms and clears its timeout
 * @typedef {{
 *   context(task: object, instance: object, nextRequest: () => number): import("./context.js").MessageContext,
 *   beforeCommit?(prev: object, next: object, task: object): () => void,
 *   committed?(task: object, ctx: object, info: object): void,
 *   observe(type: string, info: object): void,
 *   wake?(): void,
 * }} Hooks
 */
export class Scheduler {
	/** @param {{ kinds: Kinds, store: Store, transact: Transact, hooks: Hooks }} opts */
	constructor({ kinds, store, transact, hooks }) {
		this.kinds = kinds;
		this.store = store;
		this.transact = transact;
		this.hooks = hooks;
		this.tasks = [];
		this.pending = 0; // The asks whose answers are on their way.
		this.requests = 0; // The ids of the asks made, counted per scheduler so runs repeat.
		this.nextRequest = () => ++this.requests;
		this.scopes = new Map(); // The settle scopes that haven't settled, by id.
	}
	get isEmpty() {
		return this.tasks.length === 0;
	}
	// Nothing to run now, and no answer to come.
	get isIdle() {
		return this.tasks.length === 0 && this.pending === 0;
	}
	// An event runs at once, ahead of the queue, against the tree it happened on: after the events
	// that came before it, and after the rest of a bubble under way, which is one turn.
	arrive(task) {
		if (!this.enter(task)) return;
		const { tasks } = this;
		let i = 0;
		while (i < tasks.length && tasks[i].runsBeforeEnv) i++;
		tasks.splice(i, 0, task);
		this.hooks.wake?.();
	}
	// At the back of the queue.
	push(task) {
		if (!this.enter(task)) return;
		this.tasks.push(task);
		this.hooks.wake?.();
	}
	// At the front of the queue: it runs next.
	urgent(task) {
		if (this.enter(task)) this.tasks.unshift(task);
	}
	// Drops every queued task and forgets the scopes, which won't settle: for a host that stops.
	clear() {
		this.tasks.length = 0;
		this.scopes.clear();
	}
	// Runs the task at the head of the queue; one that fails is reported, and leaves the root as
	// it was.
	step() {
		const task = this.tasks.shift();
		const of = task.progressOf;
		if (of !== undefined) {
			// A progress message says how its scope is when it runs, not when it was queued.
			of.progressQueued = false;
			task.args = [...of.progressArgs, of.progressReport()];
		}
		try {
			this.deliver(task);
		} catch (error) {
			for (let s = task.scope; s != null; s = s.outer) s.failed++;
			this.hooks.observe("taskFailed", { task, error });
		} finally {
			// An ask leaves its scope once its answer is queued (startAsk).
			if (!task.asked) this.leave(task);
		}
	}
	deliver(task) {
		const { kinds, hooks } = this;
		const curRoot = this.store.get();
		// A notification starts from its sender, found as any address is, and visits the ancestors
		// it has then.
		if (task instanceof NotifyTask && task.hops === null) {
			if (this.receiver(task, task.from, curRoot) === null) return;
			task.start(curRoot);
		}
		const { to } = task;
		const path = to.keyPath;
		const instance = this.receiver(task, to, curRoot);
		if (instance === null) return;
		if (task instanceof AskTask) return this.startAsk(task, instance);
		let ctx;
		let newRoot;
		try {
			newRoot = this.transact(curRoot, path, (leafDraft) => {
				ctx = hooks.context(task, instance, this.nextRequest);
				return task.run(kinds.handler(instance, task.hkey), instance, leafDraft, ctx);
			});
		} catch (error) {
			// What went unhandled before the failure is reported, as the spec and tutuca-wax do.
			for (const message of ctx?.unhandled ?? []) hooks.observe("unhandled", { task, message });
			throw error;
		}
		// Where what it sends goes is fixed against the tree it committed.
		for (const child of ctx.tasks) child.prepare(newRoot);
		const commit = hooks.beforeCommit?.(curRoot, newRoot, task);
		this.store.set(newRoot);
		commit?.();
		for (const child of ctx.tasks) if (this.enter(child)) this.tasks.push(child);
		// A bubble's hops run back to back; what each hop sends waits behind them.
		if (ctx.nextHop !== null) this.urgent(ctx.nextHop);
		for (const id of ctx.cancels) this.cancelScope(id);
		for (let s = task.scope; s != null; s = s.outer) this.queueProgress(s);
		for (const message of ctx.unhandled) hooks.observe("unhandled", { task, message });
		hooks.committed?.(task, ctx, { path, instance, curRoot, newRoot });
	}
	// The node address names in root, or null when there is none to deliver task to: the one it
	// recorded is gone (orphaned), or another took its place (stale: it was replaced, or a list
	// shifted), so the message, for the one before, is dropped and reported. A notification's
	// hops can't move while it bubbles, so one that can't find its next hop is a bug (lost).
	receiver(task, address, root) {
		const path = address.keyPath;
		const found = address.resolve(root);
		if (found.instance !== undefined) return found.instance;
		const { observe } = this.hooks;
		if (task instanceof NotifyTask && address === task.to) {
			console.assert(false, "a notification lost its hop", task);
			observe("lost", { task, path });
		} else if (found.orphaned) observe("orphaned", { task, path });
		else observe("stale", { task, path, id: address.id, found: found.stale });
		return null;
	}
	// An ask starts here, after what asked committed, outside any transaction: nothing can undo
	// what its handler started. An answer now runs next, ahead of the queue; a later one joins
	// the queue when it settles.
	// An ask in a settle scope reads a signal, aborted if the scope is cancelled.
	startAsk(task, instance) {
		const ctx = this.hooks.context(task, instance, this.nextRequest);
		const handler = this.kinds.askHandler(instance, task.name);
		const { scope } = task;
		let read = ctx.readOnly();
		if (scope != null) {
			const controller = new AbortController();
			hidden(task, { controller });
			read = Object.freeze({ ...ctx.readable(), signal: controller.signal });
		}
		hidden(task, { asked: true });
		const { now, later } = task.start(handler, read);
		if (now !== undefined) {
			this.urgent(now);
			this.leave(task);
		}
		if (later !== undefined) {
			this.pending++;
			scope?.asks.add(task);
			later.then((answer) => {
				this.pending--;
				if (task.dropped) return; // Its scope was cancelled: nothing waits for it.
				scope?.asks.delete(task);
				this.push(answer);
				this.leave(task);
			});
		}
		const root = this.store.get();
		const info = { task, path: task.to.keyPath, instance, curRoot: root, newRoot: root };
		this.hooks.observe("taskHandled", info);
	}

	// Counts task in its scope as it's queued; false when the scope was cancelled, so it isn't.
	enter(task) {
		const s = task.scope;
		if (s == null) return true;
		if (s.done) {
			task.scope = null; // Made after its scope settled: nothing waits for it.
			return true;
		}
		if (s.isCancelled) {
			hidden(task, { dropped: true });
			return false;
		}
		if (!s.registered) this.register(s);
		s.open++;
		for (let x = s; x !== null; x = x.outer) x.tasks++;
		return true;
	}
	// A scope starts counting with its first task, as one open unit of the scope it's in.
	register(s) {
		s.registered = true;
		this.scopes.set(s.id, s);
		if (s.outer !== null) {
			s.outer.open++;
			s.outer.children.add(s);
		}
		this.hooks.scopeOpened?.(s);
	}
	// task is done: it ran, failed, was dropped or (an ask) its answer is queued.
	leave(task) {
		const s = task.scope;
		if (s == null || s.done || task.dropped) return;
		this.release(s);
	}
	release(s) {
		s.open--;
		if (s.open === 0) this.settle(s);
	}
	// Nothing in s is left: its watcher is told, in the scope it was in, which it then leaves.
	settle(s) {
		s.done = true;
		this.scopes.delete(s.id);
		this.hooks.scopeSettled?.(s);
		if (s.settled !== null) {
			const told = new Task(s.settled, [...s.settledArgs, s.report()], s.watcher, s.watcher, null);
			told.scope = s.outer;
			this.push(told);
		}
		if (s.outer !== null) {
			s.outer.children.delete(s);
			this.release(s.outer);
		}
	}
	// A progress message for s's watcher, unless one is queued already.
	queueProgress(s) {
		if (s.progress === null || s.progressQueued || s.done) return;
		const told = new Task(s.progress, [], s.watcher, s.watcher, null);
		told.scope = s.outer;
		hidden(told, { progressOf: s });
		s.progressQueued = true;
		this.push(told);
	}
	// Cancels the scope id, with outcome cancelled or timeout; false when there's none such open.
	cancelScope(id, outcome = "cancelled") {
		const s = this.scopes.get(id);
		if (s === undefined) return false;
		this.cancel(s, outcome);
		return true;
	}
	// s and the scopes inside it queue nothing more: their queued tasks are dropped, their asks
	// aborted and their answers ignored. It settles once what's running is done.
	cancel(s, outcome) {
		if (s.done || s.cancelled !== null) return;
		s.cancelled = outcome;
		for (const c of [...s.children]) this.cancel(c, outcome);
		const kept = [];
		const dropped = [];
		for (const t of this.tasks) (t.scope?.isIn(s) ? dropped : kept).push(t);
		this.tasks.splice(0, this.tasks.length, ...kept);
		for (const ask of [...s.asks]) {
			s.asks.delete(ask);
			ask.controller?.abort();
			dropped.push(ask);
		}
		for (const t of dropped) {
			this.leave(t);
			hidden(t, { dropped: true });
		}
	}
}

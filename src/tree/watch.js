// A watch: structured concurrency over the causal tree of tasks. A message sent with a watch
// (ctx.sendAt's settled or progress) opens one: that task and everything it causes, the
// messages it sends, the notifications it bubbles, its asks and their answers, recursively, are
// in it. When nothing in it is left to run or to answer, it settles, and the watcher, the node
// that sent it, gets its settled message, with a report of how it went.
//
// Every task knows its watch when it's made, from its parent (an answer's parent is its ask, so
// a watch spans the async boundary); one sent or asked detached is in none. Watches counts:
// open goes up as a task of the watch is queued and down once it ran (or failed, or was
// dropped as stale or orphaned); an ask stays open until its answer is queued. A watch inside
// another counts as one open unit of it until it settles, so watches make a tree, and a watch
// settles after every watch inside it.
//
// A cancelled watch queues nothing more: its queued tasks are dropped, the asks it waits for
// are aborted (their signal) and their answers ignored, and the watches inside it are cancelled
// too. It settles once what was running finished, as cancelled (or timeout).
import { Task } from "./messages.js";

export const WATCH_OUTCOMES = ["ok", "failed", "cancelled", "timeout"];

export class Watch {
	/**
	 * @param {number} id
	 * @param {import("./address.js").Address} watcher what gets settled and progress
	 * @param {{ settled?: [string, unknown[]?], progress?: string | [string, unknown[]?], timeout?: number }} watch
	 * @param {Watch | null} outer the watch the watcher's message was in
	 */
	constructor(id, watcher, watch, outer) {
		this.id = id;
		this.watcher = watcher;
		const [settled = null, settledArgs = []] = asMessage(watch.settled);
		const [progress = null, progressArgs = []] = asMessage(watch.progress);
		this.settled = settled;
		this.settledArgs = settledArgs;
		this.progress = progress;
		this.progressArgs = progressArgs;
		this.timeout = watch.timeout ?? null;
		this.outer = outer;
		this.children = new Set();
		this.asks = new Set(); // Its asks whose answers are on their way.
		this.open = 0;
		this.tasks = 0; // Tasks run in it and in the watches inside it.
		this.failed = 0; // Of those, the ones whose handler threw.
		this.registered = false;
		this.cancelled = null; // The outcome it was cancelled with: cancelled or timeout.
		this.done = false;
		this.progressQueued = false;
	}
	// Whether it, or a watch it's inside, was cancelled: nothing more is queued in it.
	get isCancelled() {
		for (let w = this; w !== null; w = w.outer) if (w.cancelled !== null) return true;
		return false;
	}
	get outcome() {
		return this.cancelled ?? (this.failed > 0 ? "failed" : "ok");
	}
	// What its watcher is told.
	report() {
		return { id: this.id, outcome: this.outcome, tasks: this.tasks, failed: this.failed };
	}
	progressReport() {
		return { id: this.id, tasks: this.tasks, open: this.open, failed: this.failed };
	}
	// Whether it is w or inside w.
	isIn(w) {
		for (let x = this; x !== null; x = x.outer) if (x === w) return true;
		return false;
	}
}
// A watch's message: a name, or [name, args].
const asMessage = (m) => (m == null ? [] : typeof m === "string" ? [m, []] : [m[0], m[1] ?? []]);

/**
 * What the watches need of the queue they count:
 * - push: queues a task at the back (a watcher's settled or progress message)
 * - dropQueued: takes the queued tasks pred holds for out of the queue, and returns them
 * - dropped: a task that won't run (or, an ask, whose answer won't), as its watch was cancelled
 * - opened, settled: a watch started counting, and settled
 * @typedef {{
 *   push(task: Task): void,
 *   dropQueued(pred: (task: Task) => boolean): Task[],
 *   dropped(task: Task): void,
 *   opened?(watch: Watch): void,
 *   settled?(watch: Watch): void,
 * }} Queue
 */
// The watches that haven't settled, and their counting.
export class Watches {
	/** @param {Queue} queue */
	constructor(queue) {
		this.queue = queue;
		this.open = new Map(); // By id.
	}
	// Forgets them all: they won't settle. For a host that stops.
	clear() {
		this.open.clear();
	}
	// Counts task in its watch as it's queued; false when the watch was cancelled, so it isn't.
	enter(task) {
		const w = task.watch;
		if (w === null) return true;
		if (w.done) {
			task.watch = null; // Made after its watch settled: nothing waits for it.
			return true;
		}
		if (w.isCancelled) {
			this.drop(task);
			return false;
		}
		if (!w.registered) this.register(w);
		w.open++;
		for (let x = w; x !== null; x = x.outer) x.tasks++;
		return true;
	}
	// A watch starts counting with its first task, as one open unit of the watch it's in.
	register(w) {
		w.registered = true;
		this.open.set(w.id, w);
		if (w.outer !== null) {
			w.outer.open++;
			w.outer.children.add(w);
		}
		this.queue.opened?.(w);
	}
	// task is done: it ran, failed, was dropped or (an ask) its answer is queued.
	leave(task) {
		const w = task.watch;
		if (w === null || w.done || task.dropped) return;
		this.release(w);
	}
	release(w) {
		w.open--;
		if (w.open === 0) this.settle(w);
	}
	// Nothing in w is left: its watcher is told, in the watch it was in, which it then leaves.
	settle(w) {
		w.done = true;
		this.open.delete(w.id);
		this.queue.settled?.(w);
		if (w.settled !== null) {
			const told = new Task(w.settled, [...w.settledArgs, w.report()], w.watcher, w.watcher, null);
			told.watch = w.outer;
			this.queue.push(told);
		}
		if (w.outer !== null) {
			w.outer.children.delete(w);
			this.release(w.outer);
		}
	}
	// task's handler threw: counted in its watch and the ones around it.
	failed(task) {
		for (let w = task.watch; w !== null; w = w.outer) w.failed++;
	}
	// task ran: a progress message for the watcher of its watch and of the ones around it.
	ran(task) {
		for (let w = task.watch; w !== null; w = w.outer) this.queueProgress(w);
	}
	// A progress message for w's watcher, unless one is queued already. It says how its watch
	// is when it runs, not when it was queued (progressArgs).
	queueProgress(w) {
		if (w.progress === null || w.progressQueued || w.done) return;
		const told = new Task(w.progress, [], w.watcher, w.watcher, null);
		told.watch = w.outer;
		told.progressOf = w;
		w.progressQueued = true;
		this.queue.push(told);
	}
	// The args of a progress message as it runs: its watch as it is now.
	progressArgs(task) {
		const w = task.progressOf;
		w.progressQueued = false;
		return [...w.progressArgs, w.progressReport()];
	}
	// An ask of a watch whose answer is on its way, and one whose answer came.
	waitFor(ask) {
		ask.watch?.asks.add(ask);
	}
	answered(ask) {
		ask.watch?.asks.delete(ask);
	}
	// Cancels the watch id, with outcome cancelled or timeout; false when there's none such open.
	cancel(id, outcome = "cancelled") {
		const w = this.open.get(id);
		if (w === undefined) return false;
		this.cancelWatch(w, outcome);
		return true;
	}
	// w and the watches inside it queue nothing more: their queued tasks are dropped, their asks
	// aborted and their answers ignored. It settles once what's running is done.
	cancelWatch(w, outcome) {
		if (w.done || w.cancelled !== null) return;
		w.cancelled = outcome;
		for (const c of [...w.children]) this.cancelWatch(c, outcome);
		const dropped = this.queue.dropQueued((t) => t.watch?.isIn(w) === true);
		for (const ask of [...w.asks]) {
			w.asks.delete(ask);
			ask.controller?.abort();
			dropped.push(ask);
		}
		for (const t of dropped) {
			this.leave(t);
			this.drop(t);
		}
	}
	drop(task) {
		task.dropped = true;
		this.queue.dropped(task);
	}
}

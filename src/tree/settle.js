// A settle scope: structured concurrency over the causal tree of tasks. A message sent with a
// watch (ctx.sendAt's settled or progress) opens one: that task and everything it causes, the
// messages it sends, the notifications it bubbles, its asks and their answers, recursively, are
// in it. When nothing in it is left to run or to answer, it settles, and the watcher, the node
// that sent it, gets its settled message, with a report of how it went.
//
// Every task knows its scope when it's made, from its parent (an answer's parent is its ask, so
// a scope spans the async boundary); one sent or asked detached is in none. The scheduler
// counts: open goes up as a task of the scope is queued and down once it ran (or failed, or was
// dropped as stale or orphaned); an ask stays open until its answer is queued. A scope inside
// another counts as one open unit of it until it settles, so scopes make a tree, and a scope
// settles after every scope inside it.
//
// A cancelled scope queues nothing more: its queued tasks are dropped, the asks it waits for
// are aborted (their signal) and their answers ignored, and the scopes inside it are cancelled
// too. It settles once what was running finished, as cancelled (or timeout).
export const SCOPE_OUTCOMES = ["ok", "failed", "cancelled", "timeout"];

export class SettleScope {
	/**
	 * @param {number} id
	 * @param {import("./address.js").Address} watcher what gets settled and progress
	 * @param {{ settled?: [string, unknown[]?], progress?: string | [string, unknown[]?], timeout?: number }} watch
	 * @param {SettleScope | null} outer the scope the watcher's message was in
	 */
	constructor(id, watcher, watch, outer) {
		this.id = id;
		this.watcher = watcher;
		const [settled = null, settledArgs = []] = asWatch(watch.settled);
		const [progress = null, progressArgs = []] = asWatch(watch.progress);
		this.settled = settled;
		this.settledArgs = settledArgs;
		this.progress = progress;
		this.progressArgs = progressArgs;
		this.timeout = watch.timeout ?? null;
		this.outer = outer;
		this.children = new Set();
		this.asks = new Set(); // Its asks whose answers are on their way.
		this.open = 0;
		this.tasks = 0; // Tasks run in it and in the scopes inside it.
		this.failed = 0; // Of those, the ones whose handler threw.
		this.registered = false;
		this.cancelled = null; // The outcome it was cancelled with: cancelled or timeout.
		this.done = false;
		this.progressQueued = false;
	}
	// Whether it, or a scope it's inside, was cancelled: nothing more is queued in it.
	get isCancelled() {
		for (let s = this; s !== null; s = s.outer) if (s.cancelled !== null) return true;
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
	// Whether it is s or inside s.
	isIn(s) {
		for (let x = this; x !== null; x = x.outer) if (x === s) return true;
		return false;
	}
}
// A watch's message: a name, or [name, args].
const asWatch = (w) => (w == null ? [] : typeof w === "string" ? [w, []] : [w[0], w[1] ?? []]);

// What happened to a task: one Transition per task the scheduler is done with, whether its
// handler ran, it had none, it failed, its node was gone (stale, orphaned, lost), its watch was
// cancelled (dropped) or, an ask, it was handed to its handler (asked). The host reports it as
// is, with what its dev checks found (issues). Heavy references (the task, the roots and the
// node it reached) are hidden, so inspecting or comparing one doesn't walk the tree, and toJSON
// gives what can be written down.
import { AskTask } from "./messages.js";
import { hidden, plainOf } from "./record.js";

// handled: its handler ran. passed: a notification's hop with no handler, which passes it on.
// unhandled: nobody handles it. asked: an ask, handed to its handler (its answer is a
// transition of its own). dropped: its watch was cancelled before it ran (or, an ask,
// before it was answered).
export const TRANSITION_OUTCOMES = [
	"handled",
	"passed",
	"unhandled",
	"failed",
	"stale",
	"orphaned",
	"lost",
	"dropped",
	"asked",
];

export class Transition {
	/**
	 * @param {object} fields what happened, plain: seq, cause, origin, mode, name, args, from,
	 *   to, outcome, error, emitted, unhandled, watch
	 * @param {object} heavy what it refers to, hidden: task, before, after, instance
	 */
	constructor(fields, heavy = {}) {
		this.kind = "transition";
		this.n = null; // Its place among what the host reported, set as it's reported.
		this.at = null; // When it was reported, by the host's clock.
		this.seq = null; // The task's number, per scheduler, so runs repeat.
		this.cause = null; // The number of the task that sent it; null when the host did.
		this.origin = null; // The number of the task its chain started with.
		this.mode = "send"; // send, notify, answer, ask or apply (a pure message from outside).
		this.name = "";
		this.args = [];
		this.from = null; // The sender's Address.
		this.to = null; // The Address it went to; null when it never had one.
		this.outcome = "handled";
		this.error = null; // What it threw, when it failed.
		this.emitted = []; // What its handler sent, as { kind, name, args }.
		this.unhandled = []; // Messages it made that nobody handles.
		this.watch = null; // The id of the watch it ran in.
		this.issues = []; // What the host's dev checks found.
		Object.assign(this, fields);
		hidden(this, { task: null, before: null, after: null, instance: null, ...heavy });
	}
	// The transition of task with outcome; extra adds fields (error, emitted, ...) and heavy
	// references (before, after, instance).
	static of(
		task,
		outcome,
		{ error = null, ctx = null, before = null, after = null, instance = null } = {},
	) {
		return new Transition(
			{
				seq: task.seq,
				cause: task.parent?.seq ?? null,
				origin: task.origin ?? task.seq,
				mode: modeOf(task),
				name: task.name,
				args: task.args,
				from: task.from,
				to: task.to,
				outcome,
				error,
				emitted: ctx?.emitted ?? [],
				unhandled: ctx?.unhandled ?? [],
				watch: task.watch?.id ?? null,
			},
			{ task, before, after: after ?? before, instance },
		);
	}
	// Whether its handler ran or it reached a node to run on: the state may have changed.
	get committed() {
		return this.outcome === "handled" || this.outcome === "passed" || this.outcome === "unhandled";
	}
	toJSON() {
		return plainOf(this);
	}
}
const modeOf = (task) => (task instanceof AskTask ? "ask" : task.hkey.mode);

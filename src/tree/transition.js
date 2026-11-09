// What happened to a task: one Transition per task the scheduler is done with, whether its
// handler ran, it had none, it failed, its node was gone (stale, orphaned, lost), its scope was
// cancelled (dropped) or, an ask, it was handed to its handler (asked). The host reports it as
// is, with what its dev checks found (issues). Heavy references (the task, the roots and the
// node it reached) are hidden, so inspecting or comparing one doesn't walk the tree, and toJSON
// gives what can be written down.
import { AskTask, hidden } from "./messages.js";

// handled: its handler ran. passed: a notification's hop with no handler, which passes it on.
// unhandled: nobody handles it. asked: an ask, handed to its handler (its answer is a
// transition of its own). dropped: its settle scope was cancelled before it ran (or, an ask,
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
	 *   to, outcome, error, emitted, unhandled, scope
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
		this.scope = null; // The id of the settle scope it ran in.
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
				seq: task.seq ?? null,
				cause: task.parent?.seq ?? null,
				origin: task.origin ?? task.seq ?? null,
				mode: modeOf(task),
				name: task.name,
				args: task.args,
				from: task.from,
				to: task.to,
				outcome,
				error,
				emitted: ctx?.emitted ?? [],
				unhandled: ctx?.unhandled ?? [],
				scope: task.scope?.id ?? null,
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

// value as data: its own enumerable fields, an Address as its path, an Error as its name and
// message, and no functions. What reports are written down as.
export const plainOf = (value) => {
	if (value === null || value === undefined) return value ?? null;
	if (typeof value === "function") return undefined;
	if (typeof value !== "object") return value;
	if (value instanceof Error) return { name: value.name, message: value.message };
	if (typeof value.keyPath === "object" && typeof value.isHost === "boolean") {
		return value.isHost ? "host" : String(value.keyPath);
	}
	if (Array.isArray(value)) return value.map(plainOf);
	const out = {};
	for (const key of Object.keys(value)) {
		const v = plainOf(value[key]);
		if (v !== undefined) out[key] = v;
	}
	return out;
};

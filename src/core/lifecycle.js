// What a Host reports besides what became of its tasks (the tree's Transition): it started
// and stopped, rendered (or failed to), an event or a sync engine failed, a change came from
// elsewhere, a settle scope opened and settled, and the queue settled. One Lifecycle per thing
// that happened, told apart by its phase. Heavy references (roots, the DOM event, the vdom, an
// engine) are hidden, so inspecting or comparing one doesn't walk them, and toJSON gives what
// can be written down.
import { hidden, plainOf } from "../tree/index.js";

// The phases, and what each carries besides n, at and issues:
// - started: the root started (hidden: root); issues, what dev checks found in it
// - stopped
// - rendered: upTo, the last task rendered (hidden: ctx, newVDom, curVDom)
// - renderFailed: error, upTo
// - eventFailed: eventType, error (hidden: event)
// - externalChange: source, the engine that made it (null for host.apply's), info (hidden:
//   before, after); issues, the fields it left invalid
// - syncFailed: engine, error
// - syncRejected: engine, ops
// - migrated: engine, and what a stored state lost fitting the components: added, reset, dropped
// - scopeOpened: scope, watcher, timeout
// - scopeSettled: scope, outcome, tasks, failed
// - settled: upTo, the last task run; issues, the invariants the root breaks
export const LIFECYCLE_PHASES = [
	"started",
	"stopped",
	"rendered",
	"renderFailed",
	"eventFailed",
	"externalChange",
	"syncFailed",
	"syncRejected",
	"migrated",
	"scopeOpened",
	"scopeSettled",
	"settled",
];
// The phases that are problems whatever their issues.
export const FAILED_PHASES = new Set(["renderFailed", "eventFailed", "syncFailed", "syncRejected"]);

export class Lifecycle {
	/**
	 * @param {string} phase one of LIFECYCLE_PHASES
	 * @param {object} fields what happened, plain
	 * @param {object} heavy what it refers to, hidden
	 */
	constructor(phase, fields = {}, heavy = {}) {
		this.kind = "lifecycle";
		this.n = null; // Its place among what the host reported, set as it's reported.
		this.at = null; // When it was reported, by the host's clock.
		this.phase = phase;
		this.issues = []; // What the host's dev checks found.
		Object.assign(this, fields);
		hidden(this, heavy);
	}
	toJSON() {
		return plainOf(this);
	}
}

// Whether a report (a Transition or a Lifecycle) is a problem: a task that failed, a phase that
// is a failure, or anything dev checks found something wrong with.
export const isProblem = (record) =>
	record.issues.length > 0 || record.outcome === "failed" || FAILED_PHASES.has(record.phase);
// An engine as reports name it: its name, else its place among the host's engines.
export const engineName = (engine, engines) =>
	engine === null || engine === undefined
		? null
		: (engine.name ?? `engine ${Math.max(0, engines.indexOf(engine))}`);

// What a Host reports besides what became of its tasks (the tree's Transition): it started
// and stopped, rendered (or failed to), an event or a sync engine failed, a change came from
// elsewhere, a watch opened and settled, and the queue settled. One HostEvent per thing
// that happened, told apart by its type. Heavy references (roots, the DOM event, the vdom, an
// engine) are hidden, so inspecting or comparing one doesn't walk them, and toJSON gives what
// can be written down.
import { hidden, plainOf } from "../../tree/index.js";

// The types, and what each carries besides n, at and issues:
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
// - watchOpened: watch, watcher, timeout
// - watchSettled: watch, outcome, tasks, failed
// - settled: upTo, the last task run; issues, the invariants the root breaks
export const HOST_EVENT_TYPES = [
	"started",
	"stopped",
	"rendered",
	"renderFailed",
	"eventFailed",
	"externalChange",
	"syncFailed",
	"syncRejected",
	"migrated",
	"watchOpened",
	"watchSettled",
	"settled",
];
// The types that are problems whatever their issues.
export const FAILED_TYPES = new Set(["renderFailed", "eventFailed", "syncFailed", "syncRejected"]);

export class HostEvent {
	/**
	 * @param {string} type one of HOST_EVENT_TYPES
	 * @param {object} fields what happened, plain
	 * @param {object} heavy what it refers to, hidden
	 */
	constructor(type, fields = {}, heavy = {}) {
		this.kind = "hostEvent";
		this.n = null; // Its place among what the host reported, set as it's reported.
		this.at = null; // When it was reported, by the host's clock.
		this.type = type;
		this.issues = []; // What the host's dev checks found.
		Object.assign(this, fields);
		hidden(this, heavy);
	}
	toJSON() {
		return plainOf(this);
	}
}

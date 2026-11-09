// What a Host reports besides what became of its tasks (the tree's Transition): it started
// and stopped, rendered (or failed to), an event or a sync engine failed, a change came from
// elsewhere, a watch opened and settled, and the queue settled. One HostEvent per thing
// that happened, told apart by its type. Heavy references (roots, the DOM event, the vdom, an
// engine) are hidden, so inspecting or comparing one doesn't walk them, and toJSON gives what
// can be written down.
import { hidden, Record } from "../../tree/index.js";

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

export class HostEvent extends Record {
	/**
	 * @param {string} type one of HOST_EVENT_TYPES
	 * @param {object} fields what happened, plain
	 * @param {object} heavy what it refers to, hidden
	 */
	constructor(type, fields = {}, heavy = {}) {
		super("hostEvent");
		this.type = type;
		Object.assign(this, fields);
		hidden(this, heavy);
	}
}

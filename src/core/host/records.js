// The records a host reports, of two kinds: a Transition (tree/transition.js) for what became of
// each task and each host.apply, a HostEvent (host-event.js) for the rest. What both share is
// here: whether one is a problem, and what it says in words. A record's issues are what dev
// checks found, as codes ({ check, reason, ... }); the problems of a spec or a meta (elsewhere)
// are sentences.
import { FAILED_TYPES } from "./host-event.js";
import { argsLabel } from "./text.js";

// Whether a record is a problem: a task that failed, a host event that is a failure, or
// anything dev checks found something wrong with.
export const isProblem = (record) =>
	record.issues.length > 0 || record.outcome === "failed" || FAILED_TYPES.has(record.type);

// A task, or the transition of one, as a timeline shows it: "toggle()", or "click → toggle()"
// for one a DOM event sent.
export const transitionLabel = (record) => {
	const call = `${record.name}(${argsLabel(record.args)})`;
	const event = (record.task ?? record).event ?? null;
	return event === null ? call : `${event.type} → ${call}`;
};
// What is wrong with a record, in words: one line for what failed,
// one for the invalid state it left and one per message that broke its spec. Empty for one that
// is no problem.
export const problemLines = (record) => {
	const lines = [];
	const failure = failureText(record);
	if (failure !== null) lines.push(failure);
	const state = record.issues.filter((i) => i.check === "state");
	if (state.length > 0) {
		const text = state.map((i) => `${i.component} ${i.path.join(".")} ${i.reason}`);
		lines.push(`invalid state: ${text.join("; ")}`);
	}
	const byMessage = new Map();
	for (const i of record.issues) {
		if (i.check === "message") byMessage.set(i.message, [...(byMessage.get(i.message) ?? []), i]);
	}
	for (const [message, issues] of byMessage) {
		lines.push(`${message} broke its spec: ${issues.map((i) => i.reason).join(", ")}`);
	}
	return lines;
};
const failureText = (record) => {
	const why = (error) => String(error?.stack ?? error);
	if (record.kind === "transition") {
		return record.outcome === "failed"
			? `${transitionLabel(record)} failed: ${why(record.error)}`
			: null;
	}
	switch (record.type) {
		case "renderFailed":
			return `render failed: ${why(record.error)}`;
		case "eventFailed":
			return `${record.eventType} event failed: ${why(record.error)}`;
		case "syncFailed":
			return `sync engine ${record.engine} failed: ${why(record.error)}`;
		case "syncRejected":
			return `sync engine ${record.engine} rejected ${record.ops.length} changes`;
		default:
			return null;
	}
};

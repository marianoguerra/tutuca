// How tools print values in labels, logs and messages: the tree's (tree/text.js) and a few more.
import { jsonText } from "../tree/text.js";

export { errorMessage, jsonText, keyText } from "../tree/text.js";
// s cut to max characters, with an ellipsis when it was longer.
export const truncate = (s, max) => (s.length > max ? `${s.slice(0, max)}…` : s);
// A message's args as a short label: their JSON, comma separated, cut to 80 characters.
export const argsLabel = (args) => truncate(args.map(jsonText).join(", "), 80);

// A task, or the transition of one, as a timeline shows it: "toggle()", or "click → toggle()"
// for one a DOM event sent.
export const transitionLabel = (record) => {
	const call = `${record.name}(${argsLabel(record.args)})`;
	const event = (record.task ?? record).event ?? null;
	return event === null ? call : `${event.type} → ${call}`;
};
// What is wrong with a report (a Transition or a Lifecycle), in words: one line for what failed,
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
	switch (record.phase) {
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

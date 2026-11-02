// Dev mode's checks: the state against the schemas and invariants, and each handled message
// against its spec. What breaks is reported through notify as stateInvalid or messageInvalid.
import { findInvalidFields, messageIssues } from "./schema.js";

export class DevChecks {
	constructor(notify) {
		this.notify = notify;
		this.settledRoot = null; // The root as of the last empty queue, for settled.
	}
	start(root) {
		this.settledRoot = root;
		this.state(null, null, root);
	}
	// The fields that changed from prevRoot to root. A task can leave invariants broken for the
	// tasks it queued, so after one they wait for settled.
	state(task, prevRoot, root) {
		this.report(root, prevRoot, { fields: true, invariants: task === null }, { task });
	}
	// Once the queue is empty, the invariants of what changed since it last was.
	settled(root) {
		if (this.settledRoot === root) return;
		const prevRoot = this.settledRoot;
		this.settledRoot = root;
		this.report(root, prevRoot, { fields: false, invariants: true }, { task: null, settled: true });
	}
	report(root, prevRoot, check, info) {
		const issues = findInvalidFields(root, prevRoot, check);
		if (issues.length > 0) this.notify("stateInvalid", { ...info, issues });
	}
	// The message the task's handler ran, against its spec, from prev to next.
	message(task, ctx, prev, next) {
		if (ctx.ran === null) return;
		const { message, args } = ctx.ran;
		const issues = messageIssues(message, prev, next, args, ctx);
		if (issues.length > 0) this.notify("messageInvalid", { task, message: message.name, issues });
	}
}

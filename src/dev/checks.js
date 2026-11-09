// Dev mode's checks: the state against the schemas and invariants, and each handled message
// against its spec and against who may write what: a component's fields are written by its own
// handlers and pure messages, not by its ancestors'. What breaks is reported through notify as
// stateInvalid or messageInvalid.
import { produce } from "../../deps/immer.js";
import { messageIssues, trackApplies } from "../core/contract.js";
import { isComponent, specOf } from "../core/spec.js";
import { keyText } from "../core/text.js";
import { findInvalidFields } from "../core/validate.js";
import { idOf } from "../tree/identity.js";

// The writes from prev to next, the component a task (or host.apply) handled before and after,
// that changed another component's own data, as { path, owner, field }: a component under it
// whose fields changed though no pure message was applied to it (ids). Only what changed is
// walked, as findInvalidFields does. Replacing, adding or removing a child changes the parent's
// field, so it's the parent's; a child that is the same one (by identity) but changed is its own.
// A version of a child that was already in prev (a snapshot an undo restores, a history entry
// that moved) was put there, not written: the parent's too. Only when there is a candidate is
// prev walked, to find those.
export const foreignWrites = (prev, next, ids) => {
	const writes = [];
	// Whether the plain data from a to b changed other than through the children in it, which
	// are walked as they are found.
	const dataChanged = (a, b, path) => {
		if (a === b) return false;
		if (isComponent(b)) {
			if (!isComponent(a) || idOf(a) !== idOf(b)) return true; // another child: a write here
			component(a, b, path);
			return false;
		}
		if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return true;
		if (Array.isArray(a) !== Array.isArray(b)) return true;
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		let changed = false;
		for (const key of keys) {
			const k = Array.isArray(b) ? Number(key) : key;
			if (dataChanged(a[key], b[key], [...path, k])) changed = true;
		}
		return changed;
	};
	// A component under the handled one: its fields that changed, if nothing was applied to it.
	const component = (a, b, path) => {
		const own = ids.has(idOf(b));
		for (const field of Object.keys(specOf(b).fields)) {
			if (dataChanged(a[field], b[field], [...path, field]) && !own) {
				const write = {
					path: [...path, field].map(keyText).join(""),
					owner: specOf(b).name,
					field,
				};
				writes.push({ write, component: b });
			}
		}
	};
	if (isComponent(prev) && isComponent(next) && prev !== next) {
		for (const field of Object.keys(specOf(next).fields))
			dataChanged(prev[field], next[field], [field]);
	}
	if (writes.length === 0) return [];
	const before = objectsIn(prev);
	return writes.filter(({ component }) => !before.has(component)).map(({ write }) => write);
};
// Every object in value, itself included.
const objectsIn = (value, found = new Set()) => {
	if (value === null || typeof value !== "object" || found.has(value)) return found;
	found.add(value);
	for (const key of Object.keys(value)) objectsIn(value[key], found);
	return found;
};
// The issues foreign writes are, among a message's issues: one per component field.
const writeIssues = (writes) => [
	...new Set(writes.map(({ owner, field }) => `foreign-write:${owner}.${field}`)),
];

export class DevChecks {
	constructor(notify) {
		this.notify = notify;
		this.settledRoot = null; // The root as of the last empty queue, for settled.
		this.writes = []; // The foreign writes of the last transaction, for message.
	}
	start(root) {
		this.settledRoot = root;
		this.state(null, null, root);
	}
	// A task's transaction, as the host's, recording the foreign writes it makes.
	transact(root, path, fn) {
		const [next, ids] = trackApplies(() =>
			produce(root, (rootDraft) => path.setIn(rootDraft, fn(path.getIn(rootDraft)))),
		);
		this.writes = foreignWrites(path.getIn(root), path.getIn(next), ids);
		return next;
	}
	// A pure message applied from outside the tree (host.apply): the writes of producer, under the
	// component at path. Returns the new root.
	applied(name, root, path, producer) {
		const [next, ids] = trackApplies(() => produce(root, producer));
		const writes = foreignWrites(path.getIn(root), path.getIn(next), ids);
		if (writes.length > 0) {
			this.notify("messageInvalid", {
				task: null,
				message: name,
				issues: writeIssues(writes),
				writes,
			});
		}
		return next;
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
	// The message the task's handler ran, against its spec, from prev to next, and the foreign
	// writes its transaction made.
	message(task, ctx, prev, next) {
		const writes = this.writes;
		this.writes = [];
		if (ctx.ran === null) return;
		const { message, args } = ctx.ran;
		const issues = [...messageIssues(message, prev, next, args, ctx), ...writeIssues(writes)];
		if (issues.length > 0) {
			const info = { task, message: message.name, issues };
			if (writes.length > 0) info.writes = writes;
			this.notify("messageInvalid", info);
		}
	}
}

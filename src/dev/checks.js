// Dev mode's checks: the state against the schemas and invariants, and each handled message
// against its spec and against who may write what: a component's fields are written by its own
// handlers and pure messages, not by its ancestors'. What breaks is returned as issues, which
// the host puts on the record (a Transition or a HostEvent) of what caused them.
import { produce } from "../../deps/immer.js";
import { leafProduce } from "../core/host/tree-binding.js";
import { trackApplies } from "../core/model/contract.js";
import { isComponent, specOf } from "../core/model/spec.js";
import { findInvalid, messageIssues } from "../core/model/validate.js";
import { idOf, pathText } from "../tree/index.js";

// The writes from prev to next, the component a task (or host.apply) handled before and after,
// that changed another component's own data, as { path, owner, field }: a component under it
// whose fields changed though no pure message was applied to it (ids). Only what changed is
// walked, as findInvalid does. Replacing, adding or removing a child changes the parent's
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
					path: pathText([...path, field]),
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
// The issues of a message: what its spec says it broke (reasons), then one per foreign write.
const messageIssuesOf = (message, reasons, writes) => [
	...reasons.map((reason) => ({ check: "message", message, reason })),
	...writes.map((write) => ({
		check: "message",
		message,
		reason: `foreign-write:${write.owner}.${write.field}`,
		write,
	})),
];
// The issues of a state: each invalid field or broken invariant findInvalid finds.
const stateIssuesOf = (root, prevRoot, check) =>
	findInvalid(root, prevRoot, check).map((issue) => ({ check: "state", ...issue }));

// What each check finds it returns, as issues: { check: "state", path, component, field, value,
// reason } for the state, { check: "message", message, reason, write? } for a message. The host
// puts them on the report of what caused them.
export class DevChecks {
	constructor() {
		this.writes = []; // The foreign writes of the last transaction, for message.
	}
	start(root) {
		return this.state(null, null, root);
	}
	// A task's transaction, as the host's, recording the foreign writes it makes.
	transact(root, path, fn) {
		const [next, ids] = trackApplies(() => leafProduce(root, path, fn));
		this.writes = foreignWrites(path.getIn(root), path.getIn(next), ids);
		return next;
	}
	// A pure message applied from outside the tree (host.apply): the writes of producer, under the
	// component at path. Returns [the new root, its issues].
	applied(name, root, path, producer) {
		const [next, ids] = trackApplies(() => produce(root, producer));
		const writes = foreignWrites(path.getIn(root), path.getIn(next), ids);
		return [next, messageIssuesOf(name, [], writes)];
	}
	// The fields that changed from prevRoot to root. A task can leave invariants broken for the
	// tasks it queued, so after one they wait for settled.
	state(task, prevRoot, root) {
		return stateIssuesOf(root, prevRoot, { fields: true, invariants: task === null });
	}
	// Once the queue is empty, the invariants of what changed since it last was, at prevRoot.
	settled(prevRoot, root) {
		return stateIssuesOf(root, prevRoot, { fields: false, invariants: true });
	}
	// The message the task's handler ran, against its spec, from prev to next, and the foreign
	// writes its transaction made.
	message(ctx, prev, next) {
		const writes = this.writes;
		this.writes = [];
		if (ctx.ran === null) return [];
		const { message, args } = ctx.ran;
		return messageIssuesOf(message.name, messageIssues(message, prev, next, args, ctx), writes);
	}
}

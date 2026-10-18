// State from another version of the components, made to fit this one: a projection stored or
// sent by an older or newer app (rebuild), the live state of the code before an edit (carry,
// hot reload), and ops from a peer on another version (fitOp). The rules are hydrate's: fields
// a component doesn't declare are dropped, values their type rejects take its default; each
// says what it changed.
import {
	findInvalidFields,
	isComponent,
	isRecord,
	NoDefaultError,
	specOf,
	typeText,
} from "../schema.js";
import { componentOf, hydrate, keyType, project, rootOf, typeAt } from "./codec.js";
import { diff } from "./diff.js";
import { applyOps } from "./ops.js";

const at = (value, path) => path.reduce((v, key) => v?.[key], value);

// The state plain (a projection at level) makes through scope's components, and what didn't
// come through: { root, added: [path], reset: [{ path, before, after }], dropped: [path],
// broken: [issue] }. added are fields plain lacks that level sees, now at their default; reset
// values their type rejects, now at their default; dropped fields the components don't
// declare; broken the issues findInvalidFields finds in root, invariants included. Throws when
// plain can't be made: a component that's gone, a new field without a default.
// type is the type plain has where it goes, for a value that isn't the whole state.
export const rebuild = (plain, scope, { level = "none", type = undefined } = {}) => {
	const root = hydrate(plain, scope, type);
	const after = project(root, { level, type });
	const added = [];
	const reset = [];
	for (const { op, path } of diff(plain, after, { scope, level })) {
		const key = path.at(-1);
		const parent = at(plain, path.slice(0, -1));
		if (op === "set" && isRecord(parent) && !Object.hasOwn(parent, key)) added.push(path);
		else reset.push({ path, before: at(plain, path), after: at(after, path) });
	}
	const dropped = droppedFields(plain, type, rootOf(scope));
	return { root, added, reset, dropped, broken: findInvalidFields(root, null) };
};
// The state prev holds, made again through scope's components: hot reload. rebuild of its
// projection with every field; throws as rebuild does, and for values a projection can't hold.
export const carry = (prev, scope) => rebuild(project(prev, { level: "none" }), scope);
const droppedFields = (plain, type, rootScope) => {
	const dropped = [];
	const walk = (v, type, path) => {
		if (v === null || typeof v !== "object") return;
		const isComponent = !Array.isArray(v) && componentOf(v, rootScope, type) !== null;
		for (const key of Object.keys(v)) {
			if (isComponent && key === "$") continue;
			const k = Array.isArray(v) ? Number(key) : key;
			const t = keyType(type, v, k, "none", rootScope);
			if (t === null) dropped.push([...path, k]);
			else walk(v[k], t, [...path, k]);
		}
	};
	walk(plain, type, []);
	return dropped;
};

// Whether every key on path is one the components it crosses declare.
const declared = (root, path) => {
	let value = root;
	for (const key of path) {
		if (isComponent(value) && !Object.hasOwn(specOf(value).fields, key)) return false;
		value = value?.[key];
	}
	return true;
};
// A value that can't be made where it goes: its op is dropped and path reported.
class Unfit extends Error {
	constructor(path) {
		super(`can't fit /${path.join("/")}`);
		this.path = path;
	}
}
// Applies op (one of applyOps') to root, a state draft, made to fit scope's components: an op
// under a field a component doesn't declare is dropped, and so is one whose value can't be
// made (a component that's gone, a field without a default); a value is rebuilt as rebuild
// does, and takes its type's default when the type rejects it. Types are checked without their
// owner, as a later op of the same change may make an index valid; the dev checks see the
// result. Adds what it changed, paths
// from the root, to report's added, reset and dropped. Returns the root, as applyOps does.
export const applyFitting = (root, op, scope, report, { level = "shared" } = {}) => {
	if (!declared(root, op.path)) {
		report.dropped.push(op.path);
		return root;
	}
	const adopt = (value, path, at) => {
		const { type, scope: owned } = typeAt(at, path, scope);
		let rebuilt;
		try {
			rebuilt = rebuild(value, scope, { level, type });
		} catch {
			throw new Unfit(path);
		}
		const under = (p) => [...path, ...p];
		report.added.push(...rebuilt.added.map(under));
		report.dropped.push(...rebuilt.dropped.map(under));
		for (const r of rebuilt.reset) report.reset.push({ ...r, path: under(r.path) });
		let made;
		try {
			made = type.make(rebuilt.root, owned, undefined);
		} catch (error) {
			if (error instanceof NoDefaultError) throw new Unfit(path);
			throw error;
		}
		if (made !== rebuilt.root) {
			report.reset.push({ path, before: value, after: project(made, { level, type }) });
		}
		return made;
	};
	try {
		return applyOps(root, [op], adopt);
	} catch (error) {
		if (!(error instanceof Unfit)) throw error;
		report.dropped.push(error.path);
		return root;
	}
};

// What changed between the components two scope trees register, by ref: for telling what a
// reload did, not deciding it. { ref, field, change: "added" | "removed" | "changed", before,
// after }, field null for a whole component, before and after typeText of the field.
export const specChanges = (prevScope, scope) => {
	const prevRefs = specsByRef(rootOf(prevScope));
	const refs = specsByRef(rootOf(scope));
	const changes = [];
	for (const ref of new Set([...prevRefs.keys(), ...refs.keys()])) {
		const a = prevRefs.get(ref);
		const b = refs.get(ref);
		if (a === undefined || b === undefined) {
			const change = a === undefined ? "added" : "removed";
			changes.push({ ref, field: null, change, before: null, after: null });
			continue;
		}
		for (const field of new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])) {
			const before = Object.hasOwn(a.fields, field) ? typeText(a.fields[field]) : null;
			const after = Object.hasOwn(b.fields, field) ? typeText(b.fields[field]) : null;
			if (before === after) continue;
			const change = before === null ? "added" : after === null ? "removed" : "changed";
			changes.push({ ref, field, change, before, after });
		}
	}
	return changes;
};
const specsByRef = (scope, out = new Map()) => {
	for (const name in scope.byName) out.set([...scope.path, name].join("/"), scope.byName[name]);
	for (const name in scope.children) specsByRef(scope.children[name], out);
	return out;
};

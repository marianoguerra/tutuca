// Hot reload: a state made with one version of the components, rebuilt with the next one. The
// state goes through its projection at level "none", so it holds refs, not specs, and hydrate
// makes it again through whatever the refs name now; diffing the two projections tells what
// didn't come through.
import { findInvalidFields, isRecord, typeText } from "../schema.js";
import { componentOf, hydrate, keyType, project, rootOf } from "./codec.js";
import { diff } from "./diff.js";

const at = (value, path) => path.reduce((v, key) => v?.[key], value);

// The state prev holds, made again through scope's components:
//   { root, added: [path], reset: [{ path, before, after }], dropped: [path], broken: [issue] }
// added are fields prev lacked, now at their default; reset values the new types reject, now at
// their default; dropped fields the components no longer have; broken the issues
// findInvalidFields finds in root, invariants included. Throws when prev can't be projected or
// made again: a component that's gone, a new field without a default.
export const carry = (prev, scope) => {
	const before = project(prev, { level: "none" });
	const root = hydrate(before, scope);
	const after = project(root, { level: "none" });
	const added = [];
	const reset = [];
	for (const { op, path } of diff(before, after, { scope, level: "none" })) {
		const key = path.at(-1);
		const parent = at(before, path.slice(0, -1));
		if (op === "set" && isRecord(parent) && !Object.hasOwn(parent, key)) added.push(path);
		else reset.push({ path, before: at(before, path), after: at(after, path) });
	}
	const dropped = droppedFields(before, rootOf(scope));
	return { root, added, reset, dropped, broken: findInvalidFields(root, null) };
};
const droppedFields = (plain, rootScope) => {
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
	walk(plain, undefined, []);
	return dropped;
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

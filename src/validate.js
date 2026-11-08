// Dev mode's check of a state against its schemas: the fields that don't match their type and
// the invariants that don't hold.
import { brokenInvariants } from "./contract.js";
import { isComponent, scopeOf, specOf } from "./spec.js";

// Dev mode: the fields of the components in value that don't match their schema, as
// { path, component, field, value, reason }. Broken invariants report the component
// itself with field null and reason "invariant:<name>". Subtrees shared with prev are
// skipped, so after a task only what it changed is walked. check picks what to report.
export const findInvalidFields = (value, prev, check = { fields: true, invariants: true }) =>
	collectInvalid(value, prev, check, [], []);
const collectInvalid = (value, prev, check, issues, path) => {
	if (value === prev || value === null || typeof value !== "object") return issues;
	const prevAt = (key) => (prev !== null && typeof prev === "object" ? prev[key] : undefined);
	if (!isComponent(value)) {
		for (const key of Object.keys(value)) {
			collectInvalid(value[key], prevAt(key), check, issues, [...path, key]);
		}
		return issues;
	}
	const { name: component, fields } = specOf(value);
	const scope = scopeOf(value);
	const report = (field, reason) =>
		issues.push({ path: [...path, field], component, field, value: value[field], reason });
	for (const field of check.fields ? Object.keys(value) : []) {
		if (!Object.hasOwn(fields, field)) report(field, "undeclared");
	}
	for (const field in fields) {
		if (check.fields && !fields[field].isValid(value[field], scope, value))
			report(field, "invalid");
		collectInvalid(value[field], prevAt(field), check, issues, [...path, field]);
	}
	for (const name of check.invariants ? brokenInvariants(value) : []) {
		issues.push({ path, component, field: null, value, reason: `invariant:${name}` });
	}
	return issues;
};

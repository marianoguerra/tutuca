// Actions (spec/component/action.rkt): what handling one message does to one instance, and the
// checks on it: message contracts (messageIssues) and invalid state (invalidIn).
//
// A handler is a function (next, args), called with the instance before the message as this.
// next starts as that instance and is the handler's to write on: what it holds when the
// handler returns is the instance after the message. Returning a value replaces the instance.
import { produce } from "../../../../deps/immer.js";
import { classOf, isComponent } from "./class.js";
import { valid } from "./types.js";

// One message on one instance: { outcome: "ok", next } or, when the handler throws,
// { outcome: "aborted", error }. The instance it was given is as it was either way.
// The handler must exist; the host decides what a missing handler means.
export function act(classDef, self, name, args) {
	const handler = classDef.on[name];
	if (handler === undefined) throw new Error(`${classDef.name} has no handler for ${name}`);
	try {
		return { outcome: "ok", next: produce(self, (next) => handler.run.call(self, next, args)) };
	} catch (error) {
		return { outcome: "aborted", error };
	}
}

// Whether fn returns truthy without throwing.
function holds(fn) {
	try {
		return Boolean(fn());
	} catch {
		return false;
	}
}

// The ways a handled message broke its contract: "args" for their count, "arg:<i>" for one's
// type, "pre" and "post". prev and next are the instance before and after the handler.
export function messageIssues(classDef, name, prev, next, args) {
	const handler = classDef.on[name];
	const issues = [];
	if (handler.args !== undefined) {
		if (handler.args.length !== args.length) issues.push("args");
		else {
			handler.args.forEach((ty, i) => {
				if (!valid(ty, args[i], prev)) issues.push(`arg:${i}`);
			});
		}
	}
	if (handler.pre !== undefined && !holds(() => handler.pre.call(prev, prev, args))) {
		issues.push("pre");
	}
	if (handler.post !== undefined && !holds(() => handler.post.call(prev, prev, next, args))) {
		issues.push("post");
	}
	return issues;
}

// The fields of the components in value that do not match their schema, as
// { path, component, field, value, reason }, then broken invariants, reported on the component
// with field null. Subtrees shared with prev are skipped, so after a message only what it
// changed is walked. check picks what to report.
export const invalidIn = (value, prev, check = { fields: true, invariants: true }) =>
	collect(value, prev, check, []);

function collect(value, prev, check, path) {
	if (value === prev || value === null || typeof value !== "object") return [];
	const prevAt = (key) => (prev !== null && typeof prev === "object" ? prev[key] : undefined);
	const below = (key) => collect(value[key], prevAt(key), check, [...path, key]);
	if (!isComponent(value)) return Object.keys(value).flatMap(below);
	const { name: component, fields, invariants } = classOf(value);
	const issues = [];
	const report = (field, reason) =>
		issues.push({ path: [...path, field], component, field, value: value[field], reason });
	if (check.fields) {
		for (const field of Object.keys(value)) {
			if (!Object.hasOwn(fields, field)) report(field, "undeclared");
		}
	}
	for (const field of Object.keys(fields)) {
		if (check.fields && !valid(fields[field], value[field], value)) report(field, "invalid");
		issues.push(...below(field));
	}
	if (check.invariants) {
		for (const name of Object.keys(invariants)) {
			if (!holds(() => invariants[name].call(value))) {
				issues.push({ path, component, field: null, value, reason: `invariant:${name}` });
			}
		}
	}
	return issues;
}

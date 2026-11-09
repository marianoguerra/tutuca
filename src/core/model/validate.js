// What breaks a component's spec, as issues: the ways a call's args and a handled message don't
// fit the message's spec, the invariants an instance breaks, and the fields of a state that
// don't match their types. contract.js throws them for a call; dev mode (dev/checks.js) reports
// them for what a host ran.
import { isComponent, scopeOf, specOf } from "./spec.js";

// Whether fn returns truthy without throwing.
export function holds(fn) {
	try {
		return Boolean(fn());
	} catch {
		return false;
	}
}
// The names of the invariants instance breaks; a throwing invariant counts as broken.
export const brokenInvariants = (instance) => {
	const { invariants } = specOf(instance);
	return Object.keys(invariants).filter((name) => !holds(() => invariants[name].call(instance)));
};
// The ways args don't match types: "args" for their count, "arg:<i>" for one's type.
export const argIssues = (types, args, scope, owner) => {
	if (types === undefined) return [];
	if (args.length !== types.length) return ["args"];
	const issues = [];
	types.forEach((type, i) => {
		if (!type.isValid(args[i], scope, owner)) issues.push(`arg:${i}`);
	});
	return issues;
};
// Whether a message's pre and post conditions hold; one it doesn't have holds. A throwing one
// doesn't. info is what the handler's ctx says about the message ({} outside a handler).
export const preHolds = (message, prev, args, info) =>
	message.pre === undefined || holds(() => message.pre.call(prev, prev, args, info));
export const postHolds = (message, prev, next, args, info) =>
	message.post === undefined || holds(() => message.post.call(prev, prev, next, args, info));
// The ways a handled message broke its spec: "args", "arg:<i>", "sourceKey", "pre", "post"
// and "emits:<kind>:<name>". prev and next are the component before and after the handler,
// info is { sourceKey, emitted } from the MessageContext it ran in.
export const messageIssues = (message, prev, next, args, info) => {
	const scope = scopeOf(prev);
	const issues = argIssues(message.args, args, scope, prev);
	const { sourceKey, emitted } = info;
	if (message.sourceKey !== undefined && !message.sourceKey.isValid(sourceKey, scope, prev)) {
		issues.push("sourceKey");
	}
	if (!preHolds(message, prev, args, info)) issues.push("pre");
	if (!postHolds(message, prev, next, args, info)) issues.push("post");
	if (message.emits !== undefined) {
		for (const { kind, name } of emitted) {
			if (!message.emits[kind]?.includes(name)) issues.push(`emits:${kind}:${name}`);
		}
	}
	return issues;
};

// What's invalid in a state: the fields of the components in value that don't match their type, as
// { path, component, field, value, reason }. Broken invariants report the component
// itself with field null and reason "invariant:<name>". Subtrees shared with prev are
// skipped, so after a task only what it changed is walked. check picks what to report.
export const findInvalid = (value, prev, check = { fields: true, invariants: true }) =>
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

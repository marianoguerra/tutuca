// Component specs: the identity a component instance carries, the specs of its messages,
// answers and queries, the interfaces it implements, and the checks of instances and handled
// messages against them. Field types are in schema.js.
import { typeText } from "./schema.js";

export const specSym = Symbol("TutucaSpec");
export const scopeSym = Symbol("TutucaScope");
// An instance's identity is the tree's (tree/identity.js).
export { idOf, idSym } from "./tree/identity.js";
export const specOf = (v) => v?.[specSym];
// Whether fn returns truthy without throwing.
export function holds(fn) {
	try {
		return Boolean(fn());
	} catch {
		return false;
	}
}
export const scopeOf = (v) => v?.[scopeSym] ?? null;
export const isComponent = (v) => specOf(v) !== undefined;
// The names of the invariants instance breaks; a throwing invariant counts as broken.
export const brokenInvariants = (instance) => {
	const { invariants } = specOf(instance);
	return Object.keys(invariants).filter((name) => !holds(() => invariants[name].call(instance)));
};
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
// An on entry is a handler function, or a handler spec { run, args, sourceKey, pre, why, post,
// emits, pure }: the handler, run, with its contract. args types the send/notify arguments,
// sourceKey the child key it arrives from, pre and post are conditions on the instance (why,
// given self and args, says in words why pre doesn't hold), and emits lists what it may send
// as { notify, ask, sendAt } name arrays. A pure one runs as run(next, args),
// without a ctx: it can't send or read the world, so it can also be applied (contract.js) to a
// component synchronously, in whatever transaction the caller is in.
export class HandlerSpec {
	constructor(name, entry) {
		const spec = typeof entry === "function" ? { run: entry } : entry;
		this.name = name;
		this.run = spec.run;
		this.args = spec.args;
		this.sourceKey = spec.sourceKey;
		this.pre = spec.pre;
		this.why = spec.why;
		this.post = spec.post;
		this.emits = spec.emits;
		this.pure = spec.pure === true;
	}
}
// A query: a public read of a component, with no effects. A get one reads like a field (a
// getter, a computed property; a public field is one too), a call one takes args. args and
// returns type them, for checks and tools.
export class QuerySpec {
	constructor(name, { kind, fn = null, args = undefined, returns = undefined }) {
		this.name = name;
		this.kind = kind; // "get", "call" or "field"
		this.fn = fn; // The getter or the function; null for a field.
		this.args = kind === "call" ? args : [];
		this.returns = returns;
	}
}
// queries' entries: a getter (get), a function (call), { get, returns } or
// { run, args, returns }. Fields marked public are get queries returning their type.
// Other entries stay as they are for lint to report.
export const toQueries = (queries, fields) => {
	const out = Object.create(null);
	for (const name in fields) {
		if (fields[name]?.isPublic) {
			out[name] = new QuerySpec(name, { kind: "field", returns: fields[name] });
		}
	}
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(queries ?? {}))) {
		const v = d.value;
		if (d.get !== undefined) out[name] = new QuerySpec(name, { kind: "get", fn: d.get });
		else if (typeof v === "function") out[name] = new QuerySpec(name, { kind: "call", fn: v });
		else if (typeof v?.get === "function")
			out[name] = new QuerySpec(name, { kind: "get", fn: v.get, returns: v.returns });
		else if (typeof v?.run === "function")
			out[name] = new QuerySpec(name, {
				kind: "call",
				fn: v.run,
				args: v.args,
				returns: v.returns,
			});
		else out[name] = v;
	}
	return out;
};
// An interface: what a component offers other components, by name and type, and no state.
// messages and pure map names to arg types; queries map names to { args, returns }, args
// empty for a get one; notifies map names to arg types, of the messages it notifies up with.
export class Interface {
	constructor(name, { messages = {}, pure = {}, queries = {}, notifies = {} } = {}) {
		this.name = name;
		this.messages = messages;
		this.pure = pure;
		this.queries = queries;
		this.notifies = notifies;
	}
}
export const iface = (name, operations) => new Interface(name, operations);
// A type as its signature: what it accepts, without its default.
const sigText = (type) => typeText(type.with({ defaultValue: undefined }));
const sameTypes = (want = [], got = undefined) =>
	got !== undefined &&
	want.length === got.length &&
	want.every((t, i) => sigText(t) === sigText(got[i]));
// What spec lacks to implement iface, as messages: each of iface's messages a handler with the
// same arg types (a pure one does too), each pure message a pure one, each query one of the
// same args and returns. Undeclared types only match no args. notifies aren't checked: a
// handler need not declare what it emits.
export const interfaceProblems = (spec, iface) => {
	const problems = [];
	const missing = (what, name) => problems.push(`its ${what} ${name} is missing`);
	const mismatch = (what, name, detail) =>
		problems.push(`its ${what} ${name} ${detail}, ${iface.name}'s doesn't`);
	const checkMessage = (name, args, pure) => {
		const h = spec.on[name];
		if (!(h instanceof HandlerSpec)) return missing(pure ? "pure message" : "message", name);
		if (pure && !h.pure) problems.push(`its message ${name} isn't pure, ${iface.name}'s is`);
		if (!(args.length === 0 && h.args === undefined) && !sameTypes(args, h.args))
			mismatch("message", name, `takes (${(h.args ?? []).map(sigText).join(", ")})`);
	};
	for (const name in iface.messages) checkMessage(name, iface.messages[name], false);
	for (const name in iface.pure) checkMessage(name, iface.pure[name], true);
	for (const name in iface.queries) {
		const want = iface.queries[name];
		const q = spec.queries?.[name];
		if (!(q instanceof QuerySpec)) {
			missing("query", name);
			continue;
		}
		const wantArgs = want.args ?? [];
		if (
			wantArgs.length === 0 ? q.kind === "call" && q.args?.length > 0 : !sameTypes(wantArgs, q.args)
		)
			mismatch("query", name, `takes (${(q.args ?? []).map(sigText).join(", ")})`);
		if (want.returns !== undefined) {
			if (q.returns === undefined) problems.push(`its query ${name} doesn't say what it returns`);
			else if (sigText(want.returns) !== sigText(q.returns))
				mismatch("query", name, `returns ${sigText(q.returns)}`);
		}
	}
	return problems;
};
// The interfaces spec says it implements, resolved in scope: an Interface as it is, a name as
// the scope has it (null when it doesn't).
export const resolveImplements = (spec, scope) =>
	(spec.implements ?? []).map((it) =>
		it instanceof Interface ? it : (scope?.lookupInterface(it) ?? null),
	);
// Whether value is a component implementing iface: it says so, in its scope, or its scope makes
// it by the interface's name.
export const implementsIface = (value, iface) => {
	const spec = specOf(value);
	if (spec === undefined) return false;
	const scope = scopeOf(value);
	if (resolveImplements(spec, scope).includes(iface)) return true;
	if (scope === null) return false;
	for (const s of scope.ancestors()) {
		for (const name in s.interfaces) {
			if (s.interfaces[name] === iface && scope.lookupByName(name) === spec) return true;
		}
	}
	return false;
};
// Calling an interface operation a component doesn't support, or with what breaks its contract.
// code is the first of issues: "unknown", "not-pure", "args", "arg:<i>", "pre", "post", "returns",
// "invariant:<name>", or "not-component".
export class ContractError extends Error {
	constructor(component, name, issues, detail = "") {
		const what = component === null ? "not a component" : `${component}.${name}`;
		super(`${what}: ${issues.join(", ")}${detail === "" ? "" : ` (${detail})`}`);
		this.name = "ContractError";
		this.component = component;
		this.operation = name;
		this.issues = issues;
		this.code = issues[0];
		this.detail = detail; // In words, as a failed pre's why says it.
	}
}
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
// An on or answers entry as a HandlerSpec; other entries stay as they are for lint to report.
const toHandler = (name, entry) =>
	typeof entry === "function" || (typeof entry === "object" && entry !== null)
		? new HandlerSpec(name, entry)
		: entry;
export const toMessages = (on) => {
	const messages = Object.create(null); // no toString &c in entries
	for (const key in on) messages[key] = toHandler(key, on[key]);
	return messages;
};
// answers maps an ask's name to its outcomes' handlers, { ok, error, unhandled }, each an entry
// as on's are; its HandlerSpec is named "<ask>.<outcome>". Other shapes stay for lint.
export const toAnswers = (answers) => {
	const out = Object.create(null);
	for (const ask in answers) {
		const outcomes = answers[ask];
		if (typeof outcomes !== "object" || outcomes === null) {
			out[ask] = outcomes;
			continue;
		}
		out[ask] = Object.create(null);
		for (const outcome in outcomes) {
			out[ask][outcome] = toHandler(`${ask}.${outcome}`, outcomes[outcome]);
		}
	}
	return out;
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

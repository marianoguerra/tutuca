// Interfaces: what a component offers other components, by name and type, and the checks of
// a spec against one. An interface is data, its types as types.js writes them, registered by
// name in a scope, which compiles it into an Interface.
import { HandlerSpec, QuerySpec, scopeOf, specOf } from "./spec.js";
import { compileType, isRecord, signatureText } from "./types.js";

// An interface, compiled: messages and pure map names to arg types; queries map names to
// { args, returns }, args empty for a get one; notifies map names to arg types, of the messages
// it notifies up with. data is what it was compiled from.
export class Interface {
	constructor(name, { messages, pure, queries, notifies }, data) {
		this.name = name;
		this.messages = messages;
		this.pure = pure;
		this.queries = queries;
		this.notifies = notifies;
		this.data = data;
	}
}
const SECTIONS = ["messages", "pure", "queries", "notifies", "checks"];
// What's wrong with data as an interface, [] when nothing is.
const interfaceDataProblems = (data) => {
	if (!isRecord(data)) return [`an interface is { ${SECTIONS.join(", ")} }, not ${String(data)}`];
	const problems = [];
	for (const key of Object.keys(data)) {
		if (!SECTIONS.includes(key))
			problems.push(`an interface has no ${key} (it has ${SECTIONS.join(", ")})`);
	}
	for (const section of ["messages", "pure", "notifies"]) {
		for (const [name, args] of Object.entries(data[section] ?? {})) {
			if (!Array.isArray(args)) problems.push(`${section}.${name} must be an array of arg types`);
		}
	}
	for (const [name, q] of Object.entries(data.queries ?? {})) {
		if (!isRecord(q) || Object.keys(q).some((k) => k !== "args" && k !== "returns"))
			problems.push(`queries.${name} must be { args, returns }`);
		else if (q.args !== undefined && !Array.isArray(q.args))
			problems.push(`queries.${name}.args must be an array of arg types`);
	}
	return problems;
};
// An interface's data, checked: what iface() gives and registerInterfaces takes.
export const iface = (data) => {
	const problems = interfaceDataProblems(data);
	if (problems.length > 0) throw new TypeError(`Not an interface: ${problems.join("; ")}`);
	return data;
};
// The Interface data says, under name: its types compiled with its checks.
export const compileInterface = (name, data) => {
	iface(data);
	const { checks } = data;
	const types = (section) => {
		const out = {};
		for (const [op, args] of Object.entries(data[section] ?? {}))
			out[op] = args.map((a) => compileType(a, checks));
		return out;
	};
	const queries = {};
	for (const [op, q] of Object.entries(data.queries ?? {})) {
		queries[op] = {
			args: (q.args ?? []).map((a) => compileType(a, checks)),
			returns: q.returns === undefined ? undefined : compileType(q.returns, checks),
		};
	}
	const sections = {
		messages: types("messages"),
		pure: types("pure"),
		queries,
		notifies: types("notifies"),
	};
	return new Interface(name, sections, data);
};
const sameTypes = (want = [], got = undefined) =>
	got !== undefined &&
	want.length === got.length &&
	want.every((t, i) => signatureText(t) === signatureText(got[i]));
// What spec lacks to implement face, as messages: each of face's messages a handler with the
// same arg types (a pure one does too), each pure message a pure one, each query one of the
// same args and returns. Undeclared types only match no args. notifies aren't checked: a
// handler need not declare what it emits.
const takes = (args) => `takes (${(args ?? []).map(signatureText).join(", ")})`;
export const interfaceProblems = (spec, face) => {
	const problems = [];
	const missing = (what, name) => problems.push(`its ${what} ${name} is missing`);
	const mismatch = (what, name, detail) =>
		problems.push(`its ${what} ${name} ${detail}, ${face.name}'s doesn't`);
	const checkMessage = (name, args, pure) => {
		const h = spec.on[name];
		if (!(h instanceof HandlerSpec)) return missing(pure ? "pure message" : "message", name);
		if (pure && !h.pure) problems.push(`its message ${name} isn't pure, ${face.name}'s is`);
		if (!(args.length === 0 && h.args === undefined) && !sameTypes(args, h.args))
			mismatch("message", name, takes(h.args));
	};
	for (const name in face.messages) checkMessage(name, face.messages[name], false);
	for (const name in face.pure) checkMessage(name, face.pure[name], true);
	for (const name in face.queries) {
		const want = face.queries[name];
		const q = spec.queries[name];
		if (!(q instanceof QuerySpec)) {
			missing("query", name);
			continue;
		}
		const wantArgs = want.args ?? [];
		if (
			wantArgs.length === 0 ? q.kind === "call" && q.args?.length > 0 : !sameTypes(wantArgs, q.args)
		)
			mismatch("query", name, takes(q.args));
		if (want.returns !== undefined) {
			if (q.returns === undefined) problems.push(`its query ${name} doesn't say what it returns`);
			else if (signatureText(want.returns) !== signatureText(q.returns))
				mismatch("query", name, `returns ${signatureText(q.returns)}`);
		}
	}
	return problems;
};
// The interfaces spec says it implements, by name, as scope has them (null where it doesn't).
export const resolveImplements = (spec, scope) =>
	spec.implements.map((name) => scope?.lookupInterface(name) ?? null);
// Whether value is a component implementing face, an Interface or an interface's name in
// value's scope: it says so, in its scope, or its scope makes it by the interface's name.
export const implementsIface = (value, faceOrName) => {
	const spec = specOf(value);
	if (spec === undefined) return false;
	const scope = scopeOf(value);
	const face =
		typeof faceOrName === "string" ? (scope?.lookupInterface(faceOrName) ?? null) : faceOrName;
	if (face === null) return false;
	if (resolveImplements(spec, scope).includes(face)) return true;
	if (scope === null) return false;
	for (const s of scope.ancestors()) {
		for (const name in s.interfaces) {
			if (s.interfaces[name] === face && scope.lookupSpec(name) === spec) return true;
		}
	}
	return false;
};

// Interfaces: what a component offers other components, by name and type, and the checks of
// a spec against one. Field types are in types.js, which imports this module, so this one
// reads a type's text through its text() method instead of importing types.js.
import { HandlerSpec, QuerySpec, scopeOf, specOf } from "./spec.js";

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
const sigText = (type) => type.with({ defaultValue: undefined }).text();
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
			if (s.interfaces[name] === iface && scope.lookupSpec(name) === spec) return true;
		}
	}
	return false;
};

// A component's contract: what it offers other components and tools, by name, without them
// knowing its state. apply runs one of its pure messages, query one of its queries, both
// synchronously; contractOf describes them. What it doesn't support, or a call that breaks
// the operation's contract, throws a ContractError. What a call or a state breaks is worked out
// in validate.js.
import { current, freeze, isDraft, produce } from "../../../deps/immer.js";
import { idOf } from "../../tree/index.js";
import { ComponentSpec } from "./component.js";
import { Interface, interfaceProblems, resolveImplements } from "./interface.js";
import { HandlerSpec, QuerySpec, scopeOf, specOf } from "./spec.js";
import { argIssues, brokenInvariants, postHolds, preHolds } from "./validate.js";

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
// The ids of the components pure messages were applied to while fn ran, for the dev check that
// a component's fields are only written by it (dev/checks.js): [what fn returns, ids].
let applied = null;
export const trackApplies = (fn) => {
	const outer = applied;
	const ids = new Set();
	applied = ids;
	try {
		return [fn(), ids];
	} finally {
		applied = outer;
	}
};

const specOrThrow = (c, name) => {
	const spec = specOf(c);
	if (spec === undefined) throw new ContractError(null, name, ["not-component"]);
	return spec;
};
const failIf = (spec, name, issues, detail) => {
	if (issues.length > 0) throw new ContractError(spec.name, name, issues, detail);
};
// Throws a ContractError when args don't fit message name of spec, or its pre doesn't hold on
// prev, saying why when the message has a why.
export const checkCall = (spec, name, message, prev, args, scope = scopeOf(prev)) => {
	failIf(spec, name, argIssues(message.args, args, scope, prev));
	if (!preHolds(message, prev, args, {})) {
		failIf(spec, name, ["pre"], message.why?.call(prev, prev, args) ?? "");
	}
};
// Throws a ContractError naming the invariants of instance that don't hold, after name.
export const checkInvariants = (spec, name, instance) =>
	failIf(
		spec,
		name,
		brokenInvariants(instance).map((inv) => `invariant:${inv}`),
	);
// The component c is after its pure message name(...args). On a draft (in a handler, or in a
// pure message applying another) it changes the draft, in the caller's transaction, and
// returns it, or what the handler returned to replace it. On a committed component it returns
// a new one, or c if nothing changed, and checks its invariants.
export const apply = (c, name, ...args) => {
	const spec = specOrThrow(c, name);
	const message = spec.on[name];
	if (!(message instanceof HandlerSpec)) throw new ContractError(spec.name, name, ["unknown"]);
	if (!message.pure) throw new ContractError(spec.name, name, ["not-pure"]);
	const prev = isDraft(c) ? current(c) : c;
	checkCall(spec, name, message, prev, args, scopeOf(c));
	applied?.add(idOf(c));
	let next;
	if (isDraft(c)) {
		const result = message.run.call(prev, c, args);
		next = result === undefined ? c : result;
	} else {
		next = produce(c, (draft) => message.run.call(prev, draft, args));
	}
	if (!postHolds(message, prev, next, args, {})) throw new ContractError(spec.name, name, ["post"]);
	if (!isDraft(next) && next !== c) checkInvariants(spec, name, next);
	return next;
};
// c as a query reads it, frozen, so a query that writes throws instead of changing c: a draft
// as it holds so far, one made and not yet committed as a frozen shallow copy.
const frozenView = (c) => {
	if (isDraft(c)) return freeze(current(c), true);
	if (Object.isFrozen(c)) return c;
	return Object.freeze(
		Object.create(Object.getPrototypeOf(c), Object.getOwnPropertyDescriptors(c)),
	);
};
// What c's query name(...args) returns, read from a frozen view of c (on a draft, what it holds
// so far).
export const query = (c, name, ...args) => {
	const spec = specOrThrow(c, name);
	const q = spec.queries[name];
	if (!(q instanceof QuerySpec)) throw new ContractError(spec.name, name, ["unknown"]);
	const it = frozenView(c);
	const scope = scopeOf(c);
	failIf(spec, name, argIssues(q.args, args, scope, it));
	const result =
		q.kind === "field" ? it[name] : q.kind === "get" ? q.fn.call(it) : q.fn.apply(it, args);
	if (q.returns !== undefined && !q.returns.isValid(result, scope, it)) {
		throw new ContractError(spec.name, name, ["returns"]);
	}
	return result;
};
// Whether c offers the pure message or query name.
export const canApply = (c, name) => specOf(c)?.on[name]?.pure === true;
export const canQuery = (c, name) => specOf(c)?.queries[name] instanceof QuerySpec;
// What c (a component or its spec) offers: the interfaces it implements (resolved in its
// scope), its messages, which pure, its queries and the notifies its handlers declare. No state.
export const contractOf = (c) => {
	const isSpec = c instanceof ComponentSpec;
	const spec = isSpec ? c : specOrThrow(c, "contract");
	const scope = isSpec ? null : scopeOf(c);
	const notifies = new Set();
	const messages = Object.values(spec.on)
		.filter((m) => m instanceof HandlerSpec)
		.map((m) => {
			for (const n of m.emits?.notify ?? []) notifies.add(n);
			return { name: m.name, pure: m.pure, args: m.args };
		});
	const queries = Object.values(spec.queries)
		.filter((q) => q instanceof QuerySpec)
		.map((q) => ({ name: q.name, args: q.args, returns: q.returns }));
	const implemented = resolveImplements(spec, scope).map((it, i) =>
		it === null
			? { name: String(spec.implements[i]), resolved: false }
			: { name: it.name, resolved: true, interface: it },
	);
	return { name: spec.name, implements: implemented, messages, queries, notifies: [...notifies] };
};
// What c lacks to implement iface (an Interface, or a name in c's scope), as messages: none
// when it implements it.
export const interfaceGaps = (c, iface) => {
	const spec = specOrThrow(c, "interfaceGaps");
	const it = iface instanceof Interface ? iface : scopeOf(c)?.lookupInterface(iface);
	if (it === null || it === undefined) return [`no interface ${String(iface)} in its scope`];
	return interfaceProblems(spec, it);
};

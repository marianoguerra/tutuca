// A component's contract: what it offers other components, by name, without them knowing its
// state. apply runs one of its pure messages, query one of its queries, both right away.
// What it does not offer, or a call that breaks the operation's contract, throws a ContractError.
import { current, freeze, isDraft } from "../../../../deps/immer.js";
import { act, invalidIn, messageIssues } from "./action.js";
import { classOf, scopeOf } from "./instance.js";
import { Interface, interfaceProblems } from "./interface.js";
import { valid } from "./types.js";

// code is the first of issues: "not-component", "unknown", "not-pure", "args", "arg:<i>",
// "pre", "post", "returns" or "invariant:<name>".
export class ContractError extends Error {
	constructor(component, name, issues) {
		super(
			`${component === null ? "not a component" : `${component}.${name}`}: ${issues.join(", ")}`,
		);
		this.name = "ContractError";
		this.component = component;
		this.operation = name;
		this.issues = issues;
		this.code = issues[0];
	}
}

function classOrThrow(c, name) {
	const classDef = classOf(c);
	if (classDef === undefined) throw new ContractError(null, name, ["not-component"]);
	return classDef;
}
const failIf = (classDef, name, issues) => {
	if (issues.length > 0) throw new ContractError(classDef.name, name, issues);
};

// The instance c is after its pure message name(...args): act, with the contract enforced.
// In a handler, on a draft, it writes on the draft and returns it, so the caller's step holds
// both. Anywhere else it returns the next instance and checks its invariants.
export function apply(c, name, ...args) {
	const classDef = classOrThrow(c, name);
	const handler = classDef.on[name];
	if (handler === undefined) throw new ContractError(classDef.name, name, ["unknown"]);
	if (!handler.pure) throw new ContractError(classDef.name, name, ["not-pure"]);
	const prev = isDraft(c) ? current(c) : c;
	// What the call breaks before it runs: everything but post.
	failIf(
		classDef,
		name,
		messageIssues(classDef, name, prev, prev, args).filter((issue) => issue !== "post"),
	);
	let next;
	if (isDraft(c)) {
		const replaced = handler.run.call(prev, c, args);
		next = replaced === undefined ? c : replaced;
	} else {
		const stepped = act(classDef, c, name, args);
		if (stepped.outcome === "aborted") throw stepped.error;
		next = stepped.next;
	}
	const after = isDraft(next) ? current(next) : next;
	failIf(
		classDef,
		name,
		messageIssues(classDef, name, prev, after, args).filter((issue) => issue === "post"),
	);
	if (!isDraft(next)) {
		failIf(
			classDef,
			name,
			invalidIn(next, prev, { invariants: true }).map((issue) => issue.reason),
		);
	}
	return next;
}

// What c's query name(...args) returns, read from c frozen, so a query that writes throws.
export function query(c, name, ...args) {
	const classDef = classOrThrow(c, name);
	const q = classDef.queries[name];
	if (q === undefined) throw new ContractError(classDef.name, name, ["unknown"]);
	const it = isDraft(c) ? freeze(current(c)) : c;
	if (q.args.length !== args.length) throw new ContractError(classDef.name, name, ["args"]);
	failIf(
		classDef,
		name,
		q.args.flatMap((ty, i) => (valid(ty, args[i], it) ? [] : [`arg:${i}`])),
	);
	const result = q.kind === "get" ? q.fn.call(it) : q.fn.apply(it, args);
	if (q.returns !== undefined && !valid(q.returns, result, it)) {
		throw new ContractError(classDef.name, name, ["returns"]);
	}
	return result;
}

// What c lacks to implement face (an Interface, or a name in c's scope), as messages: none
// when it implements it.
export function interfaceGaps(c, face) {
	const classDef = classOrThrow(c, "interfaceGaps");
	const it = face instanceof Interface ? face : scopeOf(c)?.lookupInterface(face);
	if (it === null || it === undefined) return [`no interface ${String(face)} in its scope`];
	return interfaceProblems(classDef, it);
}

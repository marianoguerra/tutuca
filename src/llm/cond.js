// Conditional nodes, for both llm vocabularies: what a model is told, and what it may do, follows
// the state. $if picks one node of two; these take any number of children, and the condition
// can compare instead of only testing:
//
//   When(field("items"), ...)                    the items are there: not empty
//   Unless({ test: field("count"), is: 0 }, ...) the count isn't 0
//   Choose(
//     Case({ test: field("left"), is: 0 }, ...),
//     Case({ test: field("left"), above: 10 }, ...),
//     Otherwise(...),
//   )
//
// A test alone holds when its value is present: not null, undefined, false, 0, "", or an empty
// array, Map, Set or object (so field("items") is "there are items"). With comparisons, it holds
// when all of them do; their values can be fields too ({ test: field("count"), atLeast:
// field("limit") }). Only the branch that holds is rendered.

import { ViewNode } from "../tutuca.js";
import { toVChildren, VFragment } from "../vdom/index.js";
import { isAttrs, LlmError, toNode } from "./build.js";

export const COMPARISONS = {
	is: (a, b) => a === b,
	not: (a, b) => a !== b,
	above: (a, b) => a > b,
	below: (a, b) => a < b,
	atLeast: (a, b) => a >= b,
	atMost: (a, b) => a <= b,
	in: (a, b) => (b instanceof Set || b instanceof Map ? b.has(a) : (b ?? []).includes(a)),
};

export const present = (v) => {
	if (v == null || v === false || v === 0 || v === "" || Number.isNaN(v)) return false;
	if (Array.isArray(v) || typeof v === "string") return v.length > 0;
	if (v instanceof Map || v instanceof Set) return v.size > 0;
	if (isAttrs(v)) return Object.keys(v).length > 0;
	return true;
};

// A condition: a test, a value, and the comparisons it must pass.
class Condition {
	constructor(where, arg) {
		const given = isAttrs(arg) ? arg : { test: arg };
		if (!("test" in given)) throw new LlmError([`${where} needs a test`]);
		this.test = toNode(given.test);
		this.comparisons = [];
		for (const [op, value] of Object.entries(given)) {
			if (op === "test") continue;
			if (COMPARISONS[op] === undefined) {
				const ops = Object.keys(COMPARISONS).join(", ");
				throw new LlmError([`${where} compares with ${ops}, not ${op}`]);
			}
			this.comparisons.push([op, toNode(value)]);
		}
	}
	holds(ctx) {
		const value = this.test.eval(ctx);
		if (this.comparisons.length === 0) return present(value);
		return this.comparisons.every(([op, node]) => COMPARISONS[op](value, node.eval(ctx)));
	}
	nodes() {
		return [this.test, ...this.comparisons.map(([, node]) => node)];
	}
}

const renderAll = (children, ctx) => new VFragment(toVChildren(children.map((c) => c.eval(ctx))));
const EMPTY = new VFragment([]);

// Its children when the condition holds (When), or when it doesn't (Unless); nothing otherwise.
export class WhenNode extends ViewNode {
	constructor(condition, children, negate) {
		super();
		this.condition = condition;
		this.children = children;
		this.negate = negate;
	}
	eval(ctx) {
		return this.condition.holds(ctx) !== this.negate ? renderAll(this.children, ctx) : EMPTY;
	}
	childNodes() {
		return [...this.condition.nodes(), ...this.children];
	}
	branchChildren() {
		return this.children;
	}
}
// One branch of a Choose: a Case with its condition, or Otherwise without one.
export class CaseNode extends ViewNode {
	constructor(condition, children) {
		super();
		this.condition = condition;
		this.children = children;
	}
	eval() {
		throw new LlmError([
			`${this.condition === null ? "Otherwise" : "Case"} is only valid in Choose`,
		]);
	}
	childNodes() {
		return [...(this.condition?.nodes() ?? []), ...this.children];
	}
}
// The children of its first Case that holds, or of its Otherwise.
export class ChooseNode extends ViewNode {
	constructor(cases) {
		super();
		this.cases = cases;
	}
	eval(ctx) {
		for (const c of this.cases) {
			if (c.condition === null || c.condition.holds(ctx)) return renderAll(c.children, ctx);
		}
		return EMPTY;
	}
	childNodes() {
		return this.cases;
	}
	branchChildren() {
		return this.cases.flatMap((c) => c.children);
	}
}

export const When = (test, ...children) =>
	new WhenNode(new Condition("When", test), children.flat(Infinity).map(toNode), false);
export const Unless = (test, ...children) =>
	new WhenNode(new Condition("Unless", test), children.flat(Infinity).map(toNode), true);
export const Case = (test, ...children) =>
	new CaseNode(new Condition("Case", test), children.flat(Infinity).map(toNode));
export const Otherwise = (...children) => new CaseNode(null, children.flat(Infinity).map(toNode));
export const Choose = (...cases) => {
	const issues = [];
	cases.forEach((c, i) => {
		if (!(c instanceof CaseNode)) issues.push(`Choose takes Case and Otherwise, not ${String(c)}`);
		else if (c.condition === null && i !== cases.length - 1) {
			issues.push("Choose's Otherwise is its last branch");
		}
	});
	if (issues.length > 0) throw new LlmError(issues);
	return new ChooseNode(cases);
};
export const conditionals = { When, Unless, Choose, Case, Otherwise };

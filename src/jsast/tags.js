// js: the tag builders of renders.js, as tag is of views. js.BinaryExpression(attrs, ...slots) is an
// ESTree node, its attrs the node's scalar fields; js.left(...nodes) a slot, one of the node
// fields of the node it's in. Both are h elements, so field, each, render and $if work in them.
//
// What a view says when it's built is checked here: a type or attr that doesn't exist, a constant
// attr of the wrong kind, a slot its node doesn't have (or has twice), a node outside a slot, a
// node a slot doesn't take, text. What field, each or render give is only known when the view
// renders; lower.js checks that.
import { CondNode, ConstantNode, ElementNode, h } from "../tutuca.js";
import {
	accepts,
	describeAccepts,
	describeType,
	HOLE,
	isTypeName,
	SCHEMA,
	scalarIssue,
} from "./schema.js";

export class JsAstError extends Error {
	constructor(issues) {
		super(issues.length === 1 ? issues[0] : `${issues.length} issues:\n  ${issues.join("\n  ")}`);
		this.name = "JsAstError";
		this.issues = issues;
	}
}

// The elements among a view's children, each with whether it's always there (not in a branch of
// an $if), and whether some child is only known when it renders. Text is an issue.
const staticChildren = (children, where, issues) => {
	const elements = [];
	let dynamic = false;
	const visit = (child, always) => {
		if (child instanceof ElementNode) elements.push({ node: child, always });
		else if (child instanceof CondNode) {
			dynamic = true; // Only one branch renders.
			visit(child.thenVal, false);
			visit(child.elseVal, false);
		} else if (child instanceof ConstantNode) {
			const { value } = child;
			if (value != null && value !== "")
				issues.push(`${where} can't hold text (${JSON.stringify(value)})`);
		} else dynamic = true;
	};
	for (const child of children) visit(child, true);
	return { elements, dynamic };
};

const checkType = (node, issues) => {
	const { tagName: type, attrs, children } = node;
	if (type === HOLE) {
		if (attrs.length > 0 || children.length > 0) issues.push("Hole takes no attrs or children");
		return;
	}
	const spec = SCHEMA[type];
	if (spec === undefined) {
		issues.push(`unknown ESTree type ${type}`);
		return;
	}
	const given = new Set();
	for (const [name, value] of attrs) {
		given.add(name);
		const issue = scalarIssue(type, name, value instanceof ConstantNode ? value.value : null);
		// A computed attr's value is checked when it renders; only its name is known now.
		if (issue !== null && (value instanceof ConstantNode || !(name in spec.scalars))) {
			issues.push(issue);
		}
	}
	for (const name in spec.scalars) {
		if (!given.has(name)) {
			const issue = scalarIssue(type, name, undefined);
			if (issue !== null) issues.push(issue);
		}
	}
	const { elements, dynamic } = staticChildren(children, type, issues);
	const seen = new Set();
	for (const { node: child, always } of elements) {
		const name = child.tagName;
		if (isTypeName(name)) {
			const slots = Object.keys(spec.slots);
			const hint = slots.length === 0 ? "it has none" : `one of ${slots.join(", ")}`;
			issues.push(`${name} in ${type} needs a slot around it (${hint})`);
			continue;
		}
		const slotSpec = spec.slots[name];
		if (slotSpec === undefined) {
			const slots = Object.keys(spec.slots);
			issues.push(
				`${type} has no slot ${name} (its slots: ${slots.length === 0 ? "none" : slots.join(", ")})`,
			);
			continue;
		}
		if (always && seen.has(name)) issues.push(`${type} has slot ${name} twice`);
		if (always) seen.add(name);
		checkSlotContent(type, name, slotSpec, child, issues);
	}
	if (!dynamic) {
		for (const [name, slotSpec] of Object.entries(spec.slots)) {
			if (slotSpec.arity === "one" && !elements.some((e) => e.node.tagName === name)) {
				issues.push(`${type} needs slot ${name}`);
			}
		}
	}
};

// The nodes a slot holds, as far as they're known when it's built.
const checkSlotContent = (type, name, slotSpec, slotNode, issues) => {
	const where = `${type}.${name}`;
	const { elements, dynamic } = staticChildren(slotNode.children, where, issues);
	for (const { node } of elements) {
		const childType = node.tagName;
		if (!isTypeName(childType)) issues.push(`${where} holds slot ${childType}: a slot holds nodes`);
		else if (childType !== HOLE && SCHEMA[childType] === undefined)
			continue; // Said where it's built.
		else if (!accepts(slotSpec, childType)) {
			issues.push(`${where} takes ${describeAccepts(slotSpec)}, not ${describeType(childType)}`);
		}
	}
	const single = slotSpec.arity === "one" || slotSpec.arity === "opt";
	if (single && elements.filter((e) => e.always).length > 1) {
		issues.push(`${where} holds one node, not ${elements.length}`);
	}
	if (slotSpec.arity === "one" && !dynamic && elements.length === 0) {
		issues.push(`${where} needs a node`);
	}
};

const checkSlot = (node, issues) => {
	if (node.attrs.length > 0) issues.push(`slot ${node.tagName} takes no attrs`);
	staticChildren(node.children, `slot ${node.tagName}`, issues);
};

const isAttrs = (v) =>
	v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const build = (name, args) => {
	const [attrs, children] = isAttrs(args[0]) ? [args[0], args.slice(1)] : [{}, args];
	const node = h(name, attrs, ...children);
	const issues = [];
	if (node.handlers.length > 0) issues.push(`${name} can't handle events`);
	if (isTypeName(name)) checkType(node, issues);
	else checkSlot(node, issues);
	if (issues.length > 0) throw new JsAstError(issues);
	return node;
};
// Destructure the ones a module uses: const { Identifier, Literal } = js; const { left } = js.
export const js = new Proxy(Object.create(null), {
	get: (_target, name) => (typeof name === "string" ? (...args) => build(name, args) : undefined),
});

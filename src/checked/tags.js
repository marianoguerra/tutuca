// The tag builders of a checked target (schema.js): md, ps, docx, as tag is of views.
// tags.Heading({ depth: 1 }, ...children) is a node, its attrs the node's fields other than
// children. They're h elements, so field, each, render and $if work in them.
//
// What a view says when it's built is checked here: a type or attr that doesn't exist, a constant
// attr of the wrong kind, a child its node doesn't take, text where there can't be any. What
// field, each or render give is only known when the view renders; lower.js checks that.
import { CondNode, ConstantNode, ElementNode, h } from "../core/view/view.js";
import { isTypeName } from "./schema.js";

// The children of a node as far as they're known when it's built: elements, and constant text.
const checkChildren = (schema, type, children, issues) => {
	const spec = schema.spec(type);
	const visit = (child) => {
		if (child instanceof CondNode) {
			visit(child.thenVal);
			visit(child.elseVal);
		} else if (child instanceof ConstantNode) {
			const { value } = child;
			if (value == null || value === "") return;
			if (!schema.takesText(type))
				issues.push(`${type} can't hold text (${JSON.stringify(value)})`);
		} else if (child instanceof ElementNode) {
			const childType = child.tagName;
			if (spec.literal) issues.push(`${type} holds text, not ${childType}`);
			else if (schema.spec(childType) === undefined)
				return; // Said where it's built.
			else if (!schema.accepts(type, childType)) {
				issues.push(`${type} takes ${schema.describeChildren(type)}, not ${childType}`);
			}
		}
	};
	for (const child of children) visit(child);
};

const check = (schema, node, issues) => {
	const { tagName: type, attrs, children } = node;
	const spec = schema.spec(type);
	if (!isTypeName(type) || spec === undefined) {
		issues.push(
			`unknown ${schema.name} type ${type} (one of ${Object.keys(schema.tags).join(", ")})`,
		);
		return;
	}
	const given = new Set();
	for (const [name, value] of attrs) {
		given.add(name);
		const issue = schema.scalarIssue(
			type,
			name,
			value instanceof ConstantNode ? value.value : null,
		);
		// A computed attr's value is checked when it renders; only its name is known now.
		if (issue !== null && (value instanceof ConstantNode || !(name in spec.scalars))) {
			issues.push(issue);
		}
	}
	for (const name in spec.scalars) {
		if (!given.has(name)) {
			const issue = schema.scalarIssue(type, name, undefined);
			if (issue !== null) issues.push(issue);
		}
	}
	if (spec.children === null && children.length > 0) issues.push(`${type} takes no children`);
	else checkChildren(schema, type, children, issues);
};

const isAttrs = (v) =>
	v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

// The builders of schema's tags, throwing an ErrorClass (a SchemaError) for what's wrong.
// Destructure the ones a module uses: const { Heading, Paragraph } = md.
export const checkedTags = (schema, ErrorClass) => {
	const build = (name, args) => {
		const [attrs, children] = isAttrs(args[0]) ? [args[0], args.slice(1)] : [{}, args];
		const node = h(name, attrs, ...children);
		const issues = [];
		if (node.handlers.length > 0) issues.push(`${name} can't handle events`);
		check(schema, node, issues);
		if (issues.length > 0) throw new ErrorClass(issues);
		return node;
	};
	return new Proxy(Object.create(null), {
		get: (_target, name) => (typeof name === "string" ? (...args) => build(name, args) : undefined),
	});
};

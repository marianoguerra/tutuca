// What the two llm vocabularies share: the error they throw, how a tag reads its arguments, the
// children a view says when it's built and the ones it renders.
import { CondNode, ConstantNode, ElementNode, h, ViewNode } from "../tutuca.js";
import { VComment, VFragment, VText } from "../vdom/index.js";

export const isAttrs = (v) =>
	v !== null &&
	typeof v === "object" &&
	!(v instanceof ViewNode) &&
	Object.getPrototypeOf(v) === Object.prototype;
export const toNode = (v) => (v instanceof ViewNode ? v : new ConstantNode(v));

export class LlmError extends Error {
	constructor(issues) {
		super(issues.length === 1 ? issues[0] : `${issues.length} issues:\n  ${issues.join("\n  ")}`);
		this.name = "LlmError";
		this.issues = issues;
	}
}

// A tag's arguments: its positional attrs first (Tool's name and on:call, Fact's name and
// value), then an attrs object, then its children. A first argument that is an attrs object
// says them all by name: Str({ name: "title" }, "What to add") is Str("title", "What to add").
export const argsOf = (positional, args) => {
	const attrs = {};
	let i = 0;
	if (!isAttrs(args[0])) {
		for (const name of positional) {
			if (i >= args.length || isAttrs(args[i])) break;
			attrs[name] = args[i++];
		}
	}
	if (isAttrs(args[i])) Object.assign(attrs, args[i++]);
	return { attrs, children: args.slice(i) };
};

// The children a view says, as they're known when it's built: elements and constant text, with
// whether something else is only known when it renders (field, each, render).
export const staticChildren = (children) => {
	const elements = [];
	const texts = [];
	let dynamic = false;
	const visit = (child) => {
		if (child instanceof ElementNode) elements.push(child);
		else if (child instanceof ConstantNode) {
			if (child.value != null && child.value !== "") texts.push(String(child.value));
		} else if (child instanceof CondNode) {
			dynamic = true;
			visit(child.thenVal);
			visit(child.elseVal);
		} else if (typeof child.branchChildren === "function") {
			// When, Unless and Choose (cond.js).
			dynamic = true;
			for (const c of child.branchChildren()) visit(c);
		} else dynamic = true;
	};
	for (const child of children) visit(child);
	return { elements, texts, dynamic };
};

// A tag of a vocabulary: check(tag, attrs, node, issues) checks the element it builds.
export const tagBuilder = (schema, check) => (name, args) => {
	const spec = schema[name];
	if (spec === undefined) {
		throw new LlmError([`unknown tag ${name} (one of ${Object.keys(schema).join(", ")})`]);
	}
	const { attrs, children } = argsOf(spec.positional ?? [], args);
	const node = h(name, attrs, ...children);
	const issues = [];
	check(name, attrs, node, issues);
	if (issues.length > 0) throw new LlmError(issues);
	return node;
};

// What a node rendered to, as a list: fragments spliced, adjacent text joined and empty text
// dropped. Each element comes with the tutuca markers it's inside, outermost first, so a tool
// knows the component it's in; markers is the list for the parent's level.
export const flatten = (children, markers = []) => {
	const out = [];
	const stack = [...markers];
	const visit = (list) => {
		for (const child of list) {
			if (child instanceof VComment) {
				if (child.text === "§/§") stack.pop();
				else if (child.text.startsWith("§{")) stack.push(JSON.parse(child.text.slice(1, -1)));
			} else if (child instanceof VFragment) visit(child.children);
			else if (child instanceof VText) {
				if (child.text === "") continue;
				const last = out.at(-1);
				if (last?.text !== undefined) last.text += child.text;
				else out.push({ text: child.text });
			} else out.push({ node: child, markers: [...stack] });
		}
	};
	visit(children);
	return out;
};

// An attr's kind, and what's wrong with a value of it.
const KINDS = {
	string: (v) => (typeof v === "string" ? null : "a string"),
	number: (v) => (typeof v === "number" && Number.isFinite(v) ? null : "a number"),
	boolean: (v) => (typeof v === "boolean" ? null : "a boolean"),
	any: () => null,
};
export const attr = (kind, required = false) => ({ kind, required });

// What's wrong with value as attr name of tag, or null; undefined and null are left out.
export const attrIssue = (tag, spec, name, value) => {
	const a = spec.attrs?.[name];
	if (a === undefined) {
		const names = Object.keys(spec.attrs ?? {});
		return `${tag} has no attr ${name} (its attrs: ${names.length === 0 ? "none" : names.join(", ")})`;
	}
	if (value === undefined || value === null) return a.required ? `${tag} needs ${name}` : null;
	const expected = KINDS[a.kind](value);
	return expected === null ? null : `${tag}.${name} is ${expected}, not ${JSON.stringify(value)}`;
};
// The issues of a tag's attrs as it renders, with where it is.
export const attrsIssues = (tag, spec, attrs, where, issues) => {
	for (const name in attrs) {
		if (name === "data-eid") continue;
		const issue = attrIssue(tag, spec, name, attrs[name]);
		if (issue !== null) issues.push(`${where}: ${issue}`);
	}
	for (const name in spec.attrs ?? {}) {
		if (!(name in attrs) && spec.attrs[name].required)
			issues.push(`${where}: ${tag} needs ${name}`);
	}
};
const describeKids = (spec) => {
	const kids = [...(spec.children ?? []), ...(spec.text ? ["text"] : [])];
	return kids.length === 0 ? "no children" : kids.join(", ");
};
// Whether a tag of spec takes a child of childTag, and the issue when it doesn't.
export const childIssue = (tag, spec, childTag) =>
	spec.children?.includes(childTag) ? null : `${tag} takes ${describeKids(spec)}, not ${childTag}`;
export const textIssue = (tag, spec, text) =>
	spec.text ? null : `${tag} takes ${describeKids(spec)}, not text ${JSON.stringify(text)}`;

// The checks every tag of a schema gets when it's built: its attrs (the constant ones; a
// computed one is checked as it renders), its handlers (only a spec with handler takes one, of
// that type) and the children known then. spec.check(attrs, node, statics, issues) adds a tag's
// own.
export const checkTag = (schema) => (tag, attrs, node, issues) => {
	const spec = schema[tag];
	for (const name in attrs) {
		if (name.startsWith("on:")) continue;
		const value = attrs[name];
		if (value instanceof ViewNode) {
			if (spec.attrs?.[name] === undefined) issues.push(attrIssue(tag, spec, name, undefined));
		} else {
			const issue = attrIssue(tag, spec, name, value);
			if (issue !== null) issues.push(issue);
		}
	}
	for (const name in spec.attrs ?? {}) {
		if (!(name in attrs) && spec.attrs[name].required) issues.push(`${tag} needs ${name}`);
	}
	for (const { type } of node.handlers) {
		if (spec.handler !== type) {
			issues.push(
				spec.handler
					? `${tag} handles on:${spec.handler}, not on:${type}`
					: `${tag} can't handle events`,
			);
		}
	}
	const statics = staticChildren(node.children);
	for (const child of statics.elements) {
		const issue = childIssue(tag, spec, child.tagName);
		if (issue !== null) issues.push(issue);
	}
	for (const text of statics.texts) {
		const issue = textIssue(tag, spec, text);
		if (issue !== null) issues.push(issue);
	}
	spec.check?.(attrs, node, statics, issues);
};
// A vocabulary's tags, by name, as md and js are: const { Tool, Str } = llmTools.
export const vocabulary = (schema, extra = {}) => {
	const build = tagBuilder(schema, checkTag(schema));
	const tags = Object.create(null);
	for (const name in schema) tags[name] = (...args) => build(name, args);
	return Object.freeze(Object.assign(tags, extra));
};

// A render target whose renders are a tree checked against a table of node types: tutuca/mdast,
// tutuca/ps and tutuca/docx. The table is the target's (src/<target>/schema.js); this is how it's
// read, by both validation layers: tags.js on what a view says when it's built, lower.js on the
// tree it renders to. One table, so the two can't disagree.
//
// Each tag (PascalCase) in a table says:
// - type: its type in the tree lower.js makes (Heading is heading, Rect rect).
// - is: the categories it belongs to (Flow, Phrasing, Graphic, ...). Children are accepted when
//   their tag, or one of its categories, is in children.
// - scalars: its attrs, by name: a kind (KINDS, or the target's own), and whether it may be left
//   out. Left out, they're left out of the node too, unless the target's lower defaults them.
// - children: what its children can be, or null for a node with none.
// - literal: its value is its text: the value attr, or the text its children render to.

export const isTypeName = (name) => /^[A-Z]/.test(name);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

// What a value of each kind is, said as what was expected: null when it's one.
export const KINDS = {
	string: (v) => (typeof v === "string" ? null : "a string"),
	number: (v) => (isNumber(v) ? null : "a number"),
	size: (v) => (isNumber(v) && v >= 0 ? null : "a number, 0 or more"),
	positive: (v) => (isNumber(v) && v > 0 ? null : "a number over 0"),
	boolean: (v) => (typeof v === "boolean" ? null : "a boolean"),
	enum: (v, scalar) => (scalar.values.includes(v) ? null : `one of ${scalar.values.join(", ")}`),
	color: (v) => (isColor(v) ? null : "a color, #rgb or #rrggbb"),
};
export const isColor = (v) => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

// Scalars, as tables write them.
export const opt = (kind, extra = {}) => ({ kind, optional: true, ...extra });
export const req = (kind, extra = {}) => ({ kind, optional: false, ...extra });
export const oneOf = (values, optional = true) => ({ kind: "enum", values, optional });
// Tags, as tables write them.
export const parent = (type, is, children, scalars = {}) => ({ type, is, scalars, children });
export const empty = (type, is, scalars = {}) => ({ type, is, scalars, children: null });
export const literal = (type, is, scalars = {}) => ({
	type,
	is,
	scalars,
	children: [],
	literal: true,
});

// A target's table, and what it says.
// - name: the tree's name in messages (mdast, ps, docx), and render: the target's (md, ps, docx).
// - categories: the categories its tags are in.
// - kinds: kinds of scalars its own, beside KINDS.
// - textIn: the categories whose parents take text, as text nodes (mdast's Phrasing); a literal
//   always takes it, as its value.
// - describeCategory: how a message says a category (Flow content, a Graphic).
export class Schema {
	constructor(
		tags,
		{ name, render, categories, kinds = {}, textIn = [], describeCategory = (c) => `${c} content` },
	) {
		this.tags = tags;
		this.name = name;
		this.render = render;
		this.categories = new Set(categories);
		this.kinds = { ...KINDS, ...kinds };
		this.textIn = textIn;
		this.describeCategory = describeCategory;
	}
	spec(type) {
		return Object.hasOwn(this.tags, type) ? this.tags[type] : undefined;
	}
	// "an mdast node", "a ps node".
	get aNode() {
		return `${/^[aeiou]/.test(this.name) ? "an" : "a"} ${this.name} node`;
	}
	// Whether a parent of type takes a child of childType.
	accepts(type, childType) {
		const { children } = this.tags[type];
		if (children === null) return false;
		return (
			children.includes(childType) || this.tags[childType].is.some((c) => children.includes(c))
		);
	}
	// Whether text can go straight in it: a literal, or a parent textIn says.
	takesText(type) {
		const spec = this.tags[type];
		return spec.literal === true || this.textIn.some((c) => spec.children?.includes(c));
	}
	describeChildren(type) {
		const { children } = this.tags[type];
		if (children === null) return "no children";
		return children
			.map((c) => (this.categories.has(c) ? this.describeCategory(c) : c))
			.join(" or ");
	}
	// What's wrong with value as attr name of type, or null; undefined is a value left out.
	scalarIssue(type, name, value) {
		const scalar = this.tags[type].scalars[name];
		const names = Object.keys(this.tags[type].scalars);
		if (scalar === undefined) {
			return `${type} has no attr ${name} (its attrs: ${names.length === 0 ? "none" : names.join(", ")})`;
		}
		if (value === undefined || value === null) {
			return scalar.optional ? null : `${type} needs attr ${name}`;
		}
		const expected = this.kinds[scalar.kind](value, scalar);
		return expected === null
			? null
			: `${type}.${name} is ${expected}, not ${JSON.stringify(value)}`;
	}
}

// What's wrong with a tree, every issue: the issues are what to fix, the message all of them.
export class SchemaError extends Error {
	constructor(issues) {
		super(issues.length === 1 ? issues[0] : `${issues.length} issues:\n  ${issues.join("\n  ")}`);
		this.name = new.target.name;
		this.issues = issues;
	}
}

// The mdast node types a renders.md can use (https://github.com/syntax-tree/mdast, with GFM's
// delete, tables and task list items), and the checks both validation layers share: tags.js runs
// them on what a view says when it's built, lower.js on the tree it renders to. One table, so the
// two can't disagree.
//
// mdast is simpler than ESTree: a node's only node field is children, so there are no slots.
// Each tag (PascalCase, as ESTree's types are) says:
// - type: its mdast type (Heading is heading, ListItem listItem).
// - is: the content categories it belongs to (Flow, Phrasing). Children are accepted when their
//   tag, or one of its categories, is in children.
// - scalars: its other fields, the tag's attrs, by name: a kind, and whether it may be left out.
//   Left out, they're left out of the node too (a listItem without checked is not a task), but
//   for spread, which is false (lower.js's DEFAULTS).
// - children: what its children can be, or null for a node with none. In a Phrasing parent, text
//   is a text node; adjacent text is one node.
// - literal: its value is its text (Text, InlineCode, Code, Html): the value attr, or the text
//   its children render to.

export const FLOW = "Flow";
export const PHRASING = "Phrasing";
const CATEGORIES = new Set([FLOW, PHRASING]);

const str = { kind: "string" };
const optStr = { kind: "string", optional: true };
const bool = { kind: "boolean", optional: true };
const optNum = { kind: "number", optional: true };
const oneOf = (values, optional = false) => ({ kind: "enum", values, optional });
export const ALIGNS = ["left", "right", "center", null];
const aligns = { kind: "aligns", optional: true };

const parent = (type, is, children, scalars = {}) => ({ type, is, scalars, children });
const literal = (type, is, scalars = {}) => ({ type, is, scalars, children: [], literal: true });
const empty = (type, is, scalars = {}) => ({ type, is, scalars, children: null });

const P = [PHRASING];
const F = [FLOW];

export const SCHEMA = {
	Root: parent("root", [], F),
	// Flow
	Paragraph: parent("paragraph", F, P),
	Heading: parent("heading", F, P, { depth: oneOf([1, 2, 3, 4, 5, 6]) }),
	ThematicBreak: empty("thematicBreak", F),
	Blockquote: parent("blockquote", F, F),
	List: parent("list", F, ["ListItem"], { ordered: bool, start: optNum, spread: bool }),
	ListItem: parent("listItem", [], F, { checked: bool, spread: bool }),
	Code: literal("code", F, { lang: optStr, meta: optStr, value: optStr }),
	Html: literal("html", [FLOW, PHRASING], { value: optStr }),
	Definition: empty("definition", F, { identifier: str, label: optStr, url: str, title: optStr }),
	Table: parent("table", F, ["TableRow"], { align: aligns }),
	TableRow: parent("tableRow", [], ["TableCell"]),
	TableCell: parent("tableCell", [], P),
	// Phrasing
	Text: literal("text", P, { value: optStr }),
	Emphasis: parent("emphasis", P, P),
	Strong: parent("strong", P, P),
	Delete: parent("delete", P, P),
	InlineCode: literal("inlineCode", P, { value: optStr }),
	Break: empty("break", P),
	Link: parent("link", P, P, { url: str, title: optStr }),
	Image: empty("image", P, { url: str, alt: optStr, title: optStr }),
};

export const isTypeName = (name) => /^[A-Z]/.test(name);

// Whether a parent of type takes a child of childType.
export const accepts = (type, childType) => {
	const { children } = SCHEMA[type];
	if (children === null) return false;
	return children.includes(childType) || SCHEMA[childType].is.some((c) => children.includes(c));
};
// Whether text can go straight in it: a Phrasing parent or a literal.
export const takesText = (type) => {
	const spec = SCHEMA[type];
	return spec.literal === true || (spec.children?.includes(PHRASING) ?? false);
};
export const describeChildren = (type) => {
	const { children } = SCHEMA[type];
	if (children === null) return "no children";
	return children.map((c) => (CATEGORIES.has(c) ? `${c} content` : c)).join(" or ");
};

const kindIssue = (scalar, value) => {
	switch (scalar.kind) {
		case "string":
			return typeof value === "string" ? null : "a string";
		case "number":
			return typeof value === "number" && Number.isFinite(value) ? null : "a number";
		case "boolean":
			return typeof value === "boolean" ? null : "a boolean";
		case "enum":
			return scalar.values.includes(value) ? null : `one of ${scalar.values.join(", ")}`;
		case "aligns":
			return Array.isArray(value) && value.every((a) => ALIGNS.includes(a))
				? null
				: "an array of left, right, center or null";
	}
};
// What's wrong with value as attr name of type, or null; undefined is a value left out.
export const scalarIssue = (type, name, value) => {
	const scalar = SCHEMA[type].scalars[name];
	const names = Object.keys(SCHEMA[type].scalars);
	if (scalar === undefined) {
		return `${type} has no attr ${name} (its attrs: ${names.length === 0 ? "none" : names.join(", ")})`;
	}
	if (value === undefined || value === null) {
		return scalar.optional ? null : `${type} needs attr ${name}`;
	}
	const expected = kindIssue(scalar, value);
	return expected === null ? null : `${type}.${name} is ${expected}, not ${JSON.stringify(value)}`;
};

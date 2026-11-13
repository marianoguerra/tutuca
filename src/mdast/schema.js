// The mdast node types a renders.md can use (https://github.com/syntax-tree/mdast, with GFM's
// delete, tables and task list items), as a table src/checked reads (its schema.js says how).
//
// mdast is simpler than ESTree: a node's only node field is children, so there are no slots. Its
// categories are Flow and Phrasing; in a Phrasing parent, text is a text node, adjacent text one
// node. Left out attrs are left out of the node too (a listItem without checked is not a task),
// but for spread, which is false (lower.js's DEFAULTS). Text, InlineCode, Code and Html are
// literals.
import { empty, literal, oneOf, opt, parent, Schema } from "../checked/schema.js";

export const FLOW = "Flow";
export const PHRASING = "Phrasing";

const str = { kind: "string" };
const optStr = opt("string");
const bool = opt("boolean");
const optNum = opt("number");
export const ALIGNS = ["left", "right", "center", null];
const aligns = opt("aligns");

const P = [PHRASING];
const F = [FLOW];

export const SCHEMA = {
	Root: parent("root", [], F),
	// Flow
	Paragraph: parent("paragraph", F, P),
	Heading: parent("heading", F, P, { depth: oneOf([1, 2, 3, 4, 5, 6], false) }),
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

export const MD = new Schema(SCHEMA, {
	name: "mdast",
	render: "md",
	categories: [FLOW, PHRASING],
	textIn: [PHRASING],
	kinds: {
		aligns: (v) =>
			Array.isArray(v) && v.every((a) => ALIGNS.includes(a))
				? null
				: "an array of left, right, center or null",
	},
});

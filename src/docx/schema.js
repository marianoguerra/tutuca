// What a renders.docx can say, as a table src/checked reads (its schema.js says how): a Word
// document's structure, which print.js makes with docx, as mdast is a markdown document's.
//
// A Document has Sections (pages of a size and orientation) of Blocks: Paragraph, Heading,
// Title, List (of ListItems and Lists, a level deeper), Code (a code block, its text
// monospaced), Table (of TableRows of TableCells, which hold Blocks and Inline content) and
// PageBreak. Inline content is text (a text node), Strong, Emphasis, Underline, Strike,
// InlineCode (monospaced), Span (color, size in points, font, highlight), Link and Break. Text
// in a parent of Inline content is a text node; a ListItem that says checked is a task, ☒ or ☐.
import { empty, literal, oneOf, opt, parent, req, Schema } from "../checked/schema.js";

export const BLOCK = "Block";
export const INLINE = "Inline";

export const ALIGNS = ["left", "center", "right", "justify"];
export const PAGE_SIZES = ["A4", "Letter"];
export const ORIENTATIONS = ["portrait", "landscape"];
// Word's highlight colors.
export const HIGHLIGHTS = ["yellow", "green", "cyan", "magenta", "blue", "red", "lightGray"];

const B = [BLOCK];
const I = [INLINE];

export const SCHEMA = {
	Document: parent("document", [], ["Section"], {
		title: opt("string"),
		creator: opt("string"),
		description: opt("string"),
	}),
	Section: parent("section", [], B, { size: oneOf(PAGE_SIZES), orientation: oneOf(ORIENTATIONS) }),
	// Blocks
	Paragraph: parent("paragraph", B, I, { align: oneOf(ALIGNS) }),
	Heading: parent("heading", B, I, { level: oneOf([1, 2, 3, 4, 5, 6], false) }),
	Title: parent("title", B, I),
	List: parent("list", B, ["ListItem", "List"], { ordered: opt("boolean") }),
	ListItem: parent("listItem", [], I, { checked: opt("boolean") }),
	Code: literal("code", B, { value: opt("string") }),
	Table: parent("table", B, ["TableRow"]),
	TableRow: parent("tableRow", [], ["TableCell"], { header: opt("boolean") }),
	TableCell: parent("tableCell", [], [BLOCK, INLINE], {
		fill: opt("color"),
		span: opt("positive"),
	}),
	PageBreak: empty("pageBreak", B),
	// Inline content
	Strong: parent("strong", I, I),
	Emphasis: parent("emphasis", I, I),
	Underline: parent("underline", I, I),
	Strike: parent("strike", I, I),
	InlineCode: literal("inlineCode", I, { value: opt("string") }),
	Span: parent("span", I, I, {
		color: opt("color"),
		size: opt("positive"),
		font: opt("string"),
		highlight: oneOf(HIGHLIGHTS),
	}),
	Link: parent("link", I, I, { url: req("string") }),
	Break: empty("break", I),
};

export const DOCX = new Schema(SCHEMA, {
	name: "docx",
	render: "docx",
	categories: [BLOCK, INLINE],
	textIn: [INLINE],
});

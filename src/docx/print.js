// A document (what a renders.docx renders to, lower.js's) as a .docx file, made with docx
// (vendored as deps/docx.js), in browsers and node alike.
//
// What the document doesn't say:
// - A Section or a Block at the root is put in a document, a Block in a section.
// - A section is A4 and portrait unless it says otherwise.
// - Inline content nests: a Strong in an Emphasis is bold and italic text. A newline in text is a
//   line break.
// - A List's items are bulleted, or numbered if it's ordered, each list counting from 1; a List
//   in a List is a level deeper. A checked ListItem starts with ☒, an unchecked one with ☐.
// - Code (a block and inline) is Courier New; a code block is a paragraph per line.
// - A TableCell's Inline content is a paragraph, as consecutive Inline content is between its
//   Blocks; a cell with nothing has an empty paragraph, as Word wants. A table is as wide as the
//   page, its header rows repeated on each page.
import {
	AlignmentType,
	Document,
	ExternalHyperlink,
	HeadingLevel,
	LevelFormat,
	Packer,
	PageBreak,
	PageOrientation,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from "../../deps/docx.js";
import { INLINE, SCHEMA } from "./schema.js";

const MONOSPACE = "Courier New";
const ORDERED = "tutuca-ordered";
// Twips (1/20 point), portrait.
const PAGE_SIZES = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };
const ALIGNMENT = {
	left: AlignmentType.LEFT,
	center: AlignmentType.CENTER,
	right: AlignmentType.RIGHT,
	justify: AlignmentType.JUSTIFIED,
};
const HEADINGS = [
	HeadingLevel.HEADING_1,
	HeadingLevel.HEADING_2,
	HeadingLevel.HEADING_3,
	HeadingLevel.HEADING_4,
	HeadingLevel.HEADING_5,
	HeadingLevel.HEADING_6,
];
const hex = (color) => {
	const h = color.slice(1);
	return (h.length === 3 ? [...h].map((c) => c + c).join("") : h).toUpperCase();
};
const isInline = (node) => node.type === "text" || inlineTypes.has(node.type);
const inlineTypes = new Set(
	Object.values(SCHEMA)
		.filter((spec) => spec.is.includes(INLINE))
		.map((spec) => spec.type),
);

// A run's formatting, from the Inline content it's in.
const STYLES = {
	strong: () => ({ bold: true }),
	emphasis: () => ({ italics: true }),
	underline: () => ({ underline: {} }),
	strike: () => ({ strike: true }),
	span: ({ color, size, font, highlight }) => ({
		...(color && { color: hex(color) }),
		...(size && { size: Math.round(size * 2) }), // half points
		...(font && { font }),
		...(highlight && { highlight }),
	}),
};
// The runs (and links) of Inline content, formatted by what it's in.
const runs = (children, style = {}) =>
	children.flatMap((node) => {
		if (node.type === "text" || node.type === "inlineCode") {
			const runStyle = node.type === "inlineCode" ? { ...style, font: MONOSPACE } : style;
			return node.value
				.split("\n")
				.map((text, i) => new TextRun({ ...runStyle, text, ...(i > 0 && { break: 1 }) }));
		}
		if (node.type === "break") return [new TextRun({ ...style, break: 1 })];
		if (node.type === "link") {
			return [
				new ExternalHyperlink({
					link: node.url,
					children: runs(node.children, { ...style, style: "Hyperlink" }),
				}),
			];
		}
		return runs(node.children, { ...style, ...STYLES[node.type](node) });
	});

// What the blocks of a document say, as docx's Paragraphs and Tables. lists counts the ordered
// lists, so each counts from 1.
const blocks = (nodes, lists) => {
	const out = [];
	let inline = [];
	const flush = () => {
		if (inline.length > 0) out.push(new Paragraph({ children: runs(inline) }));
		inline = [];
	};
	for (const node of nodes) {
		if (isInline(node)) inline.push(node);
		else {
			flush();
			out.push(...block(node, lists));
		}
	}
	flush();
	return out;
};
const listItems = (list, level, lists) => {
	const numbering = list.ordered ? { reference: ORDERED, level, instance: lists.next++ } : null;
	return list.children.flatMap((item) => {
		if (item.type === "list") return listItems(item, level + 1, lists);
		const box = item.checked === undefined ? [] : [new TextRun(item.checked ? "☒ " : "☐ ")];
		const children = [...box, ...runs(item.children)];
		return [new Paragraph(numbering ? { children, numbering } : { children, bullet: { level } })];
	});
};
const BLOCKS = {
	paragraph: (node) => [
		new Paragraph({ children: runs(node.children), alignment: ALIGNMENT[node.align] }),
	],
	heading: (node) => [
		new Paragraph({ heading: HEADINGS[node.level - 1], children: runs(node.children) }),
	],
	title: (node) => [new Paragraph({ heading: HeadingLevel.TITLE, children: runs(node.children) })],
	list: (node, lists) => listItems(node, 0, lists),
	code: (node) =>
		node.value.split("\n").map(
			(line) =>
				new Paragraph({
					children: [new TextRun({ text: line, font: MONOSPACE, size: 20 })],
					spacing: { before: 0, after: 0 },
					shading: { type: ShadingType.CLEAR, color: "auto", fill: "F4F4F5" },
				}),
		),
	pageBreak: () => [new Paragraph({ children: [new PageBreak()] })],
	table: (node, lists) => [
		new Table({
			width: { size: 100, type: WidthType.PERCENTAGE },
			rows: node.children.map(
				(row) =>
					new TableRow({
						tableHeader: row.header === true,
						children: row.children.map((cell) => {
							const children = blocks(cell.children, lists);
							return new TableCell({
								children: children.length > 0 ? children : [new Paragraph({})],
								...(cell.span && { columnSpan: Math.round(cell.span) }),
								...(cell.fill && {
									shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(cell.fill) },
								}),
							});
						}),
					}),
			),
		}),
	],
};
const block = (node, lists) => BLOCKS[node.type](node, lists);

// Numbered lists' levels: 1., then a., then i., ... indented a step each.
const FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
const NUMBERING = {
	config: [
		{
			reference: ORDERED,
			levels: Array.from({ length: 9 }, (_, level) => ({
				level,
				format: FORMATS[level % FORMATS.length],
				text: `%${level + 1}.`,
				alignment: AlignmentType.START,
				style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
			})),
		},
	],
};

const asDocument = (tree) => {
	if (tree.type === "document") return tree;
	if (tree.type === "section") return { type: "document", children: [tree] };
	return { type: "document", children: [{ type: "section", children: [tree] }] };
};
const section = (node, lists) => {
	const { width, height } = PAGE_SIZES[node.size ?? "A4"];
	const landscape = node.orientation === "landscape";
	return {
		properties: {
			page: {
				size: {
					width,
					height,
					orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
				},
			},
		},
		children: blocks(node.children, lists),
	};
};

// docx's Document of tree, a Document, a Section or a Block as lower makes them.
export const toDocxDocument = (tree) => {
	const doc = asDocument(tree);
	const lists = { next: 0 };
	return new Document({
		creator: doc.creator ?? "tutuca",
		...(doc.title !== undefined && { title: doc.title }),
		...(doc.description !== undefined && { description: doc.description }),
		numbering: NUMBERING,
		sections: doc.children.map((s) => section(s, lists)),
	});
};
// The bytes of tree's .docx file.
export const printDocx = async (tree) =>
	new Uint8Array(await Packer.toArrayBuffer(toDocxDocument(tree)));

// tutuca/docx: components whose renders.docx render Word documents, checked when the tags are
// built and when they render, and made into .docx files with docx.
import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import {
	DocxError,
	docx,
	docxTarget,
	printDocx,
	renderDocx,
	renderDocxTree,
	SCHEMA,
} from "../../src/docx/index.js";
import {
	$if,
	component,
	each,
	enableTargets,
	field,
	renderEach,
	Scope,
	t,
} from "../../src/tutuca.js";

enableTargets(docxTarget);

const { Break, Code, Document, Emphasis, Heading, InlineCode, Link, List, ListItem } = docx;
const { PageBreak, Paragraph, Section, Span, Strong, Table, TableCell, TableRow, Title } = docx;

const scope = (components) => {
	const s = new Scope();
	s.register(components);
	return s.components;
};
const fails = (fn, ...messages) => {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof DocxError, error);
		assert.deepEqual(error.issues, messages);
		return true;
	});
};
// The .docx's document.xml, which holds its text.
const documentXml = (bytes) => new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
const ENTITIES = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" };
const texts = (xml) =>
	[...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) =>
		m[1].replace(/&(\w+);/g, (_, name) => ENTITIES[name]),
	);

const Todo = component({
	name: "Todo",
	fields: { items: t.array(t.record({ title: t.string(), done: t.boolean() })) },
	renders: {
		docx: Section(
			Heading({ level: 2 }, "Todo"),
			List(each(field("items"), ListItem({ checked: field("done") }, field("title")))),
		),
	},
});

test("a renders.docx renders its fields into the document it says, text as text nodes", () => {
	assert.deepEqual(renderDocxTree(Todo.make({ items: [{ title: "Buy ", done: true }] })), {
		type: "section",
		children: [
			{ type: "heading", level: 2, children: [{ type: "text", value: "Todo" }] },
			{
				type: "list",
				children: [
					{ type: "listItem", checked: true, children: [{ type: "text", value: "Buy " }] },
				],
			},
		],
	});
});

test("it's a .docx: a zip with Word's document, its text where it's said", async () => {
	const bytes = await renderDocx(
		Todo.make({
			items: [
				{ title: "Buy milk", done: true },
				{ title: "Call", done: false },
			],
		}),
	);
	assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]); // PK
	const files = Object.keys(unzipSync(bytes));
	assert.ok(files.includes("[Content_Types].xml") && files.includes("word/numbering.xml"));
	const xml = documentXml(bytes);
	assert.deepEqual(texts(xml), ["Todo", "☒ ", "Buy milk", "☐ ", "Call"]);
	assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
});

test("inline content nests its formatting, and newlines and Breaks break lines", async () => {
	const xml = documentXml(
		await printDocx(
			renderDocxTree(
				component({
					name: "Inline",
					renders: {
						docx: Paragraph(
							{ align: "center" },
							Strong("b ", Emphasis("bi")),
							Span({ color: "#c00", size: 14, highlight: "yellow" }, "red"),
							Break(),
							Link({ url: "https://example.com" }, "link"),
							InlineCode("f()"),
							"one\ntwo",
						),
					},
				}).make(),
			),
		),
	);
	assert.match(xml, /<w:jc w:val="center"\/>/);
	assert.match(xml, /<w:b\/>.*<w:t[^>]*>b <\/w:t>/s);
	assert.match(xml, /<w:b\/><w:bCs\/><w:i\/><w:iCs\/>.*?<w:t[^>]*>bi<\/w:t>/s);
	assert.match(xml, /<w:color w:val="CC0000"\/><w:sz w:val="28"\/>/);
	assert.match(xml, /<w:highlight w:val="yellow"\/>/);
	assert.match(xml, /<w:hyperlink [^>]*>.*<w:t[^>]*>link<\/w:t>/s);
	assert.match(xml, /<w:rFonts w:ascii="Courier New"[^>]*\/>.*<w:t[^>]*>f\(\)<\/w:t>/s);
	assert.match(xml, /<w:t[^>]*>one<\/w:t>.*<w:br\/><w:t[^>]*>two<\/w:t>/s);
	assert.equal((xml.match(/<w:br\/>/g) ?? []).length, 2);
});

test("ordered lists each count from 1, a nested one a level deeper; bullets aren't numbered", async () => {
	const xml = documentXml(
		await printDocx({
			type: "section",
			children: [
				{
					type: "list",
					ordered: true,
					children: [
						{ type: "listItem", children: [{ type: "text", value: "a" }] },
						{
							type: "list",
							ordered: true,
							children: [{ type: "listItem", children: [{ type: "text", value: "a.1" }] }],
						},
					],
				},
				{ type: "list", ordered: true, children: [{ type: "listItem", children: [] }] },
			],
		}),
	);
	const numbered = [...xml.matchAll(/<w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/>/g)].map(
		(m) => [Number(m[1]), m[2]],
	);
	assert.equal(numbered.length, 3);
	assert.deepEqual(
		numbered.map(([level]) => level),
		[0, 1, 0],
	);
	// Three lists, three numberings.
	assert.equal(new Set(numbered.map(([, id]) => id)).size, 3);
});

test("tables, code blocks, page breaks and sections print as Word has them", async () => {
	const tree = renderDocxTree(
		component({
			name: "Doc",
			renders: {
				docx: Document(
					{ title: "Doc" },
					Section(
						Title("T"),
						Code('{\n  "a": 1\n}'),
						Table(
							TableRow({ header: true }, TableCell({ fill: "#eee" }, Strong("Name")), TableCell()),
							TableRow(TableCell({ span: 2 }, "x", Paragraph("y"))),
						),
						PageBreak(),
					),
					Section({ size: "Letter", orientation: "landscape" }, Paragraph("L")),
				),
			},
		}).make(),
	);
	const bytes = await printDocx(tree);
	const xml = documentXml(bytes);
	assert.match(xml, /<w:pStyle w:val="Title"\/>/);
	assert.deepEqual(texts(xml), ["T", "{", '  "a": 1', "}", "Name", "x", "y", "L"]);
	assert.match(xml, /<w:tblHeader\/>/);
	assert.match(xml, /<w:shd w:fill="EEEEEE"/);
	assert.match(xml, /<w:gridSpan w:val="2"\/>/);
	// An empty cell still has its paragraph.
	assert.match(xml, /<w:tc>(?:(?!<\/w:tc>).)*<w:p\/>(?:(?!<\/w:tc>).)*<\/w:tc>/s);
	assert.match(xml, /<w:br w:type="page"\/>/);
	assert.match(xml, /<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"\/>/);
	assert.match(xml, /<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"\/>/);
	const core = new TextDecoder().decode(unzipSync(bytes)["docProps/core.xml"]);
	assert.match(core, /<dc:title>Doc<\/dc:title>/);
	assert.match(core, /<dc:creator>tutuca<\/dc:creator>/);
});

test("tags are checked when they're built", () => {
	fails(() => docx.Bold("x"), `unknown docx type Bold (one of ${Object.keys(SCHEMA).join(", ")})`);
	fails(() => Heading("x"), "Heading needs attr level");
	fails(() => Heading({ level: 7 }), "Heading.level is one of 1, 2, 3, 4, 5, 6, not 7");
	fails(() => Section("loose"), 'Section can\'t hold text ("loose")');
	fails(() => Paragraph(Paragraph()), "Paragraph takes Inline content, not Paragraph");
	fails(() => List(Paragraph()), "List takes ListItem or List, not Paragraph");
	fails(() => Span({ color: "red" }), 'Span.color is a color, #rgb or #rrggbb, not "red"');
	fails(() => Link("x"), "Link needs attr url");
	fails(() => Code(Strong("x")), "Code holds text, not Strong");
	// Text and Blocks in a cell are fine.
	assert.ok(TableCell("a", Paragraph("b"), Strong("c")));
});

test("the document is checked when it renders, each issue at its path", () => {
	const Bad = component({
		name: "Bad",
		fields: { level: t.number(), url: t.string() },
		renders: {
			docx: Section(
				Heading({ level: field("level") }, "x"),
				Paragraph(Link({ url: $if(field("url"), field("url"), null) })),
			),
		},
	});
	fails(
		() => renderDocxTree(Bad.make({ level: 9, url: "" })),
		"Section.children[0]: Heading.level is one of 1, 2, 3, 4, 5, 6, not 9",
		"Section.children[1].children[0]: Link needs attr url",
	);
	const Inline = component({ name: "Inline", renders: { docx: Strong("x") } });
	fails(
		() => renderDocxTree(Inline.make()),
		"a docx render renders a Document, a Section or a Block, not Strong",
	);
});

test("a component renders its children's renders.docx where it puts them", () => {
	const Line = component({
		name: "Line",
		fields: { name: t.string(), qty: t.number() },
		renders: { docx: TableRow(TableCell(field("name")), TableCell(field("qty"))) },
	});
	const Cart = component({
		name: "Cart",
		fields: { lines: t.array(t.component("Line")) },
		renders: {
			docx: Table(
				TableRow({ header: true }, TableCell("Name"), TableCell("Qty")),
				renderEach(field("lines")),
			),
		},
	});
	const C = scope({ Line, Cart });
	const tree = renderDocxTree(C.Cart({ lines: [C.Line({ name: "Milk", qty: 2 })] }));
	assert.deepEqual(
		tree.children[1].children.map((cell) => cell.children[0].value),
		["Milk", "2"],
	);
});

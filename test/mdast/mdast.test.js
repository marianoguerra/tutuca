// tutuca/mdast: components whose renders.md render mdast trees, checked when the tags are built
// and when they render, and printed as markdown.
import assert from "node:assert/strict";
import test from "node:test";
import { MdAstError, md, mdTarget, renderMd, renderMdAst } from "../../src/mdast/index.js";
import {
	$if,
	component,
	each,
	enableTargets,
	field,
	pushView,
	render,
	renderEach,
	Scope,
	t,
} from "../../src/tutuca.js";

enableTargets(mdTarget);

const {
	Blockquote,
	Break,
	Code,
	Delete,
	Emphasis,
	Heading,
	Image,
	InlineCode,
	Link,
	List,
	ListItem,
	Paragraph,
	Root,
	Strong,
	Table,
	TableCell,
	TableRow,
	Text,
	ThematicBreak,
} = md;

const scope = (components) => {
	const s = new Scope();
	s.register(components);
	return s.components;
};
const fails = (fn, ...messages) => {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof MdAstError, error);
		assert.deepEqual(error.issues, messages);
		return true;
	});
};

const Todo = component({
	name: "Todo",
	fields: { items: t.array(t.record({ title: t.string(), done: t.boolean() })) },
	renders: {
		md: Root(
			Heading({ depth: 2 }, "Todo"),
			List(each(field("items"), ListItem({ checked: field("done") }, Paragraph(field("title"))))),
		),
	},
});

test("a renders.md renders its fields into the mdast it says, text joined into text nodes", () => {
	const tree = renderMdAst(Todo.make({ items: [{ title: "Buy ", done: true }] }));
	assert.deepEqual(tree, {
		type: "root",
		children: [
			{ type: "heading", depth: 2, children: [{ type: "text", value: "Todo" }] },
			{
				type: "list",
				spread: false,
				children: [
					{
						type: "listItem",
						checked: true,
						spread: false,
						children: [{ type: "paragraph", children: [{ type: "text", value: "Buy " }] }],
					},
				],
			},
		],
	});
	const Joined = component({
		name: "Joined",
		fields: { n: t.number(3) },
		renders: { md: Paragraph("Count: ", field("n"), "!") },
	});
	assert.deepEqual(renderMdAst(Joined.make()).children, [{ type: "text", value: "Count: 3!" }]);
});

test("renderMd prints GFM, escaping text that would read as markdown", () => {
	const items = [
		{ title: "Read *the* guide", done: true },
		{ title: "Edit [this]", done: false },
	];
	assert.equal(
		renderMd(Todo.make({ items })),
		"## Todo\n\n- [x] Read \\*the\\* guide\n- [ ] Edit \\[this]\n",
	);
	const Doc = component({
		name: "Doc",
		fields: {},
		renders: {
			md: Root(
				Paragraph(
					Emphasis("a"),
					" ",
					Strong("b"),
					" ",
					Delete("c"),
					" ",
					InlineCode("d"),
					Break(),
					Link({ url: "https://x.y" }, "e"),
				),
				Blockquote(Paragraph("quoted")),
				Code({ lang: "js" }, "let x = 1;"),
				ThematicBreak(),
				Paragraph(Image({ url: "a.png", alt: "pic" }), Text({ value: " end" })),
				Table(
					{ align: ["left", null] },
					TableRow(TableCell("h1"), TableCell("h2")),
					TableRow(TableCell("1"), TableCell("2")),
				),
			),
		},
	});
	assert.equal(
		renderMd(Doc.make()),
		[
			"_a_ **b** ~~c~~ `d`\\",
			"[e](https://x.y)",
			"",
			"> quoted",
			"",
			"```js",
			"let x = 1;",
			"```",
			"",
			"***",
			"",
			"![pic](a.png) end",
			"",
			"| h1 | h2 |",
			"| :- | -- |",
			"| 1  | 2  |",
			"",
		].join("\n"),
	);
});

test("what a view says is checked when the tags are built", () => {
	assert.throws(
		() => md.Title("x"),
		/^MdAstError: unknown mdast type Title \(one of Root, Paragraph, /,
	);
	fails(() => Heading("x"), "Heading needs attr depth");
	fails(() => Heading({ depth: 7 }, "x"), "Heading.depth is one of 1, 2, 3, 4, 5, 6, not 7");
	fails(() => Paragraph({ deep: true }), "Paragraph has no attr deep (its attrs: none)");
	fails(() => Root("loose text"), 'Root can\'t hold text ("loose text")');
	fails(() => List(Paragraph("x")), "List takes ListItem, not Paragraph");
	fails(
		() => Paragraph(Heading({ depth: 1 }, "x")),
		"Paragraph takes Phrasing content, not Heading",
	);
	fails(() => ThematicBreak("x"), "ThematicBreak takes no children");
	fails(() => InlineCode(Strong("x")), "InlineCode holds text, not Strong");
	fails(() => Link("x"), "Link needs attr url");
	// A computed attr is checked when it renders, and both branches of an $if now.
	assert.doesNotThrow(() => Heading({ depth: field("d") }, "x"));
	fails(() => List($if(field("x"), ListItem(), Paragraph())), "List takes ListItem, not Paragraph");
});

test("the rendered tree is checked, every issue at its mdast path", () => {
	const Bad = component({
		name: "Bad",
		fields: { depth: t.any(9), url: t.any(null), done: t.any("yes") },
		renders: {
			md: Root(
				Heading({ depth: field("depth") }, "x"),
				Paragraph(Link({ url: field("url") }, "y")),
				List(ListItem({ checked: field("done") })),
			),
		},
	});
	fails(
		() => renderMdAst(Bad.make()),
		"Root.children[0]: Heading.depth is one of 1, 2, 3, 4, 5, 6, not 9",
		"Root.children[1].children[0]: Link needs attr url",
		'Root.children[2].children[0]: ListItem.checked is a boolean, not "yes"',
	);
	const Two = component({
		name: "Two",
		fields: { xs: t.array(t.number()).default([1, 2]) },
		renders: { md: each(field("xs"), Paragraph("x")) },
	});
	fails(() => renderMdAst(Two.make()), "a md render renders one node, this one rendered 2");
});

test("render and renderEach put child components' renders.md among the children, by view name too", () => {
	const Item = component({
		name: "Item",
		fields: { title: t.string(), done: t.boolean() },
		renders: {
			md: {
				main: ListItem({ checked: field("done") }, Paragraph(field("title"))),
				plain: ListItem(Paragraph(field("title"))),
			},
		},
	});
	const Page = component({
		name: "Page",
		fields: {
			items: t.array(t.component("Item")),
			top: t.component("Item"),
			style: t.string("main"),
		},
		renders: {
			md: Root(
				List(render(field("top"), "plain")),
				List(pushView(field("style"), renderEach(field("items")))),
			),
		},
	});
	const C = scope({ Item, Page });
	const page = (style) =>
		C.Page({
			style,
			top: C.Item({ title: "top" }),
			items: [C.Item({ title: "a", done: true }), C.Item({ title: "b" })],
		});
	// Two lists in a row: the printer switches bullets, so they stay two.
	assert.equal(renderMd(page("main")), "- top\n\n* [x] a\n* [ ] b\n");
	assert.equal(renderMd(page("plain")), "- top\n\n* a\n* b\n");
});

test("component() wants a main md view; a component without renders.md can't render", () => {
	assert.throws(
		() => component({ name: "X", renders: { md: { other: Paragraph("x") } } }),
		/X renders md views but no main one/,
	);
	const Plain = component({ name: "Plain" });
	assert.throws(() => renderMd(Plain.make()), /Plain has no md render/);
});

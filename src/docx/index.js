// tutuca/docx (experimental): components that render Word documents. A component's
// renders.docx (one tree, or views by name with a main) says what it is as a document, as its
// view (and views) say what it renders on a page; renderDocxTree renders it and renderDocx makes
// the .docx file's bytes with docx (https://docx.js.org), in browsers and node alike.
//
// Rendering Word documents is opt in: enableTargets(docxTarget) before component() takes a
// renders.docx. A module that only declares components imports docxTarget and docx from
// tutuca/docx/target, which leaves out the renderer and docx.
//
// Tags are a document's structure, as md's are markdown's: Document > Section > Blocks
// (Paragraph, Heading, Title, List, Code, Table, PageBreak) > Inline content (text, Strong,
// Emphasis, Underline, Strike, InlineCode, Span, Link, Break). field, $if, each, render and
// pushView work as in views, so a component renders its child components' renders.docx where it
// puts them.
//
//   enableTargets(docxTarget);
//   const { Section, Heading, List, ListItem } = docx;
//   const TodoList = component({
//     name: "TodoList",
//     fields: { items: t.array(t.record({ title: t.string(), done: t.boolean() })) },
//     renders: {
//       docx: Section(
//         Heading({ level: 1 }, "Todo"),
//         List(each(field("items"), ListItem({ checked: field("done") }, field("title")))),
//       ),
//     },
//   });
//   const bytes = await renderDocx(TodoList.make({ items: [{ title: "Buy milk", done: false }] }));
//   new Blob([bytes], { type: DOCX_MIME })
//
// What's checked, against one table (schema.js): what a view says, when it's built (tags.js),
// and the document it renders to, when it renders (lower.js, every node, with the path to it).
// Both throw a DocxError.
export { lower } from "./lower.js";
export { printDocx, toDocxDocument } from "./print.js";
export { renderDocx, renderDocxTree } from "./render.js";
export { ALIGNS, BLOCK, HIGHLIGHTS, INLINE, ORIENTATIONS, PAGE_SIZES, SCHEMA } from "./schema.js";
export { DocxError, docx, docxTarget } from "./target.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

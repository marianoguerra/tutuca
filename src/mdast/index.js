// tutuca/mdast (experimental): components that render markdown. A component's renders.md (one
// tree, or views by name with a main) says what it renders as an mdast tree
// (https://github.com/syntax-tree/mdast, with GFM), as its view (and views) say what it renders
// on a page; renderMdAst renders it, renderMd prints it (mdast-util-to-markdown, as renderJs
// prints a renders.js with astring).
//
// Rendering markdown is opt in: enableTargets(mdTarget) before component() takes a renders.md.
// A module that only declares components imports mdTarget and md from tutuca/mdast/target, which
// leaves out the renderer and its printer.
//
// Tags are mdast, almost one to one: a PascalCase tag is a node of that type (Heading is
// heading) and its attrs are the node's fields; its children are the node's children. Text in a
// Phrasing parent (Paragraph, Heading, Strong, Link, ...) is a text node. field, $if, each,
// render and pushView work as in views, so a component renders its child components' renders.md
// among its children.
//
//   enableTargets(mdTarget);
//   const { Root, Heading, List, ListItem, Paragraph } = md;
//   const TodoList = component({
//     name: "TodoList",
//     fields: { items: t.array(t.record({ title: t.string(), done: t.boolean() })) },
//     renders: {
//       md: Root(
//         Heading({ depth: 2 }, "Todo"),
//         List(each(field("items"), ListItem({ checked: field("done") }, Paragraph(field("title"))))),
//       ),
//     },
//   });
//   renderMd(TodoList.make({ items: [{ title: "Buy milk", done: false }] }))
//   // "## Todo\n\n- [ ] Buy milk\n"
//
// What's checked, against one table (schema.js): what a view says, when it's built (tags.js),
// and the tree it renders to, when it renders (lower.js, every node, with the path to it). Both
// throw an MdAstError.
export { lower } from "./lower.js";
export { printMd, renderMd, renderMdAst } from "./render.js";
export { ALIGNS, FLOW, PHRASING, SCHEMA } from "./schema.js";
export { MdAstError, md, mdTarget } from "./target.js";

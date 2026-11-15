// Rendering a component's renders.md: a RenderContext whose target is mdTarget, so render,
// renderEach, renderIt and pushView pick the renders.md of the components they reach, and a
// component without one fails to render.
//
// What a renders.md renders to, lowered to the mdast it says and checked, as src/checked/lower.js
// does it: every issue at the path of the node it's in (Root.children[1].children[0]), thrown as
// one MdAstError.
import {
	gfmStrikethroughToMarkdown,
	gfmTableToMarkdown,
	gfmTaskListItemToMarkdown,
	toMarkdown,
} from "../../deps/mdast.js";
import { checkedLower } from "../checked/lower.js";
import { renderedVNodes } from "../checked/render.js";
import { MD } from "./schema.js";
import { MdAstError, mdTarget } from "./target.js";

// What a tag may leave out that the printer reads as something else: a list or item without
// spread is printed loose, a blank line between its items.
const DEFAULTS = { List: { spread: false }, ListItem: { spread: false } };

// The mdast the vnodes a renders.md rendered say: exactly one node.
const lower = checkedLower(MD, MdAstError, { defaults: DEFAULTS });
// The mdast instance's renders.md (view, or main) renders to; throws an MdAstError listing what
// isn't valid mdast.
export const renderMdAst = (instance, { view } = {}) =>
	lower(renderedVNodes(instance, mdTarget, view));
// The markdown text of an mdast tree, printed by mdast-util-to-markdown with GFM (task lists,
// tables, strikethrough). Text is escaped where markdown would read it as syntax.
export const printMd = (tree, { bullet = "-", emphasis = "_" } = {}) =>
	toMarkdown(tree, {
		bullet,
		emphasis,
		extensions: [gfmStrikethroughToMarkdown(), gfmTableToMarkdown(), gfmTaskListItemToMarkdown()],
	});
// The markdown text of what instance renders.
export const renderMd = (instance, { view, bullet, emphasis } = {}) =>
	printMd(renderMdAst(instance, { view }), { bullet, emphasis });

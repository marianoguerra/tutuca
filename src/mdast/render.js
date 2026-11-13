// Rendering a component's renders.md: a RenderContext whose target is mdTarget, so render,
// renderEach, renderIt and pushView pick the renders.md of the components they reach, and a
// component without one fails to render.
import {
	gfmStrikethroughToMarkdown,
	gfmTableToMarkdown,
	gfmTaskListItemToMarkdown,
	toMarkdown,
} from "../../deps/mdast.js";
import { RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";
import { lower } from "./lower.js";
import { mdTarget } from "./target.js";

// The mdast instance's renders.md (view, or main) renders to; throws an MdAstError listing what
// isn't valid mdast.
export const renderMdAst = (instance, { view } = {}) => {
	const ctx = RenderContext.root(instance, { target: mdTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return lower(toVChildren(node.eval(ctx.with({ component: instance }))));
};
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

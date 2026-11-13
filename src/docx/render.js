// Rendering a component's renders.docx: a RenderContext whose target is docxTarget, so render,
// renderEach, renderIt and pushView pick the renders.docx of the components they reach, and a
// component without one fails to render.
import { RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";
import { lower } from "./lower.js";
import { printDocx } from "./print.js";
import { docxTarget } from "./target.js";

// The document instance's renders.docx (view, or main) renders to; throws a DocxError listing
// what isn't a valid one.
export const renderDocxTree = (instance, { view } = {}) => {
	const ctx = RenderContext.root(instance, { target: docxTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return lower(toVChildren(node.eval(ctx.with({ component: instance }))));
};
// The bytes of the .docx file of what instance renders.
export const renderDocx = (instance, { view } = {}) =>
	printDocx(renderDocxTree(instance, { view }));

// Rendering a component's renders.js: a RenderContext whose target is jsTarget, so render,
// renderEach, renderIt and pushView pick the renders.js of the components they reach, and a
// component without one fails to render.
import { generate } from "../../deps/astring.js";
import { RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";
import { lower } from "./lower.js";
import { jsTarget } from "./target.js";

// The ESTree instance's renders.js (view, or main) renders to; throws a JsAstError listing what
// isn't valid ESTree.
export const renderJsAst = (instance, { view } = {}) => {
	const ctx = RenderContext.root(instance, { target: jsTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return lower(toVChildren(node.eval(ctx.with({ component: instance }))));
};
// The JavaScript source of what instance renders, printed by astring.
export const renderJs = (instance, { view, indent = "  ", lineEnd = "\n" } = {}) =>
	generate(renderJsAst(instance, { view }), { indent, lineEnd });

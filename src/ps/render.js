// Rendering a component's renders.ps: a RenderContext whose target is psTarget, so render,
// renderEach, renderIt and pushView pick the renders.ps of the components they reach, and a
// component without one fails to render.
import { RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";
import { lower } from "./lower.js";
import { printPs } from "./print.js";
import { psTarget } from "./target.js";

// The drawing instance's renders.ps (view, or main) renders to; throws a PsError listing what
// isn't a valid drawing.
export const renderPsTree = (instance, { view } = {}) => {
	const ctx = RenderContext.root(instance, { target: psTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return lower(toVChildren(node.eval(ctx.with({ component: instance }))));
};
// The PostScript program that draws what instance renders.
export const renderPs = (instance, { view } = {}) => printPs(renderPsTree(instance, { view }));

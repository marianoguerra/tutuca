// What a target's render of a component is before it's lowered: the vnodes of the view it has
// for that target, rendered without a cache. render, renderEach, renderIt and pushView pick the
// same target's renders of the components they reach, and one without any fails to render
// (unless the target falls back to views).
import { RenderContext, specOf } from "../tutuca.js";
import { toVChildren } from "../vdom/index.js";

// The vnodes instance's render for renderTarget (view, or main) renders.
export const renderedVNodes = (instance, renderTarget, view) => {
	const ctx = RenderContext.root(instance, { renderTarget });
	const node = ctx.getBestViewFor(specOf(instance), view);
	return toVChildren(node.eval(ctx.with({ component: instance })));
};

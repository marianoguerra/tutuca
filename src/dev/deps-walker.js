// DepsWalker: the provided values a component's subtree reads, found by walking only what steers
// its render (conds, loops, components) and what reads a provided value, without rendering.
// Dev mode checks the deps the render cache recorded against it (render-cache.js); it's also
// the first pass of a two-pass cache, which scripts/bench-render.js measures.
import { specOf } from "../core/model/spec.js";
import { mergeDeps, ownDeps, viewFacts } from "../core/view/render-cache.js";
import { loopEntries, loopOf, RenderContext } from "../core/view/view.js";
import { Walker } from "../core/view/walk.js";

// The provided entries the subtree of instance, rendered in ctx with viewName, reads, as pairs,
// found without rendering: it evaluates only what picks a branch, an item or a component and
// what reads a provided value. onComponent(instance, view, ctx, deps) is called for every
// component it enters, with that component's own deps (as renderView records them).
export class DepsWalker extends Walker {
	constructor(onComponent = () => {}) {
		super();
		this.onComponent = onComponent;
		this.ctx = null;
	}
	static depsOf(root, { target = null, onComponent } = {}) {
		const walker = new DepsWalker(onComponent);
		const ctx = RenderContext.root(root, { target });
		return walker.component(root, ctx.with({ deps: [] }), undefined);
	}
	// Enters a component as renderView does, collecting its subtree's deps into the parent's.
	component(instance, ctx, viewName) {
		const spec = specOf(instance);
		const view = ctx.getBestViewFor(spec, viewName);
		const deps = [];
		this.walkIn(ctx.with({ component: instance, deps }), view);
		const own = ownDeps(spec, deps);
		this.onComponent(instance, view, ctx, own);
		mergeDeps(ctx, own);
		return own;
	}
	walkIn(ctx, node) {
		const prev = this.ctx;
		this.ctx = ctx;
		try {
			this.visit(node);
		} finally {
			this.ctx = prev;
		}
	}
	visit(node) {
		const { readsProvided, rendersChildren } = viewFacts(node);
		if (readsProvided || rendersChildren) node.accept(this);
	}
	// A node this walker doesn't know the shape of, or an expression: evaluated, which records
	// what it reads (and renders, uncached, the components inside: renderView collects their
	// deps when ctx.deps is set).
	node(node) {
		node.eval(this.ctx);
	}
	element(node) {
		for (const [, value] of node.attrs) this.visit(value);
		for (const c of node.children) this.visit(c);
	}
	cond(node) {
		this.visit(node.branch(this.ctx)); // branch evaluates the test, recording what it reads.
	}
	render(node) {
		const child = node.source.eval(this.ctx);
		this.component(child, this.ctx.enterFrame(child), node.viewName);
	}
	renderIt(node) {
		const it = this.ctx.lookupBind("value");
		this.component(it, this.ctx.forItemView(it), node.viewName);
	}
	each(node) {
		const { ctx } = this;
		const loop = loopOf(ctx, node.loopName);
		for (const { value, binds } of loopEntries(ctx, node.source, loop)) {
			const itemCtx = ctx.enterFrame(value, binds);
			if (node.child === undefined) this.component(value, itemCtx.forItemView(value), loop.view);
			else this.walkIn(itemCtx, node.child);
		}
	}
	renderEach(node) {
		this.each(node); // A RenderEachNode has no child: each item is a component.
	}
	withBinds(node) {
		const { ctx } = this;
		const { value: _value, ...binds } = ctx.spec.binds[node.bindsName].call(ctx.component);
		this.walkIn(ctx.addBinds(binds), node.child);
	}
	pushView(node) {
		const { ctx } = this;
		this.walkIn(ctx.pushView(node.source.eval(ctx)), node.child);
	}
}

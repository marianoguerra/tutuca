// What the dev walkers of a render share (DepsWalker, the path tree): they go through a view as
// the renderer does, in the RenderContext it would have there (this.ctx), without rendering.
// This is the part that only steers: an element's attrs and children, the branch a cond takes,
// the binds and the view a withBinds and a pushView put in reach. A subclass says what a node it
// doesn't know (node), a component (render, renderIt) and a loop (each) are to it.
import { Walker } from "../core/view/walk.js";

export class RenderWalker extends Walker {
	ctx = null;
	// What fn returns, run with ctx as the walker's.
	withCtx(ctx, fn) {
		const prev = this.ctx;
		this.ctx = ctx;
		try {
			return fn();
		} finally {
			this.ctx = prev;
		}
	}
	element(node) {
		for (const [, value] of node.attrs) this.visit(value);
		for (const c of node.children) this.visit(c);
	}
	cond(node) {
		this.visit(node.branch(this.ctx)); // branch evaluates the test, recording what it reads.
	}
	renderEach(node) {
		this.each(node); // A RenderEachNode has no child: each item is a component.
	}
	withBinds(node) {
		const { ctx } = this;
		const { value: _value, ...binds } = ctx.spec.binds[node.bindsName].call(ctx.component);
		this.withCtx(ctx.addBinds(binds), () => this.visit(node.child));
	}
	pushView(node) {
		const { ctx } = this;
		this.withCtx(ctx.pushView(node.source.eval(ctx)), () => this.visit(node.child));
	}
}

// The path tree: the steps a render takes from the root, found without rendering. Each step
// renders a field, a seq item, a provided value, a loop's items or the loop's item itself. The
// steps on a focus path are active and walked into; the steps they don't take are listed,
// inactive, and left unwalked until expand() walks one. It walks the same frames the renderer
// opens (view.js: RenderNode, loopFragments, renderEachItem, RenderItNode), so a step's path
// is the DispatchPath an event in what it renders dispatches through.
import { isComponent, specOf } from "../core/model/spec.js";
import { viewFacts } from "../core/view/render-cache.js";
import { loopEntries, loopOf, RenderContext } from "../core/view/view.js";
import { Walker } from "../core/view/walk.js";
import { DispatchPath } from "../tree/index.js";

// What a render or loop source is, as a step: { t: "field", name }, { t: "seqItem", name,
// keyName, key } or { t: "provided", name, up, keys }, up being how many frames above the
// provider is; { t: "expr", kind } for a source that opens no frame of its own.
const sourceStep = (source, ctx) => {
	switch (source.constructor.kind) {
		case "field":
			return { t: "field", name: source.name };
		case "seqItem":
			return {
				t: "seqItem",
				name: source.seqName,
				keyName: source.keyName,
				key: ctx.it[source.keyName],
			};
		case "provided": {
			const entry = ctx.provided[source.name];
			if (entry === undefined) return { t: "provided", name: source.name, up: null, keys: [] };
			return { t: "provided", name: source.name, up: ctx.depth - entry.depth, keys: entry.keys };
		}
		default:
			return { t: "expr", kind: source.constructor.kind };
	}
};
const sizeOf = (items) =>
	items == null ? 0 : Array.isArray(items) ? items.length : Object.keys(items).length;
// The name of the view getBestViewFor picks.
const viewNameOf = (ctx, spec, viewName) => {
	const views = spec.viewsFor(ctx.target) ?? spec.views;
	const candidates = viewName === undefined ? ctx.viewStack : [viewName, ...ctx.viewStack];
	return candidates.find((name) => views[name] !== undefined) ?? "main";
};
// Each frame as it is when a component is entered under it: a node frame.
const asNodePath = (path) =>
	path.isRootPath ? path : path.toParentPath().concat([path.frames.at(-1).asNode()]);

// How to walk an unwalked step later: a function that fills its children.
const LATER = new WeakMap();

// A step: { step, path, spec, view, instance, missing, active, last, children, more }.
// spec and view are names, null for a step that isn't a component (a loop, or an item of a
// loop whose items aren't components); missing is set when a render's source is no component.
// children is null for a step not walked into (inactive), [] for one with no steps below.
const makeStep = (step, path) => ({
	step,
	path,
	spec: null,
	view: null,
	instance: null,
	missing: false,
	active: true,
	last: false,
	children: [],
	hasChildren: false,
});

export class PathTreeWalker extends Walker {
	// path: the focus DispatchPath, null for none (every step active); siblings: how many
	// items of a loop it lists before the ones off the path collapse into a { t: "more" } step.
	constructor({ path = null, siblings = 8 } = {}) {
		super();
		this.path = path;
		this.siblings = siblings;
		this.ctx = null;
		this.parent = null; // The step whose children the steps found go in.
	}
	// The root's step, its tree below it as far as the focus path goes.
	static tree(root, { path = null, target = null, siblings = 8 } = {}) {
		const walker = new PathTreeWalker({ path, siblings });
		const step = makeStep({ t: "root" }, new DispatchPath());
		walker.enter(step, root, RenderContext.root(root, { target }), undefined);
		return step;
	}
	onPath(path) {
		return this.path === null || this.path.startsWith(path);
	}
	// Enters instance as renderView does, as step; walks its view if step is active.
	enter(step, instance, ctx, viewName) {
		if (!isComponent(instance)) {
			step.missing = true;
			step.children = null;
			return;
		}
		const spec = specOf(instance);
		const view = ctx.getBestViewFor(spec, viewName);
		step.spec = spec.name;
		step.view = viewNameOf(ctx, spec, viewName);
		step.instance = instance;
		step.hasChildren = viewFacts(view).rendersChildren;
		this.walkStep(step, ctx.with({ component: instance }), view);
	}
	// Walks node in ctx into step's children, now if step is active or later, by expand().
	walkStep(step, ctx, node) {
		step.active = this.onPath(step.path);
		if (step.active) this.walkInto(step, ctx, node);
		else {
			step.children = null;
			step.hasChildren = viewFacts(node).rendersChildren;
			LATER.set(step, () => this.walkInto(step, ctx, node));
		}
	}
	walkInto(step, ctx, node) {
		this.fill(step, ctx, () => this.visit(node));
		step.last =
			step.active &&
			this.path !== null &&
			step.path.frames.length === this.path.frames.length &&
			!step.children.some((c) => c.last);
	}
	// Runs walk with ctx, adding the steps it finds to step's children.
	fill(step, ctx, walk) {
		const { ctx: prevCtx, parent: prevParent } = this;
		this.ctx = ctx;
		this.parent = step;
		step.children = [];
		try {
			walk();
		} finally {
			this.ctx = prevCtx;
			this.parent = prevParent;
		}
		step.hasChildren = step.children.length > 0;
	}
	add(step) {
		this.parent.children.push(step);
		return step;
	}
	visit(node) {
		if (viewFacts(node).rendersChildren) node.accept(this);
	}
	// Nodes that only compute values render nothing: their children are visited for the ones
	// that do (viewFacts prunes the rest).
	node(node) {
		for (const c of node.childNodes()) this.visit(c);
	}
	element(node) {
		for (const [, value] of node.attrs) this.visit(value);
		for (const c of node.children) this.visit(c);
	}
	cond(node) {
		this.visit(node.branch(this.ctx));
	}
	render(node) {
		const { ctx } = this;
		const child = node.source.eval(ctx);
		const path = this.parent.path.concat([node.source.toFrame(ctx)]);
		const step = this.add(makeStep(sourceStep(node.source, ctx), path));
		this.enter(step, child, ctx.enterFrame(child), node.viewName);
	}
	renderIt(node) {
		const { ctx } = this;
		const it = ctx.lookupBind("value");
		const step = this.add(makeStep({ t: "it" }, asNodePath(this.parent.path)));
		this.enter(step, it, ctx.forItemView(it), node.viewName);
	}
	// A loop is a step of its own, with no frame: its items are its children. It's on the
	// path when the path goes through one of its items, whose frames differ only by item.
	each(node) {
		const { ctx } = this;
		const total = sizeOf(node.source.eval(ctx));
		const source = sourceStep(node.source, ctx);
		const step = { t: "each", source, loop: node.loopName ?? null, kept: null, total };
		const group = this.add(makeStep(step, this.parent.path));
		const sourceFrame = node.source.toFrame(ctx);
		const at = this.path?.frames[group.path.frames.length];
		group.active =
			this.path === null ||
			(at !== undefined && this.path.startsWith(group.path.concat([sourceFrame.forItem(at.item)])));
		const walk = () => this.fill(group, ctx, () => this.items(group, node, sourceFrame));
		if (group.active) walk();
		else {
			group.children = null;
			group.hasChildren = total > 0;
			LATER.set(group, walk);
		}
	}
	items(group, node, sourceFrame) {
		const { ctx } = this;
		const loop = loopOf(ctx, node.loopName);
		let kept = 0;
		let more = 0;
		for (const { key, value, binds } of loopEntries(ctx, node.source, loop)) {
			const frame = sourceFrame.forItem(key);
			const path = group.path.concat([node.child === undefined ? frame.asNode() : frame]);
			const onPath = this.path?.startsWith(path) ?? false;
			if (kept++ >= this.siblings && !onPath) {
				more++;
				continue;
			}
			const step = this.add(makeStep({ t: "item", key }, path));
			const itemCtx = ctx.enterFrame(value, binds);
			if (node.child === undefined) this.enter(step, value, itemCtx.forItemView(value), loop.view);
			else this.walkStep(step, itemCtx, node.child);
		}
		group.step.kept = kept;
		if (more > 0) {
			const step = makeStep({ t: "more", count: more }, group.path);
			this.add({ ...step, active: false, children: null });
		}
	}
	renderEach(node) {
		this.each(node); // A RenderEachNode has no child: each item is a component.
	}
	withBinds(node) {
		const { ctx } = this;
		const { value: _value, ...binds } = ctx.spec.binds[node.bindsName].call(ctx.component);
		this.ctx = ctx.addBinds(binds);
		try {
			this.visit(node.child);
		} finally {
			this.ctx = ctx;
		}
	}
	pushView(node) {
		const { ctx } = this;
		this.ctx = ctx.pushView(node.source.eval(ctx));
		try {
			this.visit(node.child);
		} finally {
			this.ctx = ctx;
		}
	}
}

// The tree of the steps a render of root takes, focused on path (a DispatchPath, or null for
// the whole tree, every step active). target picks the renders, as RenderContext.root's does.
export const pathTree = (root, options = {}) => PathTreeWalker.tree(root, options);

// Walks an unwalked step: its children, inactive as it is, are listed. Returns them; [] for a
// step with nothing to walk.
export const expand = (step) => {
	if (step.children !== null) return step.children;
	const later = LATER.get(step);
	if (later === undefined) return [];
	LATER.delete(step);
	later();
	return step.children;
};

// The steps of tree, depth first, parents before their children.
export function* stepsOf(step) {
	yield step;
	for (const c of step.children ?? []) yield* stepsOf(c);
}

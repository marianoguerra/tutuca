// Views: the AST nodes view builders make, how they evaluate to vnodes, and the render context.

import { DispatchPath, Frame, selectorFrom } from "../tree/path.js";
import { EVENT_ARGS } from "./events.js";
import { wrapMarkers } from "./markers.js";
import { planElement } from "./optimize.js";
import { isComponent, specOf } from "./spec.js";
import { addChild, toVChilds, VFragment, VNode } from "./vdom.js";

export const renderView = (instance, ctx, viewName) => {
	const spec = specOf(instance);
	const view = ctx.getBestViewFor(spec, viewName);
	return wrapMarkers({ t: "component" }, view.eval(ctx.with({ component: instance })));
};
export class AstNode {
	static kind = "node"; // The Walker method it dispatches to.
	childNodes() {
		return [];
	}
	accept(walker) {
		walker.dispatch(this.constructor.kind, this);
	}
}
export class Field extends AstNode {
	static kind = "field";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return ctx.it[this.name];
	}
	toFrame(_ctx) {
		return new Frame([this.name], null, null, true);
	}
}
export const field = (name) => new Field(name);
// One of the component's queries that takes args, called with them: $query("matches",
// field("text")). A query without args reads as a field.
export class Query extends AstNode {
	static kind = "query";
	constructor(name, args) {
		super();
		this.name = name;
		this.args = args;
	}
	eval(ctx) {
		return ctx.it[this.name](...this.args.map((a) => a.eval(ctx)));
	}
	childNodes() {
		return this.args;
	}
}
export const $query = (name, ...args) => new Query(name, args.map(toNode));
export class SeqItem extends AstNode {
	static kind = "seqItem";
	constructor(seqName, keyName) {
		super();
		this.seqName = seqName;
		this.keyName = keyName;
	}
	eval(ctx) {
		const key = ctx.it[this.keyName];
		return ctx.it[this.seqName][key];
	}
	toFrame(ctx) {
		return new Frame([this.seqName], ctx.it[this.keyName] ?? null, null, true);
	}
}
export const seqItem = (seqName, keyName) => new SeqItem(seqName, keyName);
export class Provided extends AstNode {
	static kind = "provided";
	constructor(name) {
		super();
		this.name = name;
	}
	// No ancestor providing the name is a lint warning (lint can't see ancestry): as a value it
	// reads undefined, as a render or each source it fails.
	eval(ctx) {
		return ctx.provided[this.name]?.value;
	}
	toFrame(ctx) {
		const { depth, keys } = ctx.provided[this.name];
		return new Frame([], null, { name: this.name, depth, keys }, true);
	}
}
export const provided = (name) => new Provided(name);
let nextEid = 0;
export class Element extends AstNode {
	static kind = "element";
	constructor(tagName, attrs, childs, handlers) {
		super();
		this.tagName = tagName;
		this.attrs = attrs;
		this.childs = childs;
		this.handlers = handlers;
		this.eid = handlers.length > 0 ? nextEid++ : null;
		this.plan = planElement(this); // OPT: what every render shares (shape, constant parts), see planElement.
	}
	// A vnode of this element's shape, with the dynamic attrs and the children evaluated in ctx.
	eval(ctx) {
		const { shape, valueExprs, keyExpr, childs, vnode } = this.plan;
		if (vnode !== null) return vnode; // OPT: a constant element is prebuilt.
		const values = valueExprs.map((v) => v.eval(ctx));
		const vchilds = [];
		for (let i = 0; i < this.childs.length; i++) {
			addChild(vchilds, childs[i] ?? this.childs[i].eval(ctx)); // OPT: prebuilt constant childs.
		}
		return new VNode(shape, values, vchilds, keyExpr?.eval(ctx));
	}
}
// Arrays of children splice into the element when the view is built, nested ones too.
export const h = (tagName, attrs, ...childs) => {
	const props = [];
	const handlers = [];
	for (const key in attrs) {
		const value = attrs[key];
		if (key.startsWith("on:")) handlers.push({ name: key.slice(3), action: value });
		else props.push([key, toNode(value)]);
	}
	return new Element(tagName, props, childs.flat(Infinity).map(toNode), handlers);
};
export class Cond extends AstNode {
	static kind = "cond";
	constructor(source, thenVal, elseVal) {
		super();
		this.source = source;
		this.thenVal = thenVal;
		this.elseVal = elseVal;
	}
	eval(ctx) {
		return (this.source.eval(ctx) ? this.thenVal : this.elseVal).eval(ctx);
	}
	childNodes() {
		return [this.source, this.thenVal, this.elseVal];
	}
}
export const $if = (source, thenVal, elseVal) =>
	new Cond(toNode(source), toNode(thenVal), toNode(elseVal));
export class Constant extends AstNode {
	static kind = "constant";
	constructor(value) {
		super();
		this.value = value;
	}
	eval(_ctx) {
		return this.value;
	}
}
export const toNode = (v) => (v instanceof AstNode ? v : new Constant(v));
export class Render extends AstNode {
	static kind = "render";
	constructor(source, viewName) {
		super();
		this.source = source;
		this.viewName = viewName;
	}
	eval(ctx) {
		const child = this.source.eval(ctx);
		const frame = this.source.toFrame(ctx);
		return wrapMarkers(frame.toMarker(), renderView(child, ctx.enterFrame(child), this.viewName));
	}
	childNodes() {
		return [this.source];
	}
}
export const render = (source, viewName) => new Render(toNode(source), viewName);
const entriesOf = (items) => (Array.isArray(items) ? items.entries() : Object.entries(items));
function* filteredEntries(self, filter, items, state) {
	for (const entry of entriesOf(items)) {
		if (filter === undefined || filter.call(self, entry[0], entry[1], state)) yield entry;
	}
}
// The fragments a loop renders: one per entry of the source, with its key and frame, each
// being what renderItem returns for the item's ctx. The loop's prepare, iter, filter, key and
// enrich shape it.
const loopFragments = (ctx, source, loopName, renderItem) => {
	const loop = loopName === undefined ? {} : ctx.spec.loops[loopName];
	const self = ctx.component;
	const nodes = [];
	const items = source.eval(ctx);
	const state = loop.prepare === undefined ? null : loop.prepare.call(self, items);
	const entries = loop.iter
		? loop.iter.call(self, items, state)
		: filteredEntries(self, loop.filter, items, state);
	const sourceFrame = source.toFrame(ctx);
	for (const [key, value] of entries) {
		const frame = sourceFrame.forItem(key);
		const fragmentKey = loop.key === undefined ? key : loop.key.call(self, key, value, state);
		const base = { value, key };
		const binds = loop.enrich ? { ...loop.enrich.call(self, base, state), value, key } : base;
		const dom = renderItem(ctx.enterFrame(value, binds), loop);
		nodes.push(new VFragment(toVChilds(wrapMarkers(frame.toMarker(), dom)), fragmentKey));
	}
	return new VFragment(nodes);
};
export class Each extends AstNode {
	static kind = "each";
	constructor(source, child, loopName) {
		super();
		this.source = source;
		this.child = child;
		this.loopName = loopName;
	}
	eval(ctx) {
		return loopFragments(ctx, this.source, this.loopName, (itemCtx) => this.child.eval(itemCtx));
	}
	childNodes() {
		return [this.source, this.child];
	}
}
export const each = (source, child, loopName) => new Each(toNode(source), toNode(child), loopName);
const renderEachItem = (itemCtx, loop) =>
	renderView(itemCtx.it, itemCtx.forItemView(itemCtx.it), loop.view);
// A loop that renders each item, a component, with the loop's view.
export class RenderEach extends AstNode {
	static kind = "renderEach";
	constructor(source, loopName) {
		super();
		this.source = source;
		this.loopName = loopName;
	}
	eval(ctx) {
		return loopFragments(ctx, this.source, this.loopName, renderEachItem);
	}
	childNodes() {
		return [this.source];
	}
}
export const renderEach = (source, loopName) => new RenderEach(toNode(source), loopName);
export class RenderIt extends AstNode {
	static kind = "renderIt";
	constructor(viewName) {
		super();
		this.viewName = viewName;
	}
	eval(ctx) {
		const it = ctx.lookupBind("value");
		return renderView(it, ctx.forItemView(it), this.viewName);
	}
}
export const renderIt = (viewName) => new RenderIt(viewName);
// child with the names one of the component's binds returns, all but value, in scope.
export class WithBinds extends AstNode {
	static kind = "withBinds";
	constructor(bindsName, child) {
		super();
		this.bindsName = bindsName;
		this.child = child;
	}
	eval(ctx) {
		const { value: _value, ...binds } = ctx.spec.binds[this.bindsName].call(ctx.component);
		return this.child.eval(ctx.addBinds(binds));
	}
	childNodes() {
		return [this.child];
	}
}
export const withBinds = (bindsName, child) => new WithBinds(bindsName, toNode(child));
export class PushView extends AstNode {
	static kind = "pushView";
	constructor(viewNameVal, child) {
		super();
		this.viewNameVal = viewNameVal;
		this.child = child;
	}
	eval(ctx) {
		const viewName = this.viewNameVal.eval(ctx);
		return this.child.eval(ctx.pushView(viewName));
	}
	childNodes() {
		return [this.viewNameVal, this.child];
	}
}
export const pushView = (source, child) => new PushView(toNode(source), toNode(child));
export class Send extends AstNode {
	static kind = "send";
	constructor(name, args) {
		super();
		this.name = name;
		this.args = args;
	}
	childNodes() {
		return this.args;
	}
}
export const send = (name, ...args) => new Send(name, args.map(toNode));
// A send arg that reads the event, not the state: one of EVENT_ARGS, by name.
export class EventArg extends AstNode {
	static kind = "eventArg";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return EVENT_ARGS[this.name](ctx);
	}
}
export const targetValue = () => new EventArg("targetValue");
export const sourceKey = () => new EventArg("sourceKey");
export const dragKey = () => new EventArg("dragKey");
export class LookupBind extends AstNode {
	static kind = "lookupBind";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return ctx.lookupBind(this.name);
	}
}
export const lookupBind = (name) => new LookupBind(name);
export class RenderContext {
	constructor({ it, binds, provided, viewStack, depth, component }) {
		this.it = it;
		this.component = component; // component != it inside loops
		this.binds = binds;
		this.provided = provided; // name -> { value, depth, keys }: what ancestors provide.
		this.viewStack = viewStack;
		this.depth = depth;
	}
	get spec() {
		return specOf(this.component);
	}
	static root(component) {
		const empty = { it: null, binds: {}, provided: {}, viewStack: [], depth: -1 };
		return new RenderContext({ ...empty, component }).enterFrame(component);
	}
	with(changes) {
		return new RenderContext({ ...this, ...changes });
	}
	enterFrame(it, binds = {}) {
		const depth = this.depth + 1;
		return this.with({ it, binds, provided: this.mergeProvided(it, depth), depth });
	}
	forItemView(it) {
		return this.with({ it, binds: {} });
	}
	addBinds(binds) {
		return this.with({ binds: { ...this.binds, ...binds } });
	}
	pushView(viewName) {
		return this.with({ viewStack: [viewName, ...this.viewStack] });
	}
	mergeProvided(it, depth) {
		if (!isComponent(it)) return this.provided;
		const { provides } = specOf(it);
		const newProvided = { ...this.provided };
		for (const key in provides) {
			const suffix = new DispatchPath(selectorFrom(provides[key], it).fix(it)).toKeyPath();
			newProvided[key] = { value: suffix.getIn(it), depth, keys: suffix.keys };
		}
		return newProvided;
	}
	lookupBind(name) {
		return this.binds[name] ?? null;
	}
	getBestViewFor(spec, viewName) {
		const candidates = viewName === undefined ? this.viewStack : [viewName, ...this.viewStack];
		for (const name of candidates) {
			const view = spec.views[name];
			if (view !== undefined) return view;
		}
		return spec.views.main;
	}
}

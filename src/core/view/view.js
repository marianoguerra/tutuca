// Views: the AST nodes view builders make, how they evaluate to vnodes, and the render context.

import { DispatchPath, Frame, selectorFrom } from "../../tree/index.js";
import { addChild, toVChildren, VFragment, VNode } from "../../vdom/index.js";
import { isComponent, specOf } from "../model/spec.js";
import { planElement } from "./element-plan.js";
import { wrapComponent, wrapFrame } from "./markers.js";

export const renderView = (instance, ctx, viewName) => {
	const spec = specOf(instance);
	const view = ctx.getBestViewFor(spec, viewName);
	return wrapComponent(view.eval(ctx.with({ component: instance })));
};
export class ViewNode {
	static kind = "node"; // The Walker method it dispatches to.
	childNodes() {
		return [];
	}
	accept(walker) {
		walker.dispatch(this.constructor.kind, this);
	}
}
export class FieldNode extends ViewNode {
	static kind = "field";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return ctx.it[this.name];
	}
	toFrame(_ctx) {
		return Frame.node(this.name);
	}
}
export const field = (name) => new FieldNode(name);
// One of the component's queries that takes args, called with them: $query("matches",
// field("text")). A query without args reads as a field.
export class QueryNode extends ViewNode {
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
export const $query = (name, ...args) => new QueryNode(name, args.map(toNode));
export class SeqItemNode extends ViewNode {
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
		return Frame.node(this.seqName, ctx.it[this.keyName] ?? null);
	}
}
export const seqItem = (seqName, keyName) => new SeqItemNode(seqName, keyName);
export class ProvidedNode extends ViewNode {
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
export const provided = (name) => new ProvidedNode(name);
let nextEid = 0;
export class ElementNode extends ViewNode {
	static kind = "element";
	constructor(tagName, attrs, children, handlers) {
		super();
		this.tagName = tagName;
		this.attrs = attrs;
		this.children = children;
		this.handlers = handlers;
		this.eid = handlers.length > 0 ? nextEid++ : null;
		this.plan = planElement(this); // OPT: what every render shares (shape, constant parts), see planElement.
	}
	// A vnode of this element's shape, with the dynamic attrs and the children evaluated in ctx.
	eval(ctx) {
		const { shape, valueExprs, keyExpr, children, vnode } = this.plan;
		if (vnode !== null) return vnode; // OPT: a constant element is prebuilt.
		const values = valueExprs.map((v) => v.eval(ctx));
		const vchildren = [];
		for (let i = 0; i < this.children.length; i++) {
			addChild(vchildren, children[i] ?? this.children[i].eval(ctx)); // OPT: prebuilt constant children.
		}
		return new VNode(shape, values, vchildren, keyExpr?.eval(ctx));
	}
}
// Arrays of children splice into the element when the view is built, nested ones too. An on:type
// attr is a handler, { type, action }: the event's type and the send it makes.
export const h = (tagName, attrs, ...children) => {
	const props = [];
	const handlers = [];
	for (const key in attrs) {
		const value = attrs[key];
		if (key.startsWith("on:")) handlers.push({ type: key.slice(3), action: value });
		else props.push([key, toNode(value)]);
	}
	return new ElementNode(tagName, props, children.flat(Infinity).map(toNode), handlers);
};
export class CondNode extends ViewNode {
	static kind = "cond";
	constructor(test, thenVal, elseVal) {
		super();
		this.test = test;
		this.thenVal = thenVal;
		this.elseVal = elseVal;
	}
	eval(ctx) {
		return (this.test.eval(ctx) ? this.thenVal : this.elseVal).eval(ctx);
	}
	childNodes() {
		return [this.test, this.thenVal, this.elseVal];
	}
}
// $if and $query take a $: if is a reserved word, and query is the contract's (contract.js).
export const $if = (test, thenVal, elseVal) =>
	new CondNode(toNode(test), toNode(thenVal), toNode(elseVal));
export class ConstantNode extends ViewNode {
	static kind = "constant";
	constructor(value) {
		super();
		this.value = value;
	}
	eval(_ctx) {
		return this.value;
	}
}
export const toNode = (v) => (v instanceof ViewNode ? v : new ConstantNode(v));
export class RenderNode extends ViewNode {
	static kind = "render";
	constructor(source, viewName) {
		super();
		this.source = source;
		this.viewName = viewName;
	}
	eval(ctx) {
		const child = this.source.eval(ctx);
		const frame = this.source.toFrame(ctx);
		return wrapFrame(frame, renderView(child, ctx.enterFrame(child), this.viewName));
	}
	childNodes() {
		return [this.source];
	}
}
export const render = (source, viewName) => new RenderNode(toNode(source), viewName);
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
		nodes.push(new VFragment(toVChildren(wrapFrame(frame, dom)), fragmentKey));
	}
	return new VFragment(nodes);
};
export class EachNode extends ViewNode {
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
export const each = (source, child, loopName) =>
	new EachNode(toNode(source), toNode(child), loopName);
const renderEachItem = (itemCtx, loop) =>
	renderView(itemCtx.it, itemCtx.forItemView(itemCtx.it), loop.view);
// A loop that renders each item, a component, with the loop's view.
export class RenderEachNode extends ViewNode {
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
export const renderEach = (source, loopName) => new RenderEachNode(toNode(source), loopName);
export class RenderItNode extends ViewNode {
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
export const renderIt = (viewName) => new RenderItNode(viewName);
// child with the names one of the component's binds returns, all but value, in scope.
export class WithBindsNode extends ViewNode {
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
export const withBinds = (bindsName, child) => new WithBindsNode(bindsName, toNode(child));
export class PushViewNode extends ViewNode {
	static kind = "pushView";
	constructor(source, child) {
		super();
		this.source = source; // What evaluates to the view's name.
		this.child = child;
	}
	eval(ctx) {
		const viewName = this.source.eval(ctx);
		return this.child.eval(ctx.pushView(viewName));
	}
	childNodes() {
		return [this.source, this.child];
	}
}
export const pushView = (source, child) => new PushViewNode(toNode(source), toNode(child));
export class SendNode extends ViewNode {
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
export const send = (name, ...args) => new SendNode(name, args.map(toNode));
// What each event arg reads from the ctx the host makes when the event arrives (eventSend).
const EVENT_ARGS = {
	// The element with the handler: the click may land on a child of it, like an icon.
	targetValue(ctx) {
		const target = ctx.node ?? ctx.event.target;
		return target.type === "checkbox" ? target.checked : target.value;
	},
	sourceKey: (ctx) => ctx.sourceKey,
	// The key of the child the dragged element is in, as sourceKey is for the event's element;
	// null when nothing, or something from outside the component, is dragged.
	dragKey: (ctx) => ctx.drag?.sourceKeyIn(ctx.path) ?? null,
};
// A send arg that reads the event, not the state: one of EVENT_ARGS, by name.
export class EventArgNode extends ViewNode {
	static kind = "eventArg";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return EVENT_ARGS[this.name](ctx);
	}
}
export const targetValue = () => new EventArgNode("targetValue");
export const sourceKey = () => new EventArgNode("sourceKey");
export const dragKey = () => new EventArgNode("dragKey");
export class LookupBindNode extends ViewNode {
	static kind = "lookupBind";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return ctx.lookupBind(this.name);
	}
}
export const lookupBind = (name) => new LookupBindNode(name);
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

// Views: the AST nodes view builders make, how they evaluate to vnodes, and the render context.

import { DispatchPath, Frame, selectorOfPath } from "../../tree/index.js";
import { addChild, toVChildren, VFragment, VNode } from "../../vdom/index.js";
import { isComponent, specOf } from "../model/spec.js";
import { planElement } from "./element-plan.js";
import { frameOpen, wrapOpen } from "./markers.js";
import { addDep, NULL_CACHE, providesAny } from "./render-cache.js";

// A component's view in ctx, between its markers, as ctx.cache renders it (render-cache.js): a
// cache reuses what an instance rendered before in the same place, when its subtree read the
// same provided values.
export const renderView = (instance, ctx, viewName) => {
	const spec = specOf(instance);
	return ctx.cache.render(instance, spec, ctx.getBestViewFor(spec, viewName), ctx);
};
export class ViewNode {
	static kind = "node"; // The Walker method it dispatches to.
	childNodes() {
		return [];
	}
	accept(walker) {
		return walker.dispatch(this.constructor.kind, this);
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
		return ctx.readProvided(this.name)?.value;
	}
	toFrame(ctx) {
		const { depth, keys } = ctx.readProvided(this.name);
		return new Frame([], null, { name: this.name, up: ctx.depth - depth, keys }, true);
	}
}
export const provided = (name) => new ProvidedNode(name);
let nextEid = 0;
export class ElementNode extends ViewNode {
	static kind = "element";
	constructor(tagName, attrs, children, bindings) {
		super();
		this.tagName = tagName;
		this.attrs = attrs;
		this.children = children;
		this.bindings = bindings;
		this.eid = bindings.length > 0 ? nextEid++ : null;
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
// on:type+modifier...: the modifiers are what the event must also be for the binding to take it
// (a key held: ctrl, alt, shift, meta; the key pressed: enter, escape, tab, space, up, down,
// left, right, delete, backspace) and what's done to it when it does (prevent:
// preventDefault(), stop: stopPropagation()), as tutuca-wasm's.
const KEY_MODIFIERS = {
	enter: "Enter",
	escape: "Escape",
	esc: "Escape",
	tab: "Tab",
	space: " ",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
	delete: "Delete",
	backspace: "Backspace",
};
const HELD_MODIFIERS = { ctrl: "ctrlKey", alt: "altKey", shift: "shiftKey", meta: "metaKey" };
// The binding of on:spec: { type, action, key, held, prevent, stop }.
const eventBinding = (spec, action) => {
	const [type, ...modifiers] = spec.split("+");
	const binding = { type, action, key: null, held: [], prevent: false, stop: false };
	for (const m of modifiers) {
		if (Object.hasOwn(KEY_MODIFIERS, m)) binding.key = KEY_MODIFIERS[m];
		else if (Object.hasOwn(HELD_MODIFIERS, m)) binding.held.push(HELD_MODIFIERS[m]);
		else if (m === "prevent") binding.prevent = true;
		else if (m === "stop") binding.stop = true;
		else {
			const known = [
				...Object.keys(KEY_MODIFIERS),
				...Object.keys(HELD_MODIFIERS),
				"prevent",
				"stop",
			];
			throw new Error(`Unknown event modifier ${m} in on:${spec} (one of ${known.join(", ")})`);
		}
	}
	return binding;
};
// Whether binding takes event: its type, the key it names pressed and the keys it names held.
export const bindingTakes = (binding, event) =>
	binding.type === event.type &&
	(binding.key === null || event.key === binding.key) &&
	binding.held.every((k) => event[k] === true);
// Arrays of children splice into the element when the view is built, nested ones too. An
// on:type attr is an event binding (eventBinding): the event's type, its modifiers and the send
// it makes.
export const h = (tagName, attrs, ...children) => {
	const props = [];
	const bindings = [];
	for (const key in attrs) {
		const value = attrs[key];
		if (key.startsWith("on:")) bindings.push(eventBinding(key.slice(3), value));
		else props.push([key, toNode(value)]);
	}
	return new ElementNode(tagName, props, children.flat(Infinity).map(toNode), bindings);
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
		return this.branch(ctx).eval(ctx);
	}
	// The child the test picks in ctx.
	branch(ctx) {
		return this.test.eval(ctx) ? this.thenVal : this.elseVal;
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
		// Nothing to render, as an option component field's null: nothing rendered.
		if (child === null || child === undefined) return null;
		const open = frameOpen(this.source.toFrame(ctx));
		const childCtx = ctx.enterFrame(child, {}, ctx.slotIn(open));
		return wrapOpen(open, renderView(child, childCtx, this.viewName));
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
// The entries a loop goes over in ctx: { key, value, binds, fragmentKey } for each entry of the
// source its prepare, iter and filter keep, binds and fragmentKey as its enrich and key make them.
// Rendering (loopFragments) and the dev walkers (DepsWalker, the path tree) all go through it,
// so they walk the same items.
export function* loopEntries(ctx, source, loop) {
	const self = ctx.component;
	const items = source.eval(ctx);
	const state = loop.prepare === undefined ? null : loop.prepare.call(self, items);
	const entries = loop.iter
		? loop.iter.call(self, items, state)
		: filteredEntries(self, loop.filter, items, state);
	for (const [key, value] of entries) {
		const fragmentKey = loop.key === undefined ? key : loop.key.call(self, key, value, state);
		const base = { value, key };
		const binds = loop.enrich ? { ...loop.enrich.call(self, key, value, state), value, key } : base;
		yield { key, value, binds, fragmentKey };
	}
}
export const loopOf = (ctx, loopName) => (loopName === undefined ? {} : ctx.spec.loops[loopName]);
// The fragments a loop renders: one per entry of the source, with its key and frame, each
// being what renderItem returns for the item's ctx. The loop's prepare, iter, filter, key and
// enrich shape it.
// An item that's a component (reuse) can keep its fragment while the cache keeps its render.
const loopFragments = (ctx, source, loopName, renderItem, reuse = false) => {
	const loop = loopOf(ctx, loopName);
	const nodes = [];
	const entries = loopEntries(ctx, source, loop);
	const sourceFrame = source.toFrame(ctx);
	for (const { key, value, binds, fragmentKey } of entries) {
		const open = frameOpen(sourceFrame.forItem(key));
		const dom = renderItem(ctx.enterFrame(value, binds, ctx.slotIn(open)), loop);
		const wrapped = wrapOpen(open, dom);
		const make = () => new VFragment(toVChildren(wrapped), fragmentKey);
		nodes.push(reuse ? ctx.cache.fragment(dom, wrapped, fragmentKey, make) : make());
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
// An item, a component, rendered with a view of its own: a view pushed for the loop's component
// doesn't reach it (forItemView).
const renderItem = (it, ctx, viewName) => renderView(it, ctx.forItemView(it), viewName);
const renderEachItem = (itemCtx, loop) => renderItem(itemCtx.it, itemCtx, loop.view);
// A loop that renders each item, a component, with the loop's view.
export class RenderEachNode extends ViewNode {
	static kind = "renderEach";
	constructor(source, loopName) {
		super();
		this.source = source;
		this.loopName = loopName;
	}
	eval(ctx) {
		return loopFragments(ctx, this.source, this.loopName, renderEachItem, true);
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
		return renderItem(ctx.lookupBind("value"), ctx, this.viewName);
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
	// The key a key event is for, as KeyboardEvent.key says it: "a", "Enter", "ArrowUp", ...
	eventKey: (ctx) => ctx.event?.key ?? null,
	// A property of the event, by name: a CustomEvent's detail, a pointer event's clientX.
	eventProperty: (ctx, name) => ctx.event?.[name] ?? null,
	sourceKey: (ctx) => ctx.sourceKey,
	// The key of the child the dragged element is in, as sourceKey is for the event's element;
	// null when nothing, or something from outside the component, is dragged.
	dragKey: (ctx) => ctx.drag?.sourceKeyIn(ctx.path) ?? null,
};
// A send arg that reads the event, not the state: one of EVENT_ARGS, by name (and its arg, the
// property eventProperty reads).
export class EventArgNode extends ViewNode {
	static kind = "eventArg";
	constructor(name, arg = undefined) {
		super();
		this.name = name;
		this.arg = arg;
	}
	eval(ctx) {
		return EVENT_ARGS[this.name](ctx, this.arg);
	}
}
export const targetValue = () => new EventArgNode("targetValue");
export const eventKey = () => new EventArgNode("eventKey");
export const sourceKey = () => new EventArgNode("sourceKey");
export const dragKey = () => new EventArgNode("dragKey");
export const eventProperty = (name) => new EventArgNode("eventProperty", name);
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
	constructor({
		it,
		binds,
		provided,
		viewStack,
		depth,
		component,
		renderTarget = null,
		cache = NULL_CACHE,
		deps = null,
		slot = "",
		cacheLevel = null,
	}) {
		this.it = it;
		this.renderTarget = renderTarget; // The RenderTarget whose renders it picks; null for the page's views.
		this.component = component; // component != it inside loops
		this.binds = binds;
		this.provided = provided; // name -> { value, depth, keys }: what ancestors provide.
		this.viewStack = viewStack;
		this.depth = depth;
		this.cache = cache; // The RenderCache renderView renders components with.
		// name -> entry: the provided entries the component being rendered read so far, null when
		// nothing collects them.
		this.deps = deps;
		// Where in its component's view this is: the frames' marker texts since the component,
		// when the cache uses slots (CopyCache); "" otherwise.
		this.slot = slot;
		this.cacheLevel = cacheLevel; // What the cache finds and keeps entries in, its own.
	}
	get spec() {
		return specOf(this.component);
	}
	static root(component, { renderTarget = null, cache = NULL_CACHE } = {}) {
		const empty = { it: null, binds: {}, provided: {}, viewStack: [], depth: -1 };
		const cacheLevel = cache.rootLevel;
		return new RenderContext({ ...empty, component, renderTarget, cache, cacheLevel }).enterFrame(
			component,
		);
	}
	with(changes) {
		return new RenderContext({ ...this, ...changes });
	}
	enterFrame(it, binds = {}, slot = this.slot) {
		const depth = this.depth + 1;
		return this.with({ it, binds, provided: this.mergeProvided(it, depth), depth, slot });
	}
	// The slot inside the frame open opens.
	slotIn(open) {
		return this.cache.usesSlots ? this.slot + open.text : this.slot;
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
		if (!providesAny(provides)) return this.provided; // OPT: nothing to copy the map for.
		const newProvided = { ...this.provided };
		for (const key in provides) {
			const suffix = new DispatchPath(selectorOfPath(provides[key]).fix(it)).toKeyPath();
			newProvided[key] = { value: suffix.getIn(it), depth, keys: suffix.keys };
		}
		return newProvided;
	}
	lookupBind(name) {
		return this.binds[name] ?? null;
	}
	// What an ancestor provides as name, { value, depth, keys }, or undefined; noted in deps, as
	// what's rendered here depends on it.
	readProvided(name) {
		const entry = this.provided[name];
		if (this.deps !== null) addDep(this.deps, name, entry);
		return entry;
	}
	// From the spec's renders for the target; a spec without them shows its page views if the target
	// falls back to them, and fails to render if not. A view missing by name falls back to that
	// target's main, never to another target's.
	getBestViewFor(spec, viewName) {
		const views = spec.viewsFor(this.renderTarget) ?? this.viewsWithout(spec);
		const candidates = viewName === undefined ? this.viewStack : [viewName, ...this.viewStack];
		for (const name of candidates) {
			const view = views[name];
			if (view !== undefined) return view;
		}
		return views.main;
	}
	viewsWithout(spec) {
		if (this.renderTarget.fallsBackToViews) return spec.views;
		throw new Error(`Component ${spec.name} has no ${this.renderTarget.name} render`);
	}
}

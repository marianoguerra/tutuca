// Views: the AST nodes view builders make, how they evaluate to vnodes, and the render context.
import { wrapMeta } from "./meta.js";
import { planElement, reuseConstant } from "./optimize.js";
import { DispatchPath, Frame, selectorFrom } from "./paths.js";
import { isComponent, specOf } from "./schema.js";
import { VBase, VFragment, VNode, VText } from "./vdom.js";

export const renderView = (instance, ctx, viewName) => {
	const spec = specOf(instance);
	const view = ctx.getBestViewFor(spec, viewName);
	return wrapMeta({ t: "component" }, view.eval(ctx.with({ component: instance })));
};
export class AstNode {
	static kind = "node"; // The Walker method it dispatches to.
	childNodes() {
		return [];
	}
	accept(walker) {
		walker[this.constructor.kind](this);
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
		return ctx.dynBinds[this.name]?.value;
	}
	toFrame(ctx) {
		const { depth, keys } = ctx.dynBinds[this.name];
		return new Frame([], null, { name: this.name, depth, keys }, true);
	}
}
export const provided = (name) => new Provided(name);
let nextEid = 0;
// Any iterable is spliced into its parent, null and undefined render nothing, other values as text.
function addChild(childs, child) {
	if (child == null) return;
	if (typeof child !== "string" && typeof child[Symbol.iterator] === "function") {
		for (const c of child) addChild(childs, c);
	} else if (child instanceof VBase) childs.push(child);
	else childs.push(new VText(child));
}
export const toVChilds = (value) => {
	const childs = [];
	addChild(childs, value);
	return childs;
};
export class DomNode extends AstNode {
	static kind = "element";
	constructor(tagName, attrs, childs, handlers) {
		super();
		this.tagName = tagName;
		this.attrs = attrs;
		this.childs = childs;
		this.handlers = handlers;
		this.eid = handlers.length > 0 ? nextEid++ : null;
		this.plan = planElement(this); // OPT: what every render shares (shape, constness, literal texts), see planElement.
	}
	eval(ctx) {
		return reuseConstant(this, ctx); // OPT: a constant element builds once, see reuseConstant.
	}
	// A vnode of this element's shape, with the dynamic attrs and the children evaluated in ctx.
	build(ctx) {
		const { shape, valueExprs, keyExpr, texts } = this.plan;
		const values = valueExprs.map((v) => v.eval(ctx));
		const childs = [];
		for (let i = 0; i < this.childs.length; i++) {
			addChild(childs, texts[i] ?? this.childs[i].eval(ctx)); // OPT: prebuilt literal texts.
		}
		return new VNode(shape, values, childs, keyExpr?.eval(ctx));
	}
	childNodes() {
		const attrs = this.attrs.map(([, v]) => v);
		return [...attrs, ...this.childs, ...this.handlers.map((h) => h.action)];
	}
}
// Arrays of children splice into the element when the view is built, nested ones too.
export const h = (tagName, attrs, ...childs) => {
	const props = [];
	const handlers = [];
	for (const key in attrs) {
		const value = attrs[key];
		if (key.startsWith("on:")) handlers.push({ name: key.slice(3), action: value });
		else props.push([key, toExpr(value)]);
	}
	return new DomNode(tagName, props, childs.flat(Infinity).map(toExpr), handlers);
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
	new Cond(toExpr(source), toExpr(thenVal), toExpr(elseVal));
export class Const extends AstNode {
	static kind = "constant";
	constructor(value) {
		super();
		this.value = value;
	}
	eval(_ctx) {
		return this.value;
	}
}
export const toExpr = (v) => (v instanceof AstNode ? v : new Const(v));
export class XRender extends AstNode {
	static kind = "render";
	constructor(source, viewName) {
		super();
		this.source = source;
		this.viewName = viewName;
	}
	eval(ctx) {
		const child = this.source.eval(ctx);
		const frame = this.source.toFrame(ctx);
		return wrapMeta(frame.toMeta(), renderView(child, ctx.enterFrame(child), this.viewName));
	}
	childNodes() {
		return [this.source];
	}
}
export const render = (source, viewName) => new XRender(toExpr(source), viewName);
const entriesOf = (items) => (Array.isArray(items) ? items.entries() : Object.entries(items));
function* filteredEntries(self, filter, items, state) {
	for (const entry of entriesOf(items)) {
		if (filter === undefined || filter.call(self, entry[0], entry[1], state)) yield entry;
	}
}
export class XEach extends AstNode {
	static kind = "each";
	constructor(source, child, loopName) {
		super();
		this.source = source;
		this.child = child;
		this.loopName = loopName;
	}
	eval(ctx) {
		const loop = this.loopName === undefined ? {} : ctx.spec.loops[this.loopName];
		const self = ctx.component;
		const nodes = [];
		const items = this.source.eval(ctx);
		const state = loop.prepare === undefined ? null : loop.prepare.call(self, items);
		const entries = loop.iter
			? loop.iter.call(self, items, state)
			: filteredEntries(self, loop.filter, items, state);
		const sourceFrame = this.source.toFrame(ctx);
		for (const [key, value] of entries) {
			const frame = sourceFrame.forItem(key);
			const fragmentKey = loop.key === undefined ? key : loop.key.call(self, key, value, state);
			const base = { value, key };
			const binds = loop.enrich ? { ...loop.enrich.call(self, base, state), value, key } : base;
			const dom = this.evalItem(ctx.enterFrame(value, binds), loop);
			nodes.push(new VFragment(toVChilds(wrapMeta(frame.toMeta(), dom)), fragmentKey));
		}
		return new VFragment(nodes);
	}
	evalItem(ctx, _loop) {
		return this.child.eval(ctx);
	}
	childNodes() {
		return [this.source, this.child];
	}
}
export const each = (source, child, loopName) => new XEach(toExpr(source), toExpr(child), loopName);
export class XRenderEach extends XEach {
	static kind = "renderEach";
	constructor(source, loopName) {
		super(source, null, loopName);
	}
	evalItem(ctx, loop) {
		return renderView(ctx.it, ctx.forItemView(ctx.it), loop.view);
	}
	childNodes() {
		return [this.source];
	}
}
export const renderEach = (source, loopName) => new XRenderEach(toExpr(source), loopName);
export class XRenderIt extends AstNode {
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
export const renderIt = (viewName) => new XRenderIt(viewName);
export class XScope extends AstNode {
	static kind = "scope";
	constructor(scopeName, child) {
		super();
		this.scopeName = scopeName;
		this.child = child;
	}
	eval(ctx) {
		const { bind } = ctx.spec.scopes[this.scopeName];
		const { value: _value, ...binds } = bind.call(ctx.component);
		return this.child.eval(ctx.enterScope(binds));
	}
	childNodes() {
		return [this.child];
	}
}
export const scope = (scopeName, child) => new XScope(scopeName, toExpr(child));
export class XPushView extends AstNode {
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
export const pushView = (source, child) => new XPushView(toExpr(source), toExpr(child));
export class Send extends AstNode {
	static kind = "action";
	constructor(name, args) {
		super();
		this.name = name;
		this.args = args;
	}
	childNodes() {
		return this.args;
	}
}
export const send = (name, ...args) => new Send(name, args.map(toExpr));
export class TargetValue extends AstNode {
	static kind = "targetValue";
	eval(ctx) {
		// The element with the handler: the click may land on a child of it, like an icon.
		const target = ctx.node ?? ctx.event.target;
		return target.type === "checkbox" ? target.checked : target.value;
	}
}
export const targetValue = () => new TargetValue();
export class SourceKey extends AstNode {
	static kind = "sourceKey";
	eval(ctx) {
		return ctx.sourceKey;
	}
}
export const sourceKey = () => new SourceKey();
// The key of the child the dragged element is in, as sourceKey is for the event's element;
// null when nothing, or something from outside the component, is dragged.
export class DragKey extends AstNode {
	static kind = "dragKey";
	eval(ctx) {
		return ctx.drag?.keyIn(ctx.path) ?? null;
	}
}
export const dragKey = () => new DragKey();
export class LookupBindName extends AstNode {
	static kind = "lookupBind";
	constructor(name) {
		super();
		this.name = name;
	}
	eval(ctx) {
		return ctx.lookupBind(this.name);
	}
}
export const lookupBind = (name) => new LookupBindName(name);
export class RenderContext {
	constructor({ it, binds, dynBinds, viewStack, depth, component }) {
		this.it = it;
		this.component = component; // component != it inside loops
		this.binds = binds;
		this.dynBinds = dynBinds;
		this.viewStack = viewStack;
		this.depth = depth;
	}
	get spec() {
		return specOf(this.component);
	}
	static root(component) {
		const empty = { it: null, binds: {}, dynBinds: {}, viewStack: [], depth: -1 };
		return new RenderContext({ ...empty, component }).enterFrame(component);
	}
	with(changes) {
		return new RenderContext({ ...this, ...changes });
	}
	enterFrame(it, binds = {}) {
		const depth = this.depth + 1;
		return this.with({ it, binds, dynBinds: this.mergeDynBinds(it, depth), depth });
	}
	forItemView(it) {
		return this.with({ it, binds: {} });
	}
	enterScope(scopeBinds) {
		return this.with({ binds: { ...this.binds, ...scopeBinds } });
	}
	pushView(viewName) {
		return this.with({ viewStack: [viewName, ...this.viewStack] });
	}
	mergeDynBinds(it, depth) {
		if (!isComponent(it)) return this.dynBinds;
		const { provides } = specOf(it);
		const newDynBinds = { ...this.dynBinds };
		for (const key in provides) {
			const suffix = new DispatchPath(selectorFrom(provides[key], it).freeze(it)).resolve();
			newDynBinds[key] = { value: suffix.getIn(it), depth, keys: suffix.keys };
		}
		return newDynBinds;
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

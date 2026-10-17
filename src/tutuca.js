import { immerable, produce } from "../deps/immer.js";
import { isMetaOpen, META_CLOSE, META_END, metaOpen, parseMeta } from "./meta.js";
import { planElement, reuseConstant } from "./optimize.js";
import {
	findInvalidFields,
	isComponent,
	messageIssues,
	NoDefaultError,
	scopeOf,
	scopeSym,
	specOf,
	specSym,
	t,
	toMessages,
} from "./schema.js";
import { render as $render, VBase, VFragment, VNode, VText } from "./vdom.js";
import { Collect } from "./walk.js";

export * from "./schema.js";
export * from "./tag.js";
export * from "./walk.js";

export class ComponentSpec {
	constructor({ name, fields, methods, views, on, loops, scopes, provides, invariants }) {
		this.name = name;
		this.fields = fields;
		this.methods = methods;
		// Copy descriptors, not values, so getters in methods stay getters.
		this.proto = Object.create(null, Object.getOwnPropertyDescriptors(methods));
		Object.assign(this.proto, { [immerable]: true, [specSym]: this });
		this.views = views;
		this.on = on;
		this.loops = loops;
		this.scopes = scopes;
		this.provides = provides;
		this.invariants = invariants; // name → predicate on the instance, checked in dev and tests.
		const collect = new Collect();
		for (const key in views) views[key].walk(collect);
		this.eventHandlers = collect.eventHandlers;
		this.eventNames = new Set([...this.eventHandlers.values()].flat().map((h) => h.name));
	}
	make(args = {}, scope = null) {
		const state = Object.create(this.proto);
		if (scope !== null) state[scopeSym] = scope;
		for (const key in this.fields) {
			try {
				state[key] = this.fields[key].make(args[key], scope, state);
			} catch (error) {
				// Prefix the field, so nested failures read as a path: Root.child: Child.item: ...
				const Wrapped = error instanceof NoDefaultError ? NoDefaultError : Error;
				throw new Wrapped(`${this.name}.${key}: ${error.message}`, { cause: error });
			}
		}
		return state;
	}
}
const renderView = (instance, ctx, viewName) => {
	const spec = specOf(instance);
	const view = ctx.getBestViewFor(spec, viewName);
	return wrapMeta({ t: "component" }, view.eval(ctx.with({ component: instance })));
};
const ownEntries = (record) => Object.assign(Object.create(null), record); // no toString &c in entries
export const component = (opts) => {
	const { name, fields = {}, methods = {}, view, views = {} } = opts;
	const schema = typeof fields === "function" ? fields(t) : fields;
	const sources = view === undefined ? views : { ...views, main: view };
	const exprs = ownEntries({});
	for (const key in sources) exprs[key] = toExpr(sources[key]);
	if (!("main" in exprs)) throw new Error(`Component ${name} has no main view`);
	return new ComponentSpec({
		name,
		fields: schema,
		methods,
		views: exprs,
		on: toMessages(opts.on),
		loops: ownEntries(opts.loops),
		scopes: ownEntries(opts.scopes),
		provides: ownEntries(opts.provides),
		invariants: ownEntries(opts.invariants),
	});
};
export class AstNode {
	static kind = "node"; // The Walker method it dispatches to.
	childNodes() {
		return [];
	}
	accept(walker) {
		walker[this.constructor.kind](this);
	}
	walk(walker) {
		walker.visit(this);
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
const isIterable = (obj) =>
	obj != null && typeof obj !== "string" && typeof obj[Symbol.iterator] === "function";
function addChild(childs, child) {
	if (child == null) return;
	if (isIterable(child)) {
		for (const c of child) addChild(childs, c);
	} else if (child instanceof VBase) childs.push(child);
	else childs.push(new VText(child));
}
const toVChilds = (value) => {
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
export const h = (tagName, attrs, ...childs) => {
	const props = [];
	const handlers = [];
	for (const key in attrs) {
		const value = attrs[key];
		if (key.startsWith("@on.")) handlers.push({ name: key.slice(4), action: value });
		else props.push([key, toExpr(value)]);
	}
	return new DomNode(tagName, props, childs.map(toExpr), handlers);
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
const toExpr = (v) => (v instanceof AstNode ? v : new Const(v));
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
// A handler returns a replacement for the component, or undefined to keep the draft.
const call = (message, instance, draft, args, ctx) => {
	ctx.handled = { message, args };
	const result = message.run.call(instance, draft, args, ctx);
	return result === undefined ? draft : result;
};
const run = (instance, draft, handlerName, args, ctx) => {
	const handler = specOf(instance).on[handlerName];
	if (handler !== undefined) return call(handler, instance, draft, args, ctx);
	console.warn("handler", handlerName, "not found on", instance, { args, ctx });
	return draft;
};
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
// Paths print as .key and [item], with · for the root, in labels and errors.
const jsonText = (v) => {
	try {
		return JSON.stringify(v) ?? String(v);
	} catch {
		return String(v);
	}
};
const keyText = (key) => (typeof key === "string" ? `.${key}` : `[${jsonText(key)}]`);
const opText = (op) =>
	`.${op.name}${op.t === "item" ? `[${jsonText(op.key)}]` : op.t === "seqItem" ? `[${op.keyName}]` : ""}`;
export class UpdatePath {
	constructor(keys = []) {
		this.keys = keys;
	}
	getIn(root) {
		let v = root;
		for (const key of this.keys) v = v[key];
		return v;
	}
	setIn(root, v) {
		if (this.keys.length === 0) return v;
		const parent = new UpdatePath(this.keys.slice(0, -1)).getIn(root);
		parent[this.keys.at(-1)] = v;
		return root;
	}
}
export class Frame {
	constructor(keys, item = null, provider = null, isComponent = false) {
		this.keys = keys;
		this.item = item;
		this.provider = provider;
		this.isComponent = isComponent;
	}
	get accessKeys() {
		return this.item === null ? this.keys : [...this.keys, this.item];
	}
	asComponent() {
		return new Frame(this.keys, this.item, this.provider, true);
	}
	forItem(key) {
		return new Frame(this.accessKeys, key, this.provider, false);
	}
	toMeta() {
		const { provider: p } = this;
		const base = p === null ? null : { v: p.name, d: p.depth, k: p.keys };
		return { t: "frame", p: base, k: this.keys, i: this.item };
	}
	static fromMeta({ p, k, i }) {
		const provider = p === null ? null : { name: p.v, depth: p.d, keys: p.k };
		return new Frame(k, i, provider);
	}
	// The keys and item, without the provider.
	toString() {
		return `${this.keys.map(keyText).join("")}${this.item === null ? "" : `[${jsonText(this.item)}]`}`;
	}
}
export class DispatchPath {
	constructor(frames = []) {
		this.frames = frames;
	}
	get isRootPath() {
		return this.frames.length === 0;
	}
	concat(frames) {
		return new DispatchPath([...this.frames, ...frames]);
	}
	toParentPath() {
		return new DispatchPath(this.frames.slice(0, -1));
	}
	toComponentPath() {
		let end = this.frames.length;
		while (end > 0 && !this.frames[end - 1].isComponent) end--;
		return new DispatchPath(this.frames.slice(0, end));
	}
	resolve() {
		const prefixes = [[]];
		for (const frame of this.frames) {
			const { provider } = frame;
			const start =
				provider === null ? prefixes.at(-1) : [...prefixes[provider.depth], ...provider.keys];
			prefixes.push([...start, ...frame.accessKeys]);
		}
		return new UpdatePath(prefixes.at(-1));
	}
	toUpdatePath() {
		return this.toComponentPath().resolve();
	}
	toString() {
		return this.frames.join("") || "·";
	}
	sourceKeyIn(receiver) {
		let i = receiver.frames.length;
		if (i >= this.frames.length) return null;
		while (i < this.frames.length - 1 && !this.frames[i].isComponent) i++;
		return this.frames[i].item;
	}
}
export class Selector {
	constructor(ops = []) {
		this.ops = ops;
	}
	toString() {
		return this.ops.map(opText).join("") || "·";
	}
	freeze(value) {
		const frames = [];
		for (const op of this.ops) {
			const item = op.t === "item" ? op.key : op.t === "seqItem" ? value[op.keyName] : null;
			const frame = new Frame([op.name], item ?? null, null, true);
			frames.push(frame);
			value = new UpdatePath(frame.accessKeys).getIn(value);
		}
		return frames;
	}
}
export class Target {
	constructor(base, selector = new Selector()) {
		this.base = base;
		this.selector = selector;
	}
	freeze(root) {
		return this.base.concat(this.selector.freeze(this.base.resolve().getIn(root)));
	}
}
const routeFor = (path) => ({ path, updatePath: path.toUpdatePath() });
class PathBuilder {
	constructor() {
		this.ops = [];
	}
	item(name, key) {
		return this.add({ t: "item", name, key });
	}
	field(name) {
		return this.add({ t: "field", name });
	}
	seqItem(name, keyName) {
		return this.add({ t: "seqItem", name, keyName });
	}
	add(op) {
		this.ops.push(op);
		return this;
	}
}
export const selectorFrom = (fn, self) => {
	const pb = new PathBuilder();
	fn.call(self, pb);
	return new Selector(pb.ops);
};
const wrapMeta = (meta, node) => [metaOpen(meta), node, META_END];
const META_TYPES = new Set(["component", "frame"]);
function* enclosingNodeMeta(node) {
	let closed = 0;
	for (let n = node.previousSibling; n; n = n.previousSibling) {
		if (n.nodeType !== 8) continue;
		const data = n.data;
		if (data === META_CLOSE) {
			closed++;
			continue;
		}
		if (!isMetaOpen(data)) continue;
		if (closed > 0) {
			closed--;
			continue;
		}
		let meta;
		try {
			meta = parseMeta(data);
		} catch (err) {
			console.error("bad meta comment", err, n, node);
			continue;
		}
		if (META_TYPES.has(meta?.t)) yield meta; // Skip look-alike comments from unmanaged DOM.
	}
}
const getEventInfoFor = (e, rootNode, rootComponent) => {
	let node = e.target;
	let foundComponent = false;
	const eids = [];
	const scopes = [];
	while (node && node !== rootNode) {
		if (!foundComponent) {
			const eid = node.dataset?.eid;
			if (eid !== undefined) {
				eids.push([parseInt(eid, 10), node]);
			}
		}
		for (const meta of enclosingNodeMeta(node)) {
			scopes.push(meta);
			if (meta.t === "component") foundComponent = true;
		}
		node = node.parentNode;
	}
	if (node !== rootNode || !foundComponent || eids.length === 0) return null;
	const frames = [];
	for (const meta of scopes.reverse()) {
		if (meta.t === "frame") frames.push(Frame.fromMeta(meta));
		else if (frames.length > 0) frames.push(frames.pop().asComponent());
	}
	const path = new DispatchPath(frames);
	const route = routeFor(path);
	const instance = route.updatePath.getIn(rootComponent);
	const { eventHandlers } = specOf(instance);
	for (const [eid, node] of eids) {
		for (const handler of eventHandlers.get(eid) ?? []) {
			if (handler.name === e.type) {
				return { handler, route, node };
			}
		}
	}
	return null;
};
export class MessageContext {
	constructor(task, path, pushTask) {
		this.task = task;
		this.path = path.toComponentPath();
		this.pushTask = pushTask;
		this.event = task.event;
		this.node = task.node ?? null; // The element whose handler an event task runs.
		this.sourceKey = task.sourcePath.sourceKeyIn(this.path);
		this.isStopNextSet = false;
		this.handled = null; // { message, args } once a handler runs.
		this.emitted = []; // { kind, name, args } the handler sent, for the message's emits.
	}
	notify(name, args = []) {
		this.emitted.push({ kind: "notify", name, args });
		if (this.path.isRootPath) return;
		this.push(NotifyTask, name, args, new Target(this.path.toParentPath()));
	}
	ask(name, args = []) {
		this.emitted.push({ kind: "ask", name, args });
		this.push(AskTask, name, args, new Target(this.path));
	}
	stopNext() {
		this.isStopNextSet = true;
	}
	sendAt(name, args, pathBuilderFn) {
		this.emitted.push({ kind: "sendAt", name, args });
		this.push(Task, name, args, new Target(this.path, selectorFrom(pathBuilderFn)));
	}
	forwardAt(pathBuilderFn) {
		this.sendAt(this.task.name, this.task.args, pathBuilderFn);
	}
	push(TaskClass, name, args, target) {
		this.pushTask(new TaskClass(name, args, this.path, target, this.task));
	}
}
export class Task {
	constructor(name, args, sourcePath, target, parent) {
		this.name = name;
		this.args = args;
		this.sourcePath = sourcePath;
		this.target = target;
		this.parent = parent;
		this.event = null;
		this.route = null;
	}
	run(instance, draft, ctx) {
		return run(instance, draft, this.name, this.args, ctx);
	}
}
export class NotifyTask extends Task {
	run(instance, draft, ctx) {
		const result = super.run(instance, draft, ctx);
		if (ctx.path.isRootPath || ctx.isStopNextSet) return result;
		const { name, args, sourcePath } = this;
		ctx.pushTask(new NotifyTask(name, args, sourcePath, new Target(ctx.path.toParentPath()), this));
		return result;
	}
}
export class AskTask extends Task {
	run(instance, draft, ctx) {
		const handler = scopeOf(instance)?.lookupAskHandler(this.name);
		if (!handler) {
			return run(instance, draft, `${this.name}HandlerNotFound`, [], ctx);
		}
		const okName = `${this.name}ReplyOk`;
		const errName = `${this.name}ReplyError`;
		try {
			const result = handler(this.args, ctx);
			if (result instanceof Promise) {
				const reply = (name, args) => ctx.pushTask(this.makeReply(name, args));
				result.then((r) => reply(okName, [r])).catch((error) => reply(errName, [error]));
				return draft;
			}
			return run(instance, draft, okName, [result], ctx);
		} catch (err) {
			return run(instance, draft, errName, [err], ctx);
		}
	}
	makeReply(name, args) {
		const reply = new Task(name, args, this.sourcePath, new Target(this.sourcePath), this);
		reply.route = routeFor(this.sourcePath);
		return reply;
	}
}
export class EventTask extends Task {
	constructor(e, { handler, route, node = null }) {
		super(handler.action.name, [], route.path, new Target(route.path), null);
		this.event = e;
		this.node = node;
		this.handler = handler;
		this.route = route;
	}
	run(instance, draft, ctx) {
		this.args = this.handler.action.args.map((arg) => arg.eval(ctx));
		return call(specOf(instance).on[this.name], instance, draft, this.args, ctx);
	}
}
export class Scope {
	constructor(onRegister, parent = null) {
		this.onRegister = onRegister;
		this.parent = parent;
		this.byName = Object.create(null);
		this.askHandlers = Object.create(null);
		this.components = new Proxy(Object.create(null), {
			get: (_target, name) => this.factory(name),
		});
	}
	enter() {
		return new Scope(this.onRegister, this);
	}
	register(comps) {
		const factories = {};
		for (const name in comps) {
			const spec = comps[name];
			this.byName[name] = spec;
			this.onRegister(spec, name);
			factories[name] = this.factory(name);
		}
		return factories;
	}
	factory(name) {
		return (args) => this.make(name, args);
	}
	lookup(getter) {
		let scope = this;
		while (scope !== null) {
			const v = getter(scope);
			if (v !== undefined) return v;
			scope = scope.parent;
		}
		return null;
	}
	registerAskHandlers(handlers) {
		Object.assign(this.askHandlers, handlers);
	}
	lookupAskHandler(name) {
		return this.lookup((scope) => scope.askHandlers[name]);
	}
	lookupByName(name) {
		return this.lookup((scope) => scope.byName[name]);
	}
	// Every spec registered here or in a parent, by name; inner registrations win.
	allSpecs() {
		const specs = {};
		for (let s = this; s !== null; s = s.parent) {
			for (const name in s.byName) specs[name] ??= s.byName[name];
		}
		return specs;
	}
	make(name, args) {
		const spec = this.lookupByName(name);
		if (spec === null) throw new Error(`Component ${String(name)} is not registered`);
		return spec.make(args, this);
	}
}
export class Host {
	constructor({ document, rootNode, dev = false }) {
		this.document = document;
		this.rootNode = rootNode;
		this.dev = dev; // Check the state against the schemas on start and after each task.
		this.rootComponent = null;
		this.registrations = new Set();
		this.componentNames = new Set(); // In any scope, aliases included.
		this.tasks = [];
		this.scope = new Scope((spec, name) => {
			this.registrations.add(spec);
			this.componentNames.add(name);
			this.addEventListeners(spec.eventNames);
		});
		this.onNotify = (_type, _info) => {};
		this.pushTask = this.pushTask.bind(this);
		this.handleTasks = this.handleTasks.bind(this);
		this._curVDom = null;
		this._settledRoot = null; // The root as of the last empty queue, for checkSettled.
		this._taskTickTimeoutId = null;
		this._handlingTasks = false;
		this._eventsAdded = new Set();
	}
	start(rootComponent) {
		this.rootComponent = rootComponent;
		this._settledRoot = rootComponent;
		this.checkState(null, null);
		this.render();
	}
	checkState(task, prevRoot) {
		if (!this.dev) return;
		// A task can leave invariants broken for the tasks it queued, so they wait for checkSettled.
		const check = { fields: true, invariants: task === null };
		const issues = findInvalidFields(this.rootComponent, prevRoot, check);
		if (issues.length > 0) this.notify("stateInvalid", { task, issues });
	}
	// Dev mode: once the queue is empty, check the invariants of what changed since it last was.
	checkSettled() {
		if (!this.dev || this._settledRoot === this.rootComponent) return;
		const check = { fields: false, invariants: true };
		const issues = findInvalidFields(this.rootComponent, this._settledRoot, check);
		this._settledRoot = this.rootComponent;
		if (issues.length > 0) this.notify("stateInvalid", { task: null, settled: true, issues });
	}
	checkMessage(task, ctx, prev, next) {
		if (!this.dev || ctx.handled === null) return;
		const { message, args } = ctx.handled;
		const issues = messageIssues(message, prev, next, args, ctx);
		if (issues.length > 0) this.notify("messageInvalid", { task, message: message.name, issues });
	}
	render() {
		const ctx = RenderContext.root(this.rootComponent);
		const curVDom = this._curVDom;
		const newVDom = toVChilds(renderView(this.rootComponent, ctx));
		$render(this.document, this.rootNode, newVDom, curVDom);
		this._curVDom = newVDom;
		this.notify("render", { ctx, newVDom, curVDom });
	}
	handleEvent(e) {
		if (this.rootComponent === null) return;
		const info = getEventInfoFor(e, this.rootNode, this.rootComponent);
		if (info === null) return;
		this.pushTask(new EventTask(e, info));
		this.handleTasks();
	}
	addEventListeners(eventNames) {
		for (const eventName of eventNames) {
			if (this._eventsAdded.has(eventName)) continue;
			this._eventsAdded.add(eventName);
			this.rootNode.addEventListener(eventName, this);
		}
	}
	pushTask(task) {
		this.tasks.push(task);
		if (!this._handlingTasks) this.scheduleNextTaskTick();
	}
	scheduleNextTaskTick() {
		if (this._taskTickTimeoutId !== null) return;
		this._taskTickTimeoutId = setTimeout(this.handleTasks, 0);
	}
	// Drops the queued tasks and the pending tick; an async ask reply in flight still arrives.
	clearTasks() {
		this.tasks.length = 0;
		clearTimeout(this._taskTickTimeoutId);
		this._taskTickTimeoutId = null;
	}
	// Stops handling events and tasks: handleEvent ignores events without a root.
	stop() {
		this.clearTasks();
		this.rootComponent = null;
	}
	handleTasks() {
		if (this._handlingTasks) return;
		this._handlingTasks = true;
		clearTimeout(this._taskTickTimeoutId);
		this._taskTickTimeoutId = null;
		const t1 = Date.now();
		const oldRootComponent = this.rootComponent;
		try {
			while (this.tasks.length > 0) {
				const task = this.tasks.shift();
				try {
					this.handleTask(task);
				} catch (error) {
					this.notify("taskFailed", { task, error });
				}
				if (Date.now() - t1 > 16) break;
			}
		} finally {
			try {
				if (oldRootComponent !== this.rootComponent) this.render();
			} finally {
				this._handlingTasks = false;
				if (this.tasks.length > 0) this.scheduleNextTaskTick();
				else this.checkSettled();
			}
		}
	}
	prepareTask(task, root) {
		if (task.route !== null) return;
		task.route = routeFor(task.target.freeze(root));
	}
	handleTask(task) {
		const curRoot = this.rootComponent;
		const { route } = task;
		const path = route.updatePath;
		const instance = path.getIn(curRoot);
		const children = [];
		let status = "pending";
		// The context can outlive this transaction (e.g. an ask reply). Only pending
		// children are staged; later messages enqueue normally after a successful commit.
		const pushTask = (child) => {
			if (status === "pending") children.push(child);
			else if (status === "committed") {
				this.prepareTask(child, this.rootComponent);
				this.pushTask(child);
			}
		};
		let newRoot;
		let ctx;
		try {
			newRoot = produce(curRoot, (rootDraft) => {
				const leafDraft = path.getIn(rootDraft);
				ctx = new MessageContext(task, route.path, pushTask);
				const newLeaf = task.run(instance, leafDraft, ctx);
				return path.setIn(rootDraft, newLeaf);
			});
			for (const child of children) this.prepareTask(child, newRoot);
		} catch (error) {
			status = "failed";
			children.length = 0;
			throw error;
		}
		this.rootComponent = newRoot;
		status = "committed";
		for (const child of children) this.pushTask(child);
		children.length = 0;
		this.checkState(task, curRoot);
		this.checkMessage(task, ctx, instance, path.getIn(newRoot));
		this.notify("taskHandled", { task, path, instance, curRoot, newRoot });
	}
	notify(type, info) {
		setTimeout(() => this.onNotify(type, info), 0);
	}
}

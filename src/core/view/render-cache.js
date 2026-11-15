// Render caches: what renderView rendered for an instance, kept so the next render reuses it
// when nothing it depends on changed (docs/render-cache.md).
//
// A component's render is a function of its instance (immutable: an unchanged one is the same
// object), the view picked for it, the view stack its descendants inherit and the provided values
// read anywhere in its subtree, as values. Not of where it is, or of where their providers are:
// the frames that say where it is wrap it, a frame inside it names the provided value it reads
// and the component that provides it says where it is (markers.js). What's
// provided is tracked as it's read (RenderContext.readProvided) and bubbles up from each
// component to its parent, less the names the component provides itself: reads of those below
// it are of its own provides.
//
// A RenderCache is what a render asks; NullCache keeps nothing, and the two DepsCaches keep
// entries their own way: WeakMapCache by instance, as long as the instance lives, CopyCache as a
// tree of the last render's entries, dropping what that render didn't reach. CheckCache
// (src/dev/check-cache.js) checks one against an uncached render.
import { wrapComponent } from "./markers.js";
import { Walker } from "./walk.js";

export const NO_DEPS = [];

// What a render asks of its cache. The host calls begin and end around each render; renderView
// calls render for every component and loops call fragment for every renderEach item.
export class RenderCache {
	// Whether renders compute ctx.slot, a component's position under its parent.
	get usesSlots() {
		return false;
	}
	// What the root's ctx starts with as cacheScope.
	get scope() {
		return null;
	}
	begin() {}
	// The render of root (for target) made vdom.
	end(_root, _target, _vdom) {}
	// instance's view in ctx, between its component markers.
	render(_instance, _spec, _view, _ctx) {
		throw new Error("RenderCache.render is abstract");
	}
	// A renderEach item's fragment: make() makes it, from wrapped (its frame's comments around
	// result, what render returned for the item).
	fragment(_result, _wrapped, _key, make) {
		return make();
	}
}

// Renders everything, keeps nothing.
export class NullCache extends RenderCache {
	render(instance, spec, view, ctx) {
		const provides = providesIn(spec, ctx);
		if (ctx.deps === null) {
			return wrapComponent(view.eval(ctx.with({ component: instance })), provides);
		}
		// Inside a render that collects what's read (DepsWalker's fallback).
		const deps = [];
		const result = wrapComponent(view.eval(ctx.with({ component: instance, deps })), provides);
		mergeDeps(ctx, ownDeps(spec, deps));
		return result;
	}
}
export const NULL_CACHE = new NullCache();

// When a place's deps changed this many renders in a row, its renders stop being kept (they'd
// be dropped on the next one, which costs the GC more than rendering), but for one in RETRY.
const THRASH = 2;
const RETRY = 16;

const sameStack = (a, b) => {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};
// Two provided entries render the same: the same value, wherever each provider is.
export const sameProvided = (a, b) =>
	a === b || (a !== undefined && b !== undefined && a.value === b.value);
const depsHold = (entry, ctx) => {
	const { deps } = entry;
	for (let i = 0; i < deps.length; i++) {
		if (!sameProvided(deps[i][1], ctx.provided[deps[i][0]])) return false;
	}
	return true;
};
// Whether entry is of a render of view with ctx's view stack, wherever it was.
export const samePlace = (e, view, ctx) => e.view === view && sameStack(e.viewStack, ctx.viewStack);
const placeIndex = (entries, view, ctx) => {
	for (let i = 0; i < entries.length; i++) if (samePlace(entries[i], view, ctx)) return i;
	return -1;
};
const inPlace = (entries, view, ctx) => {
	if (entries === undefined) return null;
	const i = placeIndex(entries, view, ctx);
	return i === -1 ? null : entries[i];
};

// A cache of entries, { instance, view, viewStack, deps, result, misses, fragment,
// children }: deps the [name, entry] pairs the subtree read, result null when it isn't kept
// (churn), fragment the loop item fragment the result was last wrapped in and children what
// CopyCache keeps of the components it rendered. Subclasses say where entries live:
// find(instance, view, ctx) is { hit, old }, hit the entry of instance in this place, old the
// entry at its position to inherit children from (CopyCache); keep(entry, ctx, isHit) keeps it
// for this render; childScope(entry, old) is the cacheScope its children render with.
// trace, when set (CheckCache), gets every entry a render hit or made.
export class DepsCache extends RenderCache {
	last = null; // The entry render just returned the result of, for fragment.
	trace = null;
	begin() {
		this.last = null;
	}
	render(instance, spec, view, ctx) {
		const { hit, old } = this.find(instance, view, ctx);
		const stable = hit !== null && depsHold(hit, ctx);
		if (stable && hit.result !== null) {
			hit.misses = 0;
			this.keep(hit, ctx, true);
			this.trace?.push(hit);
			this.last = hit;
			mergeDeps(ctx, hit.deps);
			return hit.result;
		}
		const { readsProvided, rendersChildren } = viewFacts(view);
		// OPT: a view that reads nothing provided and renders no components depends on nothing.
		const deps = readsProvided || rendersChildren ? [] : null;
		const { viewStack } = ctx;
		const children = rendersChildren ? this.newChildren() : null;
		const misses = hit === null || stable ? 0 : hit.misses + 1;
		const entry = { instance, view, viewStack, deps: NO_DEPS, result: null, misses };
		entry.fragment = null;
		entry.children = children;
		const cacheScope = this.childScope(entry, old);
		const result = wrapComponent(
			view.eval(ctx.with({ component: instance, deps, slot: "", cacheScope })),
			providesIn(spec, ctx),
		);
		entry.deps = deps === null ? NO_DEPS : ownDeps(spec, deps);
		mergeDeps(ctx, entry.deps);
		if (misses < THRASH || misses % RETRY === 0) entry.result = result;
		this.keep(entry, ctx, false);
		this.trace?.push(entry);
		this.last = entry.result === null ? null : entry;
		return result;
	}
	newChildren() {
		return null;
	}
	childScope(_entry, _old) {
		return null;
	}
	// A loop item's fragment: the one it had when the component rendered in it (result, what
	// render just returned) was in the same frame with the same key, so morph skips it.
	fragment(result, wrapped, key, make) {
		const entry = this.last;
		if (entry === null || entry.result !== result) return make();
		const prev = entry.fragment;
		const k = key != null ? String(key) : undefined;
		if (prev !== null && prev.key === k && prev.children[0].text === wrapped[0].text) return prev;
		entry.fragment = make();
		return entry.fragment;
	}
}

// How many places an instance keeps renders for in a WeakMapCache: the same instance rendered
// in more places than this renders again in some of them.
const MAX_ENTRIES = 8;
// Entries by instance, one per place it rendered in, for as long as the instance lives: an
// instance rendered again after a while (a tab shown again) renders what it rendered then.
export class WeakMapCache extends DepsCache {
	entries = new WeakMap(); // instance -> entries
	find(instance, view, ctx) {
		return { hit: inPlace(this.entries.get(instance), view, ctx), old: null };
	}
	keep(entry, ctx, isHit) {
		if (isHit) return;
		const entries = this.entries.get(entry.instance);
		if (entries === undefined) return void this.entries.set(entry.instance, [entry]);
		const i = placeIndex(entries, entry.view, ctx);
		if (i !== -1) entries[i] = entry;
		else {
			if (entries.length >= MAX_ENTRIES) entries.shift();
			entries.push(entry);
		}
	}
}

// What a CopyCache entry keeps of the components its render rendered: by instance, to find an
// unchanged one wherever it moved among them, and by slot (its frames from the entry's
// component), to find what was in a changed one's position.
// A key's value is its entry, or an array of them when there are more (an instance rendered in
// two places): one is the rule, and an array for each would be most of what a render allocates.
const newChildren = () => ({ byInstance: new Map(), bySlot: new Map() });
const EMPTY_CHILDREN = Object.freeze({ byInstance: new Map(), bySlot: new Map() });
const push = (map, key, entry) => {
	const had = map.get(key);
	if (had === undefined) map.set(key, entry);
	else if (Array.isArray(had)) had.push(entry);
	else map.set(key, [had, entry]);
};
const inPlaceOf = (had, view, ctx) => {
	if (had === undefined || Array.isArray(had)) return inPlace(had, view, ctx);
	return samePlace(had, view, ctx) ? had : null;
};
// The last render's entries, as a tree: each render starts an empty one (to) and finds entries
// in the last one (from). A hit moves the old entry, its subtree with it, by pointer; a miss
// makes a new one whose children are found among the children of the entry at its position.
// What the render didn't reach goes with the last tree, so memory is the current render's; an
// instance shown again after a render without it (a tab switched back) renders again.
export class CopyCache extends DepsCache {
	tree = EMPTY_CHILDREN; // The root's children as the last render left them.
	_scope = null;
	get usesSlots() {
		return true;
	}
	get scope() {
		return this._scope;
	}
	begin() {
		super.begin();
		this._scope = { from: this.tree, to: newChildren() };
	}
	end(root, target, vdom) {
		super.end(root, target, vdom);
		this.tree = this._scope.to;
	}
	find(instance, view, ctx) {
		const { from } = ctx.cacheScope;
		const hit = inPlaceOf(from.byInstance.get(instance), view, ctx);
		return { hit, old: hit ?? inPlaceOf(from.bySlot.get(ctx.slot), view, ctx) };
	}
	keep(entry, ctx) {
		const { to } = ctx.cacheScope;
		push(to.byInstance, entry.instance, entry);
		push(to.bySlot, ctx.slot, entry);
	}
	newChildren() {
		return newChildren();
	}
	childScope(entry, old) {
		if (entry.children === null) return null;
		return { from: old?.children ?? EMPTY_CHILDREN, to: entry.children };
	}
}
// Notes that name was read as entry: deps are few, a scan is cheaper than a Map.
export const addDep = (deps, name, entry) => {
	for (let i = 0; i < deps.length; i++) if (deps[i][0] === name) return;
	deps.push([name, entry]);
};
// The deps a component's subtree read, less the names it provides itself.
export const ownDeps = (spec, deps) => {
	if (deps.length === 0) return NO_DEPS;
	const { provides } = spec;
	if (!providesAny(provides)) return deps;
	const own = deps.filter((pair) => !(pair[0] in provides));
	return own.length === 0 ? NO_DEPS : own;
};
// Whether a spec's provides names anything.
export const providesAny = (provides) => {
	for (const _ in provides) return true;
	return false;
};
// Where each value a component provides is in it, { name: keys }, as ctx, the one the component
// was entered with, has them; null when it provides nothing. It follows from the instance.
export const providesIn = (spec, ctx) => {
	const { provides } = spec;
	if (!providesAny(provides)) return null;
	const keysOf = {};
	for (const name in provides) keysOf[name] = ctx.provided[name].keys;
	return keysOf;
};
// A child's deps are its parent's too.
export const mergeDeps = (ctx, deps) => {
	if (ctx.deps === null) return;
	for (let i = 0; i < deps.length; i++) addDep(ctx.deps, deps[i][0], deps[i][1]);
};
// What a view's tree holds, statically: whether it reads provided values and whether it renders
// components. Handlers are left out: they're evaluated when an event arrives, not to render.
const FACTS = new WeakMap();
const NO_FACTS = Object.freeze({ readsProvided: false, rendersChildren: false });
const READS = Object.freeze({ readsProvided: true, rendersChildren: false });
const RENDERS = Object.freeze({ readsProvided: false, rendersChildren: true });
const union = (a, b) =>
	a === NO_FACTS || a === b
		? b
		: b === NO_FACTS
			? a
			: {
					readsProvided: a.readsProvided || b.readsProvided,
					rendersChildren: a.rendersChildren || b.rendersChildren,
				};
class FactsWalker extends Walker {
	visit(node) {
		return viewFacts(node);
	}
	all(nodes) {
		let facts = NO_FACTS;
		for (const n of nodes) facts = union(facts, this.visit(n));
		return facts;
	}
	node(node) {
		return this.all(node.childNodes());
	}
	element(node) {
		return this.all([...node.attrs.map(([, value]) => value), ...node.children]);
	}
	provided(_node) {
		return READS;
	}
	render(node) {
		return union(RENDERS, this.node(node));
	}
	renderEach(node) {
		return union(RENDERS, this.node(node));
	}
}
const factsWalker = new FactsWalker();
// { readsProvided, rendersChildren } for node's tree, computed once per node.
export const viewFacts = (node) => {
	let facts = FACTS.get(node);
	if (facts === undefined) {
		facts = factsWalker.dispatch(node.constructor.kind, node) ?? NO_FACTS;
		FACTS.set(node, facts);
	}
	return facts;
};

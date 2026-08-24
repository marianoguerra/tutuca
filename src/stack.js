export const STOP = Symbol("STOP");
export const NEXT = Symbol("NEXT");
// The route a bare lookup takes: the render ancestry, then the registration scope.
// Written down HERE and nowhere else, the same way DEFAULT_ROUTE is for intents — and
// deliberately the same legs, in the same order, so "where does a name come from" has
// one answer whether the name is a value, a type, or a job.
export const DEFAULT_LOOKUP_ROUTE = ["dyn", "lex"];
// Walk a route's legs in order; the first one that resolves wins. Matches the intent
// walker's contract: array order is walk order, an unknown leg warns and is skipped,
// and an empty route resolves to null rather than falling back to the default.
export function routeLookup(route, lex, dyn) {
  for (let i = 0; i < route.length; i++) {
    const leg = route[i];
    if (leg === "dyn") {
      const v = dyn();
      if (v != null) return v;
    } else if (leg === "lex") {
      const v = lex();
      if (v != null) return v;
    } else {
      console.warn("unknown lookup route leg", leg, '- expected "dyn" or "lex"');
    }
  }
  return null;
}
export function lookup(chain, name, dv = null) {
  let n = chain;
  while (n !== null) {
    const r = n[0].lookup(name);
    if (r === STOP) return dv;
    if (r !== NEXT) return r;
    n = n[1];
  }
  return dv;
}
export class BindFrame {
  constructor(it, binds, isFrame) {
    this.it = it;
    this.binds = binds;
    this.isFrame = isFrame;
  }
  lookup(name) {
    const v = this.binds[name];
    return v === undefined ? (this.isFrame ? STOP : NEXT) : v;
  }
}
export class ObjectFrame {
  constructor(binds) {
    this.binds = binds;
  }
  lookup(key) {
    const v = this.binds[key];
    return v === undefined ? NEXT : v;
  }
}
function computeViewsId(views) {
  let s = "";
  let n = views;
  while (n !== null) {
    s += n[0];
    n = n[1];
  }
  return s === "main" ? "" : s;
}
export class Stack {
  constructor(comps, it, binds, dynBinds, views, viewsId, ctx = null) {
    this.comps = comps;
    this.it = it;
    this.binds = binds;
    this.dynBinds = dynBinds;
    this.views = views;
    this.viewsId = viewsId;
    this.ctx = ctx;
  }
  // Evaluate every provide the entered component publishes and push them as one
  // dynBinds frame, keyed by NAME. Published types go in the same frame: a type name
  // starts A-Z and a value name does not, so the two namespaces cannot collide and
  // nearest-ancestor-wins falls out of frame order for both. No-op with no provides.
  _pushProvides() {
    const comp = this.comps.getCompFor(this.it);
    if (comp == null) return this;
    const { provide, provideType } = comp;
    const dynObj = {};
    let has = false;
    for (const k in provide) {
      dynObj[k] = provide[k].val.eval(this);
      has = true;
    }
    for (const k in provideType) {
      dynObj[k] = provideType[k];
      has = true;
    }
    if (!has) return this;
    const newDynBinds = [new ObjectFrame(dynObj), this.dynBinds];
    const { comps, it, binds, views, viewsId, ctx } = this;
    return new Stack(comps, it, binds, newDynBinds, views, viewsId, ctx);
  }
  static root(comps, it, ctx) {
    const binds = [new BindFrame(it, {}, true), null];
    const dynBinds = [new ObjectFrame({}), null];
    const views = ["main", null];
    return new Stack(comps, it, binds, dynBinds, views, "", ctx)._pushProvides();
  }
  enter(it, bindings = {}, isFrame = true) {
    const { comps, binds, dynBinds, views, viewsId, ctx } = this;
    const newBinds = [new BindFrame(it, bindings, isFrame), binds];
    const stack = new Stack(comps, it, newBinds, dynBinds, views, viewsId, ctx);
    return isFrame ? stack._pushProvides() : stack;
  }
  pushViewName(name) {
    const { comps, it, binds, dynBinds, views, ctx } = this;
    const newViews = [name, views];
    return new Stack(comps, it, binds, dynBinds, newViews, computeViewsId(newViews), ctx);
  }
  // Published types are stable per scope and would only churn the render cache, so
  // the cache key covers values alone.
  _pushDynBindValuesToArray(arr, comp) {
    for (const k in comp.provide) arr.push(this.lookupDynamic(k));
    for (const k in comp.lookup) arr.push(this.lookupDynamic(k));
  }
  // `*name`: the nearest binding above (including this component's own provides,
  // pushed on entering it), else this component's declared default, else null.
  lookupDynamic(name) {
    const v = lookup(this.dynBinds, name);
    if (v != null) return v;
    const comp = this.comps.getCompFor(this.it);
    return comp?.lookup[name]?.val?.eval(this) ?? null;
  }
  lookupBind(name) {
    return lookup(this.binds, name);
  }
  // The `lex` leg: what a name means in the registration scope of the component being
  // rendered. The scope chain holds components, so this leg only ever answers for a
  // type name — for a value name it is a miss, which is why one default route serves
  // both. Guarded: a non-component `it` has no scope to ask.
  _lookupLex(name) {
    return this.comps.getCompFor(this.it)?.scope.lookupComponent(name) ?? null;
  }
  lookupRouted(name, route = DEFAULT_LOOKUP_ROUTE) {
    return routeLookup(
      route,
      () => this._lookupLex(name),
      () => this.lookupDynamic(name),
    );
  }
  lookupFieldRaw(name) {
    return this.it[name] ?? null;
  }
  lookupMethod(name) {
    const fn = this.it[name];
    return fn instanceof Function ? fn.call(this.it) : null;
  }
  // The dispatched DOM event / drag info, read only by EventMemberVal's
  // `e.<member>` handler args. Null outside a live event transaction.
  lookupEvent() {
    return this.ctx?.event ?? null;
  }
  lookupDragInfo() {
    return this.ctx?.dragInfo ?? null;
  }
  getHandlerFor(name, key) {
    return this.comps.getHandlerFor(this.it, name, key);
  }
  lookupBestView(views, defaultViewName) {
    let n = this.views;
    while (n !== null) {
      const view = views[n[0]];
      if (view !== undefined) return view;
      n = n[1];
    }
    return views[defaultViewName];
  }
}

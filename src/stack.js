export const STOP = Symbol("STOP");
export const NEXT = Symbol("NEXT");
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
  // dynBinds frame (keyed by each provide's symbol). No-op when there are no provides.
  _pushProvides() {
    const provide = this.comps.getCompFor(this.it)?.provide;
    if (provide == null) return this;
    const dynObj = {};
    let has = false;
    for (const k in provide) {
      dynObj[provide[k].symbol] = provide[k].val.eval(this);
      has = true;
    }
    if (!has) return this;
    const newDynBinds = [new ObjectFrame(dynObj), this.dynBinds];
    const { comps, it, binds, views, viewsId, ctx } = this;
    return new Stack(comps, it, binds, newDynBinds, views, viewsId, ctx);
  }
  static root(comps, it, ctx) {
    const binds = [new BindFrame(it, { it }, true), null];
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
  _pushDynBindValuesToArray(arr, comp) {
    for (const k in comp.provide) arr.push(this._lookupProvide(comp.provide[k]));
    for (const k in comp.lookup) arr.push(this._lookupAlias(comp.lookup[k]));
  }
  _lookupProvide(p) {
    return lookup(this.dynBinds, p.symbol) ?? p.val.eval(this) ?? null;
  }
  _lookupAlias(lk) {
    const sym = lk.getProducerSymbol(this);
    return (sym != null ? lookup(this.dynBinds, sym) : null) ?? lk.val?.eval(this) ?? null;
  }
  lookupDynamic(name) {
    const comp = this.comps.getCompFor(this.it);
    if (comp == null) return null;
    const lk = comp.lookup[name];
    if (lk !== undefined) return this._lookupAlias(lk);
    const p = comp.provide[name];
    return p !== undefined ? this._lookupProvide(p) : null;
  }
  lookupBind(name) {
    return lookup(this.binds, name);
  }
  lookupType(name) {
    return this.comps.getCompFor(this.it).scope.lookupComponent(name);
  }
  lookupFieldRaw(name) {
    return this.it[name] ?? null;
  }
  lookupMethod(name) {
    const fn = this.it[name];
    return fn instanceof Function ? fn.call(this.it) : null;
  }
  lookupName(name) {
    return this.ctx.lookupName(name);
  }
  getHandlerFor(name, key) {
    return this.comps.getHandlerFor(this.it, name, key);
  }
  lookupRequest(name) {
    return this.comps.getRequestFor(this.it, name);
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

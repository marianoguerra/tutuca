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
  constructor(it, bindings, isFrame) {
    this.it = it;
    this.bindings = bindings;
    this.isFrame = isFrame;
  }
  lookup(name) {
    const v = this.bindings[name];
    return v === undefined ? (this.isFrame ? STOP : NEXT) : v;
  }
}
export class ObjectFrame {
  constructor(bindings) {
    this.bindings = bindings;
  }
  lookup(key) {
    const v = this.bindings[key];
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
  _enrichOnEnter() {
    return this.comps.getOnEnterFor(this.it).call(this.it, this) ?? this;
  }
  upToFrameBinds() {
    const { comps, binds, dynBinds, views, viewsId, ctx } = this;
    return binds[0].isFrame // only one !isFrame node possible, next isFrame
      ? this
      : new Stack(comps, binds[1][0].it, binds[1], dynBinds, views, viewsId, ctx);
  }
  static root(comps, it, ctx) {
    const binds = [new BindFrame(it, { it }, true), null];
    const dynBinds = [new ObjectFrame({}), null];
    const views = ["main", null];
    return new Stack(comps, it, binds, dynBinds, views, "", ctx)._enrichOnEnter();
  }
  enter(it, bindings = {}, isFrame = true) {
    const { comps, binds, dynBinds, views, viewsId, ctx } = this;
    const newBinds = [new BindFrame(it, bindings, isFrame), binds];
    return new Stack(comps, it, newBinds, dynBinds, views, viewsId, ctx)._enrichOnEnter();
  }
  pushViewName(name) {
    const { comps, it, binds, dynBinds, views, ctx } = this;
    const newViews = [name, views];
    return new Stack(comps, it, binds, dynBinds, newViews, computeViewsId(newViews), ctx);
  }
  withDynamicBindings(dynamics) {
    const dynObj = {};
    const comp = this.comps.getCompFor(this.it);
    for (const dynName of dynamics) comp.dynamic[dynName].evalAndBind(this, dynObj);
    const { comps, it, binds, views, viewsId, ctx } = this;
    const newDynBinds = [new ObjectFrame(dynObj), this.dynBinds];
    return new Stack(comps, it, binds, newDynBinds, views, viewsId, ctx);
  }
  lookupDynamic(name) {
    const d = this.comps.getCompFor(this.it)?.dynamic[name];
    return d ? (lookup(this.dynBinds, d.getSymbol(this)) ?? d.val.eval(this)) : null;
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
  lookupField(name) {
    const v = this.lookupFieldRaw(name);
    return v instanceof Function ? v.call(this.it) : v;
  }
  lookupName(name) {
    return this.ctx.lookupName(name);
  }
  lookupComputed(name) {
    const node = this.binds[0].isFrame ? this.binds[0] : this.binds[1][0];
    return this.comps.lookupComputed(node.it, name);
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

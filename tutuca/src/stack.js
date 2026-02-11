export const STOP = Symbol("STOP");
export const NEXT = Symbol("NEXT");
export class Pair {
  constructor(head, tail) {
    this.head = head;
    this.tail = tail;
  }
  push(v) {
    return new Pair(v, this);
  }
  lookup(v, dv = null) {
    const { tail } = this;
    const r = this.head.lookup(v);
    return r === STOP ? dv : r === NEXT ? (tail !== null ? tail.lookup(v, dv) : dv) : r;
  }
  *[Symbol.iterator]() {
    let v = this;
    while (v !== null) {
      yield v.head;
      v = v.tail;
    }
  }
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
export class Stack {
  constructor(comps, it, binds, dynBinds, views, ctx = null) {
    this.comps = comps;
    this.it = it;
    this.binds = binds;
    this.dynBinds = dynBinds;
    this.views = views;
    this.ctx = ctx;
    const viewsId = [...views].join("");
    this.viewsId = viewsId === "main" ? "" : viewsId;
  }
  _enrichOnEnter() {
    return this.comps.getOnEnterFor(this.it).call(this.it, this) ?? this;
  }
  upToFrameBinds() {
    const { comps, binds, dynBinds, views, ctx } = this;
    return binds.head.isFrame
      ? this
      : new Stack(comps, binds.tail.head.it, binds.tail, dynBinds, views, ctx);
  }
  static root(comps, it, ctx) {
    const binds = new Pair(new BindFrame(it, { it }, true), null);
    const dynBinds = new Pair(new ObjectFrame({}), null);
    const views = new Pair("main", null);
    return new Stack(comps, it, binds, dynBinds, views, ctx)._enrichOnEnter();
  }
  enter(it, bindings = {}, isFrame = true) {
    const { comps, binds, dynBinds, views, ctx } = this;
    const newBinds = binds.push(new BindFrame(it, bindings, isFrame));
    return new Stack(comps, it, newBinds, dynBinds, views, ctx)._enrichOnEnter();
  }
  pushViewName(name) {
    const { comps, it, binds, dynBinds, views, ctx } = this;
    return new Stack(comps, it, binds, dynBinds, views.push(name), ctx);
  }
  withDynamicBindings(dynamics) {
    const dynObj = {};
    const comp = this.comps.getCompFor(this.it);
    for (const dynName of dynamics) {
      comp.dynamic[dynName].evalAndBind(this, dynObj);
    }
    const { comps, it, binds, views, ctx } = this;
    const newDynBinds = this.dynBinds.push(new ObjectFrame(dynObj));
    return new Stack(comps, it, binds, newDynBinds, views, ctx);
  }
  lookupDynamic(name) {
    const d = this.comps.getCompFor(this.it)?.dynamic[name];
    return d ? (this.dynBinds.lookup(d.getSymbol(this)) ?? d.val.eval(this)) : null;
  }
  lookupBind(name) {
    return this.binds.lookup(name);
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
    return this.comps.lookupComputed(this.it, name);
  }
  getInputHandler(name) {
    return this.comps.getInputHandlerFor(this.it, name);
  }
  getAlterHandler(name) {
    return this.comps.getAlterHandlerFor(this.it, name);
  }
  lookupRequest(name) {
    return this.comps.getRequestFor(this.it, name);
  }
  lookupBestView(views, defaultViewName) {
    for (const viewName of this.views) {
      const view = views[viewName];
      if (view !== undefined) {
        return view;
      }
    }
    return views[defaultViewName];
  }
}

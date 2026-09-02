import { DispatchPath } from "./path.js";

export const STOP = Symbol("STOP");
export const NEXT = Symbol("NEXT");
// The route a routeless name takes: the render ancestry (dyn), then the registration
// scope (lex). Written down HERE and nowhere else — ctx.lookup, ctx.lookupType and
// ctx.intent all default to it, so "where does a name come from" has one answer
// whether the name is a value, a type, or a job.
export const DEFAULT_ROUTE = ["dyn", "lex"];
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
// A name starting A-Z is a component TYPE, anything else is a value. The one rule
// that partitions the dynamic-binding keyspace, so types and values can share a
// frame without ever colliding. Mirrored in tools/core/lint-check.js.
export const isTypeName = (s) => {
  const c = s.charCodeAt(0);
  return c >= 65 && c <= 90;
};
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
// What a component publishes, pushed on entering it and popped with it.
//
// Two maps and not one: a published VALUE travels with the absolute path it lives
// at (`{ value, path }`), because a `*name` render target resumes THERE; a
// published TYPE is a Class, which has no path and can never be a render target.
// `isTypeName` partitions the keyspace, so the two behave as one frame — a name is
// looked for in exactly one of them, and nearest-ancestor-wins falls out of frame
// order for both.
export class DynFrame {
  constructor(binds, types) {
    this.binds = binds;
    this.types = types;
  }
  lookup(name) {
    const v = (isTypeName(name) ? this.types : this.binds)[name];
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
  constructor(fields) {
    Object.assign(this, fields);
  }
  _with(patch) {
    return new Stack({ ...this, ...patch });
  }
  // Evaluate every provide the entered component publishes and push them as one
  // dynBinds frame, keyed by NAME. A value is published together with the absolute
  // path it lives at: the same declaration is read as `*name` AND resumed at by
  // `<x render="*name">`, so a consumer needs both halves. Types go in the same
  // frame's other map. No-op with no provides.
  _pushProvides() {
    const comp = this.comps.getCompFor(this.it);
    if (comp == null) return this;
    const { provide, provideType } = comp;
    const binds = {};
    const types = {};
    let has = false;
    const base = this._publishBase();
    for (const k in provide) {
      // A provide with no path item was already dropped by compile(); the linter
      // reports it as PROVIDE_NOT_ADDRESSABLE.
      const step = provide[k].toPathItem?.() ?? null;
      if (step === null) continue;
      const value = provide[k].eval(this);
      binds[k] = { value, path: base === null ? null : base.concat([step]) };
      has = true;
    }
    for (const k in provideType) {
      types[k] = provideType[k];
      has = true;
    }
    if (!has) return this;
    return this._with({ dynBinds: [new DynFrame(binds, types), this.dynBinds] });
  }
  // The absolute address of the component being entered, or null when this
  // position cannot be written down as one. Frame-only steps carry bindings and
  // address nothing, so they are compacted away first; what is left is checked
  // against the value actually being rendered, because a scope CAN move the
  // render position without contributing an addressing step (a plain `@each`
  // body re-binds `it` to the item while its rebuild step is an identity).
  //
  // A null base still publishes the VALUE — `*name` reads it fine — but there is
  // nowhere to resume, so `<x render="*name">` renders nothing rather than
  // editing whatever happens to live at the address we guessed.
  _publishBase() {
    const base = this.renderPath.toTransactionPath().compact();
    return base.lookup(this.root, NOT_FOUND) === this.it ? base : null;
  }
  static root(comps, it, ctx = null) {
    return new Stack({
      comps,
      root: it,
      it,
      binds: [new BindFrame(it, {}, true), null],
      dynBinds: [new DynFrame({}, {}), null],
      views: ["main", null],
      viewsId: "",
      renderPath: new DispatchPath(),
      pendingFrame: false,
      ctx,
    })._pushProvides();
  }
  // `renderPath` defaults to this stack's own: an ordinary scope does not move.
  // `pendingFrame` clears on a component frame (which emits the base) and is
  // inherited by transparent scopes, which have to carry it to the next boundary.
  enter(it, bindings = {}, isFrame = true, renderPath = this.renderPath, pendingFrame = null) {
    const stack = this._with({
      it,
      binds: [new BindFrame(it, bindings, isFrame), this.binds],
      renderPath,
      pendingFrame: pendingFrame ?? (isFrame ? false : this.pendingFrame),
    });
    return isFrame ? stack._pushProvides() : stack;
  }
  pushViewName(name) {
    const views = [name, this.views];
    return this._with({ views, viewsId: computeViewsId(views) });
  }
  // Published types are stable per scope and would only churn the render cache, so
  // the cache key covers values alone.
  _pushDynBindValuesToArray(arr, comp) {
    for (const k in comp.provide) arr.push(this.lookupDynamic(k));
    for (const k in comp.lookup) arr.push(this.lookupDynamic(k));
  }
  // `*name`: the nearest binding above (including this component's own provides,
  // pushed on entering it), else a path registered in the component's lexical
  // scope, else this component's declared default, else null.
  //
  // One chain walk and no producer resolution: a lookup names what it WANTS, so the
  // frame it wants is keyed by that name. The default belongs to the CONSUMER's
  // declaration and is evaluated against the consumer's stack, which is why it is
  // consulted only after the whole chain has missed.
  lookupDynamicLocated(name) {
    // A published TYPE is a Class: it has no path, so it can never be a render
    // target and `<x render="*Cell">` stays unresolvable by construction.
    if (isTypeName(name)) return null;
    const v = lookup(this.dynBinds, name);
    if (v != null) return v;
    const comp = this.comps.getCompFor(this.it);
    if (comp == null) return null;
    const path = comp.scope?.lookupPath?.(name) ?? null;
    if (path !== null) {
      const value = path.lookup(this.root, NOT_FOUND);
      if (value !== NOT_FOUND) return { value, path };
    }
    const dval = comp.lookup[name] ?? null;
    if (dval === null) return null;
    const step = dval.toPathItem?.() ?? null;
    const value = dval.eval(this);
    // A constant default (`'gray'`) has no path, so it reads fine but cannot be
    // resumed at — `<x render="*name">` falling back to one stays unresolvable.
    return step === null
      ? { value, path: null }
      : { value, path: this.renderPath.toTransactionPath().concat([step]) };
  }
  lookupDynamic(name) {
    if (isTypeName(name)) return lookup(this.dynBinds, name);
    return this.lookupDynamicLocated(name)?.value ?? null;
  }
  lookupBind(name) {
    return lookup(this.binds, name);
  }
  lookupFieldRaw(name) {
    return this.it[name] ?? null;
  }
  lookupMethod(name) {
    const fn = this.it[name];
    return fn instanceof Function ? fn.call(this.it) : null;
  }
  // The dispatched DOM event / drag info, read only by EventMemberVal's
  // `e.<member>` handler args. Null outside a live event transaction (`ctx` is
  // then a send/intent transaction, which carries no `e`).
  lookupEvent() {
    return this.ctx?.e ?? null;
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
const NOT_FOUND = Symbol("NOT_FOUND");

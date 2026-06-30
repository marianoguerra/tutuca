import { View } from "./anode.js";
import { RequestHandler } from "./attribute.js";
import { vp } from "./value.js";

export class Components {
  constructor() {
    this.getComponentSymbol = Symbol("getComponent");
    this.byId = new Map();
  }
  registerComponent(comp) {
    comp.Class.prototype[this.getComponentSymbol] = () => comp;
    this.byId.set(comp.id, comp);
  }
  getComponentForId(id) {
    return this.byId.get(id) ?? null;
  }
  getCompFor(v) {
    return v?.[this.getComponentSymbol]?.() ?? null;
  }
  getHandlerFor(v, name, key) {
    return this.getCompFor(v)?.[key][name] ?? null;
  }
  getRequestFor(v, name) {
    return this.getCompFor(v)?.scope.lookupRequest(name) ?? null;
  }
  compileStyles() {
    const styles = [];
    for (const comp of this.byId.values()) styles.push(comp.compileStyle());
    return styles.join("\n");
  }
}
export class ComponentStack {
  constructor(comps = new Components(), parent = null) {
    this.comps = comps;
    this.parent = parent;
    this.byName = {};
    this.reqsByName = {};
    this.macros = {};
  }
  enter() {
    return new ComponentStack(this.comps, this);
  }
  registerComponents(comps, opts) {
    const { aliases = {} } = opts ?? {};
    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i];
      // each scope owns its Class. Re-registering the same Component rebinds it to this
      // scope (last wins) — fine for fresh re-setup. To keep a Component live in *two*
      // scopes at once, build a fresh one from its spec: component(comp.spec).
      comp.scope = this.enter();
      // bind the scope onto the Class so direct Class.make()/fromData() calls
      // can resolve comp fields without the caller threading a scope through
      comp.Class.scope = comp.scope;
      this.comps.registerComponent(comp);
      this.byName[comp.name] = comp;
    }
    for (const alias in aliases) {
      const comp = this.byName[aliases[alias]];
      console.assert(this.byName[alias] === undefined, "alias overrides component", alias);
      if (comp !== undefined) this.byName[alias] = comp;
      else console.warn("alias", alias, "to inexistent component", aliases[alias]);
    }
  }
  registerMacros(macros) {
    for (const key in macros) {
      const lower = key.toLowerCase();
      console.assert(this.macros[lower] === undefined, "macro key collision", lower);
      this.macros[lower] = macros[key];
    }
  }
  getCompFor(v) {
    return this.comps.getCompFor(v);
  }
  registerRequestHandlers(handlers) {
    for (const name in handlers) this.reqsByName[name] = new RequestHandler(name, handlers[name]);
  }
  lookupRequest(name) {
    return this.reqsByName[name] ?? this.parent?.lookupRequest(name) ?? null;
  }
  lookupComponent(name) {
    return this.byName[name] ?? this.parent?.lookupComponent(name) ?? null;
  }
  lookupMacro(name) {
    return this.macros[name] ?? this.parent?.lookupMacro(name) ?? null;
  }
}
// What a component publishes: an expression evaluated and pushed onto the dynBinds
// stack (keyed by `symbol`) when the component is entered.
export class ProvideInfo {
  constructor(name, val, symbol) {
    this.name = name;
    this.val = val;
    this.symbol = symbol;
  }
}
// What a component reads "context-style": resolves through the *producer's* provide
// symbol on the dynBinds stack, falling back to `val` (the default expression, or null).
export class LookupInfo {
  constructor(name, compName, provideName, val) {
    this.name = name;
    this.compName = compName;
    this.provideName = provideName;
    this.val = val; // default expression or null
    this._sym = undefined; // memoized producer provide symbol
  }
  getProducerSymbol(stack) {
    if (this._sym === undefined)
      this._sym = stack.lookupType(this.compName)?.provide?.[this.provideName]?.symbol ?? null;
    return this._sym; // invalidated on scope change
  }
}
const isString = (v) => typeof v === "string";
const _rawSpecKeys =
  "name view style commonStyle globalStyle input receive bubble response alter views provide lookup fields methods statics";
const KNOWN_SPEC_KEYS = new Set(_rawSpecKeys.split(" "));
let _compId = 0;
export class Component {
  constructor(Class, o) {
    this.id = _compId++;
    this.name = o.name ?? "UnkComp";
    this.Class = Class;
    this.views = { main: new View("main", o.view, o.style) };
    this.commonStyle = o.commonStyle ?? "";
    this.globalStyle = o.globalStyle ?? "";
    this.input = o.input ?? {};
    this.receive = o.receive ?? {};
    this.bubble = o.bubble ?? {};
    this.response = o.response ?? {};
    this.alter = o.alter ?? {};
    for (const name in o.views ?? {}) {
      const v = o.views[name];
      const { view, style } = isString(v) ? { view: v } : v;
      this.views[name] = new View(name, view, style);
    }
    this._rawProvide = o.provide ?? {};
    this._rawLookup = o.lookup ?? {};
    this.provide = {};
    this.lookup = {};
    this.scope = null;
    this.spec = o;
    this.extra = {};
    for (const key of Object.keys(o)) if (!KNOWN_SPEC_KEYS.has(key)) this.extra[key] = o[key];
  }
  compile(ParseContext) {
    for (const name in this.views)
      this.views[name].compile(new ParseContext(), this.scope, this.id);
    const ctx = this.views.main.ctx;
    // Invalid provide/lookup specs are dropped silently here; the linter reports
    // them at authoring time (PROVIDE_NOT_ADDRESSABLE, LOOKUP_BAD_SHAPE,
    // LOOKUP_TARGET_MALFORMED) so the runtime needn't duplicate the warning.
    for (const key in this._rawProvide) {
      const val = vp.parseProvide(this._rawProvide[key], ctx);
      if (val) this.provide[key] = new ProvideInfo(key, val, Symbol(key));
    }
    for (const key in this._rawLookup) {
      const linfo = this._rawLookup[key];
      const forStr = isString(linfo) ? linfo : isString(linfo?.for) ? linfo.for : null;
      const [compName, provideName] = forStr === null ? [] : forStr.split(".");
      if (!isString(compName) || !isString(provideName)) continue;
      const defStr = isString(linfo?.default) ? linfo.default : null;
      const val = defStr === null ? null : vp.parseField(defStr, ctx);
      this.lookup[key] = new LookupInfo(key, compName, provideName, val);
    }
    for (const key in this.lookup)
      if (this.provide[key] !== undefined)
        console.warn("name declared in both provide and lookup", this.name, key);
  }
  make(args, opts) {
    return this.Class.make(args, opts ?? { scope: this.scope });
  }
  getView(name) {
    return this.views[name] ?? this.views.main;
  }
  getEventForId(id, name = "main") {
    return this.getView(name).ctx.getEventForId(id);
  }
  getNodeForId(id, name = "main") {
    return this.getView(name).ctx.getNodeForId(id);
  }
  compileStyle() {
    const { id, commonStyle, globalStyle, views } = this;
    const styles = commonStyle ? [`[data-cid="${id}"]{${commonStyle}}`] : [];
    if (globalStyle !== "") styles.push(globalStyle);
    for (const name in views) {
      const { style } = views[name];
      if (style !== "") styles.push(`[data-cid="${id}"][data-vid="${name}"]{${style}}`);
    }
    return styles.join("\n");
  }
}

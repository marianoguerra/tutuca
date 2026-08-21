import { View } from "./anode.js";
import { IntentHandler } from "./attribute.js";
import { parseField, parseProvide } from "./value.js";

// Well-known link between a generated component Class and its metadata record
// (the `Component` instance). The Class IS the component; its views/handlers/
// provide/spec live behind this symbol, and instances resolve their component
// via `v.constructor[COMPONENT]`. Registered (`Symbol.for`, like SEQ_INFO /
// FIELD_CLASS) so multiple copies of the library agree on the convention.
export const COMPONENT = Symbol.for("tutuca.component");

export class Components {
  constructor() {
    // id -> component Class (the metadata record lives at Class[COMPONENT]).
    this.byId = new Map();
  }
  registerComponent(Comp) {
    this.byId.set(Comp[COMPONENT].id, Comp);
  }
  getComponentForId(id) {
    return this.byId.get(id) ?? null;
  }
  getCompFor(v) {
    const Comp = v?.constructor;
    return Comp?.[COMPONENT] ? Comp : null;
  }
  getHandlerFor(v, name, key) {
    return this.getCompFor(v)?.[key][name] ?? null;
  }
  // The `lex` leg of an intent's route: the handlers registered on the scope chain of
  // the component that raised it, innermost first. A list, not a first match — see
  // ComponentStack.lookupIntentChain.
  getIntentChainFor(v, name) {
    return this.getCompFor(v)?.scope.lookupIntentChain(name) ?? [];
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
    this.intentsByName = {};
    this.macros = {};
  }
  enter() {
    return new ComponentStack(this.comps, this);
  }
  registerComponents(comps, opts) {
    const { aliases = {} } = opts ?? {};
    for (let i = 0; i < comps.length; i++) {
      const Comp = comps[i];
      // each scope owns its Class. Re-registering the same Component rebinds it to this
      // scope (last wins) — fine for fresh re-setup. To keep a Component live in *two*
      // scopes at once, build a fresh one from its spec: component(Comp.spec).
      Comp[COMPONENT].scope = this.enter();
      this.comps.registerComponent(Comp);
      this.byName[Comp.name] = Comp;
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
  // Handlers that answer an intent's `lex` leg. A name maps to a LIST, because the leg
  // walks: a handler that returns PASS declines and hands the intent to the next one.
  // A bare function is accepted as a one-element list.
  registerIntentHandlers(handlers) {
    for (const name in handlers) {
      const fns = Array.isArray(handlers[name]) ? handlers[name] : [handlers[name]];
      this.intentsByName[name] = fns.map((fn) => new IntentHandler(name, fn));
    }
  }
  // Innermost scope first, then outward. Concatenated rather than first-match, so a
  // declining handler can hand the intent to one further up.
  lookupIntentChain(name) {
    const here = this.intentsByName[name] ?? [];
    const up = this.parent?.lookupIntentChain(name) ?? [];
    return up.length === 0 ? here : here.concat(up);
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
// The two dispatch buckets, plus `alter` (render-time, never dispatched).
const _rawSpecKeys =
  "name view style commonStyle globalStyle receive intent alter views provide lookup fields methods statics";
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
    // ADDRESSED: a view's own `@on.*`, a parent's ctx.send, the host's sendAtRoot, and
    // an answer to an intent. One bucket, and a handler cannot tell which it was.
    this.receive = o.receive ?? {};
    // ROUTED: raised by someone who did not name a target, and walked until answered.
    this.intent = o.intent ?? {};
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
      const val = parseProvide(this._rawProvide[key], ctx);
      if (val) this.provide[key] = new ProvideInfo(key, val, Symbol(key));
    }
    for (const key in this._rawLookup) {
      const linfo = this._rawLookup[key];
      const forStr = isString(linfo) ? linfo : isString(linfo?.for) ? linfo.for : null;
      const [compName, provideName] = forStr === null ? [] : forStr.split(".");
      if (!isString(compName) || !isString(provideName)) continue;
      const defStr = isString(linfo?.default) ? linfo.default : null;
      const val = defStr === null ? null : parseField(defStr, ctx);
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

import { View } from "./anode.js";
import { isTypeName } from "./stack.js";
import { parseField, parseProvide } from "./value.js";

// Marks a generated Class as a component: `Class[COMPONENT] === Class`. The Class IS
// the component — its views/handlers/provide/spec are its own statics (see
// `initComponent`) — and instances resolve theirs via `v.constructor[COMPONENT]`.
// Registered (`Symbol.for`, like SEQ_INFO) so multiple copies of the library agree
// on the convention.
export const COMPONENT = Symbol.for("tutuca.component");

export class Components {
  constructor() {
    // id -> component Class.
    this.byId = new Map();
  }
  registerComponent(Comp) {
    this.byId.set(Comp.id, Comp);
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
    for (const Comp of this.byId.values()) styles.push(Comp.compileStyle());
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
    this.paths = {};
  }
  enter() {
    return new ComponentStack(this.comps, this);
  }
  registerComponents(comps, opts) {
    const { aliases = {}, paths } = opts ?? {};
    if (paths) this.registerPaths(paths);
    for (let i = 0; i < comps.length; i++) {
      const Comp = comps[i];
      // each scope owns its Class. Re-registering the same Component rebinds it to this
      // scope (last wins) — fine for fresh re-setup. To keep a Component live in *two*
      // scopes at once, build a fresh one from its spec: component(Comp.spec).
      Comp.scope = this.enter();
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
  // Register lowercase names as absolute paths from the app state root. A
  // descendant that declares one in its `lookup` reads and renders `*name` without
  // anything above it publishing one — which is what makes a session, a theme or a
  // host-owned value available in its natural registration scope, instead of forcing
  // an application root whose only job is to `provide` it. Register on a nested
  // scope to narrow a name; nearest registration wins.
  //
  // Uppercase names are ignored: a component TYPE is what `lookupComponent` already
  // answers, and a type has no path.
  registerPaths(paths) {
    for (const name in paths) {
      if (isTypeName(name)) {
        console.warn("registerPaths: a type name has no path", name);
        continue;
      }
      // `path().field("theme")` — the same builder `ctx.at` hands a handler, so
      // there is one way to write an address down.
      this.paths[name] = paths[name].toPath();
    }
  }
  lookupPath(name) {
    return this.paths[name] ?? this.parent?.lookupPath(name) ?? null;
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
  // Handlers that answer an intent's `lex` leg. A name maps to a LIST of plain
  // functions, because the leg walks: a handler that returns PASS declines and hands
  // the intent to the next one. Each runs with no `this` and takes a dispatcher
  // context as its final argument; resolving answers, throwing fails. A bare function
  // is accepted as a one-element list.
  registerIntentHandlers(handlers) {
    for (const name in handlers) {
      const fns = handlers[name];
      this.intentsByName[name] = Array.isArray(fns) ? fns : [fns];
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
  // Whether anything in this scope chain provides `name`. Existence only: a lookup
  // names what it WANTS and takes whoever is nearest above it at render time, so
  // there is no producer to identify — several components may publish one name and
  // the live render ancestry decides. Used by the linter to tell a lookup that can
  // be satisfied from one that never will be.
  hasProvider(name) {
    for (const compName in this.byName) {
      if (this.byName[compName].provide?.[name] !== undefined) return true;
    }
    return this.parent?.hasProvider(name) ?? false;
  }
  lookupMacro(name) {
    return this.macros[name] ?? this.parent?.lookupMacro(name) ?? null;
  }
}
const isString = (v) => typeof v === "string";
// The two dispatch buckets, plus `alter` (render-time, never dispatched).
const _rawSpecKeys =
  "name view style commonStyle globalStyle receive intent alter views provide lookup fields methods statics";
const KNOWN_SPEC_KEYS = new Set(_rawSpecKeys.split(" "));
let _compId = 0;
// Make a generated Class a component: the spec's declarations become its own statics
// and the methods below its static behavior. `this` in those is the Class.
export function initComponent(Class, o) {
  Class[COMPONENT] = Class;
  Class.id = _compId++;
  Class.views = { main: new View("main", o.view, o.style) };
  Class.commonStyle = o.commonStyle ?? "";
  Class.globalStyle = o.globalStyle ?? "";
  // ADDRESSED: a view's own `@on.*`, a parent's ctx.send, the host's sendAtRoot, and
  // an answer to an intent. One bucket, and a handler cannot tell which it was.
  Class.receive = o.receive ?? {};
  // ROUTED: raised by someone who did not name a target, and walked until answered.
  Class.intent = o.intent ?? {};
  Class.alter = o.alter ?? {};
  for (const name in o.views ?? {}) {
    const v = o.views[name];
    const { view, style } = isString(v) ? { view: v } : v;
    Class.views[name] = new View(name, view, style);
  }
  Class._rawProvide = o.provide ?? {};
  Class._rawLookup = o.lookup ?? [];
  // What a component publishes: name -> parsed expression, evaluated when the
  // component is entered and pushed onto the dynBinds stack under that NAME,
  // together with the absolute path its value lives at. Names, not symbols: a
  // lookup names what it wants and takes whoever provides it, nearest first, so
  // there is no producer to qualify — and because the pair is resolved by live
  // render ancestry, several components may publish one name and the nearest
  // rendered one wins.
  Class.provide = {};
  // Component types this component publishes to its subtree, name -> Class. Kept
  // apart from `provide` because a Class is not addressable: it can never be a
  // render target, so it must not reach `*name`.
  Class.provideType = {};
  // What a component reads "context-style": name -> default expression (or
  // null), used when nobody above provides the name.
  Class.lookup = {};
  Class.scope = null;
  Class.spec = o;
  Class.extra = {};
  for (const key of Object.keys(o)) if (!KNOWN_SPEC_KEYS.has(key)) Class.extra[key] = o[key];
  return Object.assign(Class, COMPONENT_METHODS);
}
export const COMPONENT_METHODS = {
  compile(ParseContext) {
    for (const name in this.views)
      this.views[name].compile(new ParseContext(), this.scope, this.id);
    const ctx = this.views.main.ctx;
    // Invalid provide/lookup specs are dropped silently here; the linter reports
    // them at authoring time (PROVIDE_NOT_ADDRESSABLE, PROVIDE_TYPE_BAD_SHAPE,
    // LOOKUP_BAD_SHAPE) so the runtime needn't duplicate the warning.
    for (const key in this._rawProvide) {
      if (isTypeName(key)) {
        // A published component type. `"self"` is the only value: the publisher's own
        // Class, so a published type is a component by construction and the dyn leg
        // never has to trust an arbitrary expression.
        if (this._rawProvide[key] === "self") this.provideType[key] = this;
        continue;
      }
      const val = parseProvide(this._rawProvide[key], ctx);
      if (val) this.provide[key] = val;
    }
    // `lookup` is a list of names: a bare string is the whole declaration, an object
    // appears only when an option (a `default`) is needed.
    for (const entry of this._rawLookup) {
      const name = isString(entry) ? entry : isString(entry?.name) ? entry.name : null;
      if (name === null) continue;
      const defStr = isString(entry?.default) ? entry.default : null;
      this.lookup[name] = defStr === null ? null : parseField(defStr, ctx);
    }
    for (const key in this.lookup)
      if (this.provide[key] !== undefined)
        console.warn("name declared in both provide and lookup", this.name, key);
  },
  getView(name) {
    return this.views[name] ?? this.views.main;
  },
  getEventForId(id, viewName) {
    return this.getView(viewName).ctx.getEventForId(id);
  },
  getNodeForId(id, viewName) {
    return this.getView(viewName).ctx.getNodeForId(id);
  },
  compileStyle() {
    const { id, commonStyle, globalStyle, views } = this;
    const styles = commonStyle ? [`[data-cid="${id}"]{${commonStyle}}`] : [];
    if (globalStyle !== "") styles.push(globalStyle);
    for (const name in views) {
      const { style } = views[name];
      if (style !== "") styles.push(`[data-cid="${id}"][data-vid="${name}"]{${style}}`);
    }
    return styles.join("\n");
  },
};

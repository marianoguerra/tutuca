import { View } from "./anode.js";
import { RequestHandler } from "./attribute.js";
import { NullComputedCache, WeakMapComputedCache } from "./cache.js";
import { vp } from "./value.js";

export class Components {
  constructor() {
    this.getComponentSymbol = Symbol("getComponent");
    this.byId = new Map();
    this.computedCache = new WeakMapComputedCache();
  }
  setNullComputedCache() {
    this.computedCache = new NullComputedCache();
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
  getOnEnterFor(v) {
    const comp = this.getCompFor(v);
    return comp ? comp.on.stackEnter : defaultOnStackEnter;
  }
  getInputHandlerFor(v, name) {
    return this.getCompFor(v)?.input[name] ?? null;
  }
  getAlterHandlerFor(v, name) {
    return this.getCompFor(v)?.alter[name] ?? null;
  }
  getRequestFor(v, name) {
    const comp = this.getCompFor(v);
    return comp ? comp.scope.lookupRequest(name) : null;
  }
  lookupComputed(v, name) {
    const fn = this.getCompFor(v)?.computed[name];
    return fn ? this.computedCache.getKey(v, name, fn) : null;
  }
  compileStyles() {
    const styles = [];
    for (const comp of this.byId.values()) {
      styles.push(comp.compileStyle());
    }
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
  registerComponents(comps, aliases = {}) {
    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i];
      comp.scope = this.enter();
      this.comps.registerComponent(comp);
      this.byName[comp.name] = comp;
      const alias = aliases[comp.name];
      if (alias) {
        this.byName[alias] = comp;
      }
    }
  }
  registerMacros(macros) {
    Object.assign(this.macros, macros);
  }
  getCompFor(v) {
    return this.comps.getCompFor(v);
  }
  registerRequestHandlers(handlers) {
    for (const name in handlers) {
      this.reqsByName[name] = new RequestHandler(name, handlers[name]);
    }
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
export class Dynamic {
  constructor(name, val, symbol) {
    this.name = name;
    this.val = val;
    this.symbol = symbol;
  }
  getSymbol(_stack) {
    return this.symbol;
  }
  evalAndBind(stack, binds) {
    binds[this.getSymbol(stack)] = this.val.eval(stack);
  }
}
export class DynamicAlias extends Dynamic {
  constructor(name, val, compName, dynName) {
    super(name, val, null);
    this.compName = compName;
    this.dynName = dynName;
  }
  _resolveSymbol(stack) {
    const t = stack.lookupType(this.compName);
    return t?.dynamic[this.dynName]?.symbol ?? null;
  }
  getSymbol(stack) {
    this.symbol ??= this._resolveSymbol(stack); // invalidated on scope change
    return this.symbol;
  }
}
const isString = (v) => typeof v === "string";
let _compId = 0;
export class Component {
  constructor(
    name,
    Class,
    view,
    views = {},
    style = "",
    commonStyle = "",
    globalStyle = "",
    computed = {},
    input = {},
    logic = {},
    bubble = {},
    response = {},
    alter = {},
    dynamic = {},
    on = {},
  ) {
    this.id = _compId++;
    this.name = name;
    this.Class = Class;
    this.views = { main: new View("main", view, style) };
    this.commonStyle = commonStyle;
    this.globalStyle = globalStyle;
    this.computed = computed;
    this.input = input;
    this.logic = logic;
    this.bubble = bubble;
    this.response = response;
    this.alter = alter;
    this.on = { stackEnter: on?.stackEnter ?? defaultOnStackEnter };
    for (const name in views) {
      const v = views[name];
      const { view, style } = isString(v) ? { view: v } : v;
      this.views[name] = new View(name, view, style);
    }
    this._rawDynamic = dynamic;
    this.dynamic = {};
    this.scope = null;
  }
  compile(ParseContext) {
    for (const key in this._rawDynamic) {
      const dinfo = this._rawDynamic[key];
      if (isString(dinfo)) {
        const val = vp.parseDynamic(dinfo, this.views.main.ctx);
        this.dynamic[key] = new Dynamic(key, val, Symbol(key));
      } else if (isString(dinfo?.default) && isString(dinfo?.for)) {
        const val = vp.parseDynamic(dinfo.default, this.views.main.ctx);
        const [compName, dynName] = dinfo.for.split(".");
        if (isString(compName) && isString(dynName)) {
          this.dynamic[key] = new DynamicAlias(key, val, compName, dynName);
        }
      }
    }
    for (const name in this.views) {
      this.views[name].compile(new ParseContext(), this.scope, this.id);
    }
  }
  make(args, opts) {
    return this.Class.make(args, opts);
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
    if (globalStyle !== "") {
      styles.push(globalStyle);
    }
    for (const name in views) {
      const { style } = views[name];
      if (style !== "") {
        styles.push(`[data-cid="${id}"][data-vid="${name}"]{${style}}`);
      }
    }
    return styles.join("\n");
  }
}
function defaultOnStackEnter(stack) {
  return stack; // need function and not arrow fn to parse it to data
}

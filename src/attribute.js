import { ConstVal, vp } from "./value.js";

export class Attributes {
  constructor(items) {
    this.items = items;
  }
  eval(_stack) {
    return {};
  }
  static parse(attributes, px, parseAll = false) {
    return getAttrParser(px).parse(attributes, parseAll);
  }
  isConstant() {
    return false;
  }
}
const booleanAttrsRaw =
  "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly,async,autofocus,autoplay,controls,default,defer,disabled,hidden,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected";
const booleanAttrs = new Set(booleanAttrsRaw.split(","));
class AttrParser {
  constructor(px) {
    this.clear(px);
  }
  clear(px) {
    this.px = px;
    this.attrs = null;
    this.hasDynamic = false;
    this.wrapperAttrs = null;
    this.textChild = null;
    this.eachAttr = null;
    this.ifAttr = null;
    this.events = null;
  }
  parseAttr(name, value, parseAll = false) {
    const val = parseAll ? vp.parseAll(value, this.px) : vp.parseAttr(value, this.px);
    if (val !== null) {
      this.attrs ??= [];
      this.attrs.push(new Attr(name, val));
      this.hasDynamic ||= !(val instanceof ConstVal); // macroVar constant
    }
  }
  pushWrapper(name, raw, val) {
    const node = { name, val, raw };
    this.wrapperAttrs ??= [];
    this.wrapperAttrs.push(node);
    return node;
  }
  parseIf(directiveName, value) {
    const dynVal = vp.parseCondValue(value, this.px);
    if (dynVal) {
      this.ifAttr = new IfAttr(directiveName.slice(3), dynVal);
      this.attrs ??= [];
      this.attrs.push(this.ifAttr);
      this.hasDynamic = true;
    }
  }
  parseThen(s) {
    if (this.ifAttr) {
      this.ifAttr.thenVal = vp.parseAttr(s, this.px) ?? NOT_SET_VAL;
    }
  }
  parseElse(value) {
    if (this.ifAttr) {
      this.ifAttr.elseVal = vp.parseAttr(value, this.px) ?? NOT_SET_VAL;
    }
  }
  parseEvent(directiveName, value) {
    const [eventName, ...modifiers] = directiveName.slice(3).split("+");
    const handler = EventHandler.parse(value, this.px);
    if (handler) {
      if (this.events === null) {
        this.events = this.px.registerEvents();
        this.attrs ??= [];
        this.attrs.push(new ConstAttr("data-eid", vp.const(this.events.id)));
      }
      this.events.add(eventName, handler, modifiers);
    }
  }
  parseDirective(s, directiveName) {
    switch (directiveName) {
      case "dangerouslysetinnerhtml":
        this.attrs ??= [];
        this.attrs.push(new RawHtmlAttr(vp.parseText(s, this.px)));
        this.hasDynamic = true;
        return;
      case "slot":
        this.pushWrapper("slot", s, vp.const(s));
        return;
      case "push-view":
        this.pushWrapper("push-view", s, vp.parseText(s, this.px));
        return;
      case "text":
        this.textChild = vp.parseText(s, this.px) ?? vp.const("");
        return;
      case "show":
        this.pushWrapper("show", s, vp.parseCondValue(s, this.px));
        return;
      case "hide":
        this.pushWrapper("hide", s, vp.parseCondValue(s, this.px));
        return;
      case "each":
        this.eachAttr = this.pushWrapper("each", s, vp.parseEach(s, this.px));
        return;
      case "enrich-with":
        if (this.eachAttr !== null) {
          this.eachAttr.enrichWithVal = vp.parseAlter(s, this.px);
        } else {
          this.pushWrapper("scope", s, vp.parseAlter(s, this.px));
        }
        return;
      case "when":
        this._parseWhen(s);
        return;
      case "loop-with":
        this._parseLoopWith(s);
        return;
      case "then":
        this.parseThen(s);
        return;
      case "else":
        this.parseElse(s);
        return;
    }
    if (directiveName.startsWith("on.")) {
      this.parseEvent(directiveName, s);
    } else if (directiveName.startsWith("if.")) {
      this.parseIf(directiveName, s);
    } else if (directiveName.startsWith("then.")) {
      this.parseThen(s);
    } else if (directiveName.startsWith("else.")) {
      this.parseElse(s);
    }
  }
  _parseWhen(s) {
    if (this.eachAttr !== null) {
      this.eachAttr.whenVal = vp.parseAlter(s, this.px);
    }
  }
  _parseLoopWith(s) {
    if (this.eachAttr !== null) {
      this.eachAttr.loopWithVal = vp.parseAlter(s, this.px);
    }
  }
  parse(attributes, parseAll = false) {
    for (const { name, value } of attributes) {
      const charCode = name.charCodeAt(0); // 58 = ":", 64 = "@"
      if (charCode === 58) {
        this.parseAttr(name === ":viewbox" ? "viewBox" : name.slice(1), value, parseAll);
      } else if (charCode === 64) {
        this.parseDirective(value, name.slice(1));
      } else {
        this.attrs ??= [];
        const constVal = value === "" && booleanAttrs.has(name) ? true : value;
        this.attrs.push(new ConstAttr(name, vp.const(constVal)));
      }
    }
    const { attrs, hasDynamic } = this;
    const pAttrs = hasDynamic ? new DynAttrs(attrs) : ConstAttrs.fromAttrs(attrs ?? []);
    return [pAttrs, this.wrapperAttrs, this.textChild];
  }
}
export class ConstAttrs extends Attributes {
  eval(_stack) {
    return this.items;
  }
  static fromAttrs(attrs) {
    const attrsObj = {};
    for (const attr of attrs) {
      attrsObj[attr.name] = attr.value.eval(null);
    }
    return new ConstAttrs(attrsObj);
  }
  setDataAttr(key, val) {
    this.items[key] = val;
  }
  toMacroVars() {
    const r = {};
    for (const name in this.items) {
      r[name] = `'${this.items[name]}'`;
    }
    return r;
  }
  isConstant() {
    return true;
  }
}
export class DynAttrs extends Attributes {
  eval(stack) {
    const attrs = {};
    for (const attr of this.items) {
      attrs[attr.name] = attr.eval(stack);
    }
    return attrs;
  }
  setDataAttr(key, val) {
    this.items.push(new ConstAttr(key, new ConstVal(val)));
  }
  toMacroVars() {
    const r = {};
    for (const attr of this.items) {
      r[attr.name] = attr.value.toString();
    }
    return r;
  }
}
export class BaseAttr {
  constructor(name) {
    this.name = name;
  }
}
export class Attr extends BaseAttr {
  constructor(name, value) {
    super(name);
    this.value = value;
  }
  eval(stack) {
    return this.value.eval(stack);
  }
}
export class ConstAttr extends Attr {}
export class DynAttr extends Attr {}
export class RawHtmlAttr extends Attr {
  constructor(value) {
    super("dangerouslySetInnerHTML", value ?? vp.nullConstVal);
  }
  eval(stack) {
    return { __html: `${this.value.eval(stack)}` };
  }
}
export const NOT_SET_VAL = vp.nullConstVal;
export class IfAttr extends BaseAttr {
  constructor(name, condVal) {
    super(name);
    this.condVal = condVal;
    this.thenVal = this.elseVal = NOT_SET_VAL;
  }
  get anyBranchIsSet() {
    return this.thenVal !== NOT_SET_VAL || this.elseVal !== NOT_SET_VAL;
  }
  eval(stack) {
    return this.condVal.eval(stack) ? this.thenVal.eval(stack) : this.elseVal.eval(stack);
  }
}
let _attrParser = null;
export function getAttrParser(px) {
  _attrParser ??= new AttrParser(px);
  _attrParser.clear(px);
  return _attrParser;
}
export class EventHandler {
  constructor(handlerVal, args = []) {
    this.handlerVal = handlerVal;
    this.args = args;
  }
  getHandlerAndArgs(stack, _event) {
    const argValues = new Array(this.args.length);
    for (let i = 0; i < argValues.length; i++) {
      argValues[i] = this.args[i].eval(stack);
    }
    return [this.handlerVal.eval(stack), argValues];
  }
  static parse(s, px) {
    const [handlerName, ...rawArgs] = s.trim().split(/\s+/);
    const handlerVal = vp.parseHandlerName(handlerName, px);
    if (handlerVal === null) {
      return null;
    }
    const args = new Array(rawArgs.length);
    vp.allowHandlerArg();
    for (let i = 0; i < rawArgs.length; i++) {
      const val = vp.parse(rawArgs[i], px);
      args[i] = val !== null ? val : vp.nullConstVal;
    }
    return new EventHandler(handlerVal, args);
  }
}
export class RequestHandler {
  constructor(name, fn) {
    this.name = name;
    this.fn = fn;
  }
  toHandlerArg(disp) {
    const f = (...args) => disp.request(this.name, args);
    f.withOpts = (...args) => disp.request(this.name, args.slice(0, -1), args.at(-1));
    return f;
  }
}

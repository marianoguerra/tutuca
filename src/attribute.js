import {
  ConstVal,
  NULL_CONST_VAL,
  parseAlterHandler,
  parseBool,
  parseMacroAttr,
  parseReceiveHandler,
  parseSequence,
  parseText,
} from "./value.js";

export class Attributes {
  constructor(items) {
    this.items = items;
  }
  isConstant() {
    return false;
  }
}
const booleanAttrsRaw =
  "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly,async,autofocus,autoplay,controls,default,defer,disabled,hidden,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected";
const booleanAttrs = new Set(booleanAttrsRaw.split(","));
function parseDirectiveValue(px, directiveName, source, parser) {
  const val = parser(source, px);
  if (val === null) {
    px.onParseIssue("bad-value", {
      role: "directive",
      directive: directiveName,
      value: source,
    });
  }
  return val;
}

// The directives that amend an iteration, and the IterInfo slot each one fills.
const ITER_DIRECTIVES = {
  when: "whenVal",
  "loop-with": "loopWithVal",
  "enrich-with": "enrichWithVal",
};
const parseIterDirective = (px, name, s) => parseDirectiveValue(px, name, s, parseAlterHandler);

// `@when` / `@loop-with` read off a `<x render-each>` element's raw attributes (its
// other attributes are the op's own, so it does not go through AttrParser).
export function parseIterationDirectives(attributes, px) {
  const parseNamed = (name) => {
    const attr = attributes.getNamedItem(`@${name}`);
    return attr ? parseIterDirective(px, name, attr.value) : null;
  };
  return { whenVal: parseNamed("when"), loopWithVal: parseNamed("loop-with") };
}

export class AttrParser {
  constructor(px) {
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
    const val = parseAll ? parseMacroAttr(value, this.px) : parseText(value, this.px);
    if (val !== null) {
      this.attrs ??= [];
      this.attrs.push(new Attr(name, val));
      this.hasDynamic ||= !(val instanceof ConstVal); // macroVar constant
    } else this.px.onParseIssue("bad-value", { role: "attr", attr: name, value });
  }
  pushWrapper(name, raw, val) {
    const node = { name, val, raw };
    this.wrapperAttrs ??= [];
    this.wrapperAttrs.push(node);
    return node;
  }
  parseIf(directiveName, value) {
    const dynVal = parseBool(value, this.px);
    if (dynVal) {
      this.ifAttr = new IfAttr(directiveName.slice(3), dynVal);
      this.attrs ??= [];
      this.attrs.push(this.ifAttr);
      this.hasDynamic = true;
    } else {
      const info = { role: "if", attr: directiveName.slice(3), value };
      this.px.onParseIssue("bad-value", info);
    }
  }
  // `@then` / `@else` fill the branches of the `@if.<attr>` on the same element.
  parseBranch(slot, name, s) {
    if (this.ifAttr === null) return this._orphan(name, s, "if");
    this.ifAttr[slot] = parseText(s, this.px) ?? NOT_SET_VAL;
  }
  // `@when` / `@loop-with` / `@enrich-with` amend the `@each` on the same element. A
  // loop-less `@enrich-with` is a scope of its own; the other two need the loop.
  parseIter(name, s) {
    const val = parseIterDirective(this.px, name, s);
    if (this.eachAttr !== null) this.eachAttr[ITER_DIRECTIVES[name]] = val;
    else if (name === "enrich-with") this.pushWrapper("scope", s, val);
    else this._orphan(name, s, "each");
  }
  // A directive that only means something next to another one, written alone.
  _orphan(name, value, needs) {
    this.px.onParseIssue("orphan-directive", { name, value, needs });
  }
  parseEvent(directiveName, value) {
    const [eventName, ...modifiers] = directiveName.slice(3).split("+");
    const handler = EventHandler.parse(value, this.px);
    if (handler) {
      if (this.events === null) {
        this.events = this.px.registerEvents();
        this.attrs ??= [];
        this.attrs.push(new ConstAttr("data-eid", new ConstVal(this.events.id)));
      }
      this.events.add(eventName, handler, modifiers);
    }
  }
  parseDirective(s, directiveName) {
    switch (directiveName) {
      case "dangerouslysetinnerhtml":
        this.attrs ??= [];
        this.attrs.push(new RawHtmlAttr(parseDirectiveValue(this.px, directiveName, s, parseText)));
        this.hasDynamic = true;
        return;
      case "push-view":
        this.pushWrapper("push-view", s, parseDirectiveValue(this.px, directiveName, s, parseText));
        return;
      case "text":
        this.textChild = parseDirectiveValue(this.px, directiveName, s, parseText);
        return;
      case "show":
        this.pushWrapper("show", s, parseDirectiveValue(this.px, directiveName, s, parseBool));
        return;
      case "hide":
        this.pushWrapper("hide", s, parseDirectiveValue(this.px, directiveName, s, parseBool));
        return;
      case "each": {
        const val = parseDirectiveValue(this.px, directiveName, s, parseSequence);
        this.eachAttr = this.pushWrapper("each", s, val);
        return;
      }
      case "when":
      case "loop-with":
      case "enrich-with":
        this.parseIter(directiveName, s);
        return;
      case "then":
        this.parseBranch("thenVal", directiveName, s);
        return;
      case "else":
        this.parseBranch("elseVal", directiveName, s);
        return;
    }
    if (directiveName.startsWith("on.")) this.parseEvent(directiveName, s);
    else if (directiveName.startsWith("if.")) this.parseIf(directiveName, s);
    else if (directiveName.startsWith("then.")) this.parseBranch("thenVal", directiveName, s);
    else if (directiveName.startsWith("else.")) this.parseBranch("elseVal", directiveName, s);
    else {
      const info = { name: directiveName, value: s };
      this.px.onParseIssue("unknown-directive", info);
    }
  }
  parse(attributes, parseAll = false) {
    for (const { name, value } of attributes) {
      const charCode = name.charCodeAt(0); // 58 = ":", 64 = "@"
      if (charCode === 58)
        this.parseAttr(name === ":viewbox" ? "viewBox" : name.slice(1), value, parseAll);
      else if (charCode === 64) this.parseDirective(value, name.slice(1));
      else {
        this.attrs ??= [];
        const constVal = value === "" && booleanAttrs.has(name) ? true : value;
        this.attrs.push(new ConstAttr(name, new ConstVal(constVal)));
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
    for (const attr of attrs) attrsObj[attr.name] = attr.val.eval(null);
    return new ConstAttrs(attrsObj);
  }
  setDataAttr(key, val) {
    this.items[key] = val;
  }
  toMacroVars() {
    const r = {};
    for (const name in this.items) r[name] = new ConstVal(`${this.items[name]}`).toString();
    return r;
  }
  isConstant() {
    return true;
  }
}
export class DynAttrs extends Attributes {
  eval(stack) {
    const attrs = {};
    for (let i = 0; i < this.items.length; i++) {
      const attr = this.items[i];
      attrs[attr.name] = attr.eval(stack);
    }
    return attrs;
  }
  setDataAttr(key, val) {
    this.items.push(new ConstAttr(key, new ConstVal(val)));
  }
  toMacroVars() {
    const r = {};
    for (const attr of this.items) r[attr.name] = attr.val.toString();
    return r;
  }
}
class BaseAttr {
  constructor(name) {
    this.name = name;
  }
}
export class Attr extends BaseAttr {
  constructor(name, val) {
    super(name);
    this.val = val;
  }
  eval(stack) {
    return this.val.eval(stack);
  }
}
export class ConstAttr extends Attr {}
export class RawHtmlAttr extends Attr {
  constructor(val) {
    super("dangerouslySetInnerHTML", val ?? NULL_CONST_VAL);
  }
  eval(stack) {
    return { __html: `${this.val.eval(stack)}` };
  }
}
export const NOT_SET_VAL = NULL_CONST_VAL;
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
export class EventHandler {
  constructor(handlerVal, args = []) {
    this.handlerVal = handlerVal;
    this.args = args;
  }
  getHandlerAndArgs(stack, _event) {
    const argValues = new Array(this.args.length);
    for (let i = 0; i < argValues.length; i++) argValues[i] = this.args[i].eval(stack);
    return [this.handlerVal.evalAsHandler(stack), argValues];
  }
  static parse(s, px) {
    const r = parseReceiveHandler(s, px);
    return r === null ? null : new EventHandler(r.handlerVal, r.args);
  }
}

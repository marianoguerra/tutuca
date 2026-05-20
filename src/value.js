import { FieldStep, SeqAccessStep } from "./path.js";

const VALID_VAL_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const isValidValId = (name) => VALID_VAL_ID_RE.test(name);
const VALID_FLOAT_RE = /^-?[0-9]+(\.[0-9]+)?$/;
const STR_TPL_SPLIT_RE = /(\{[^}]+\})/g; // Safe to share despite `g` flag: only used in split
const mkVal = (name, Cls) => (isValidValId(name) ? new Cls(name) : null);

// Value kinds: a parse group is the bitwise-or of the kinds it accepts.
const K_CONST = 1;
const K_STRTPL = 2;
const K_FIELD = 4;
const K_BIND = 8;
const K_DYN = 16;
const K_NAME = 32;
const K_TYPE = 64;
const K_REQUEST = 128;
const K_SEQ = 256;

// Value groups, one per parsing context. Kept private: callers use the named
// `parseX` methods below so they never have to know about the bitmasks.
const G_BOOL = K_FIELD | K_BIND | K_DYN | K_CONST;
const G_TEXT = G_BOOL | K_STRTPL;
const G_COMPONENT = K_FIELD | K_SEQ;
const G_SEQUENCE = K_FIELD | K_DYN;
const G_FIELD = K_FIELD;
const G_VALUE = K_FIELD | K_BIND | K_DYN | K_NAME | K_TYPE | K_REQUEST | K_CONST;
const G_ALL = G_VALUE | K_STRTPL | K_SEQ;

export class ValParser {
  constructor() {
    this.bindValIt = new BindVal("it");
    this.nullConstVal = new ConstVal(null);
  }
  const(v) {
    return new ConstVal(v);
  }
  // Conditionals: @show, @hide, @if.<attr>, x-op show/hide, x-wrapper attrs.
  parseBool(s, px) {
    return this.parse(s, px, G_BOOL);
  }
  // Text values: :attr, @text, <x text>, @then/@else, @push-view, @html.
  parseText(s, px) {
    return this.parse(s, px, G_TEXT);
  }
  // A single component to render: <x render>.
  parseComponent(s, px) {
    return this.parse(s, px, G_COMPONENT);
  }
  // A sequence to iterate: @each, <x render-each>.
  parseSequence(s, px) {
    return this.parse(s, px, G_SEQUENCE);
  }
  // A plain field reference: component `dynamic:` field definitions.
  parseField(s, px) {
    return this.parse(s, px, G_FIELD);
  }
  // Arguments passed to an event handler.
  parseHandlerArg(s, px) {
    return this.parse(s, px, G_VALUE);
  }
  // Pass-through values on a macro-call element (:attr on a macro).
  parseMacroAttr(s, px) {
    return this.parse(s, px, G_ALL);
  }
  // Handler reference for @on.<event>.
  parseInputHandler(s, px) {
    return this._parseHandler(s, px, "input");
  }
  // Handler reference for @when, @enrich-with/@scope, @loop-with.
  parseAlterHandler(s, px) {
    return this._parseHandler(s, px, "alter");
  }
  _parseHandler(s, px, namespace) {
    const val = this.parse(s, px, K_FIELD | K_NAME); // TODO: surface info if val is null
    return (
      val && (val.toRawFieldVal ? val.toRawFieldVal() : new HandlerNameVal(val.name, namespace))
    );
  }
  _parseSeqAccess(s, px, group) {
    if (!(group & K_SEQ)) return null;
    const openSquareBracketIndex = s.indexOf("[");
    const left = this.parse(s.slice(0, openSquareBracketIndex), px, K_FIELD);
    const right = this.parse(s.slice(openSquareBracketIndex + 1, -1), px, K_FIELD);
    return left && right ? new SeqAccessVal(left, right) : null;
  }
  parse(s, px, group) {
    switch (getValSubType(s)) {
      case VAL_SUB_TYPE_STRING_TEMPLATE:
        return group & K_STRTPL ? StrTplVal.parse(s, px) : null;
      case VAL_SUB_TYPE_CONST_STRING:
        return group & K_STRTPL ? new ConstVal(s) : null;
      case VAL_SUB_TYPE_SEQ_ACCESS:
        return this._parseSeqAccess(s, px, group);
      case VAL_SUB_TYPE_INVALID:
        return group & K_STRTPL ? StrTplVal.parse(s, px) : null;
    }
    const charCode = s.charCodeAt(0);
    switch (charCode) {
      case 94: {
        const name = s.slice(1);
        const newS = px.frame.macroVars?.[name];
        if (newS !== undefined) return this.parse(newS, px, group);
        px.onParseIssue("bad-value", { role: "macro-var", name, value: s });
        return null;
      }
      case 39: // ''
        return group & K_STRTPL ? new ConstVal(s.slice(1, -1)) : null;
      case 64: // @
        return group & K_BIND ? mkVal(s.slice(1), BindVal) : null;
      case 42: // *
        return group & K_DYN ? mkVal(s.slice(1), DynVal) : null;
      case 46: // .
        return group & K_FIELD ? mkVal(s.slice(1), FieldVal) : null;
      case 33: // !
        return group & K_REQUEST ? mkVal(s.slice(1), RequestVal) : null;
    }
    const num = VALID_FLOAT_RE.test(s) ? parseFloat(s) : null;
    if (Number.isFinite(num)) return group & K_CONST ? new ConstVal(num) : null;
    else if (s === "true" || s === "false")
      return group & K_CONST ? new ConstVal(s === "true") : null;
    else if (charCode >= 97 /* a */ && charCode <= 122 /* z */)
      return group & K_NAME ? mkVal(s, NameVal) : null;
    else if (charCode >= 65 /* A */ && charCode <= 90 /* Z */)
      return group & K_TYPE ? mkVal(s, TypeVal) : null;
    return null;
  }
}
export class BaseVal {
  render(_stack, _rx) {}
  eval(_stack) {}
  toPathItem() {
    return null;
  }
}
export class ConstVal extends BaseVal {
  constructor(val) {
    super();
    this.val = val;
  }
  render(_stack, _rx) {
    return this.val;
  }
  eval(_stack) {
    return this.val;
  }
  toString() {
    const v = this.val;
    return typeof v === "string" ? `'${v}'` : `${v}`;
  }
}
export class VarVal extends BaseVal {}
export class StrTplVal extends VarVal {
  constructor(vals) {
    super();
    this.vals = vals;
  }
  render(stack, _rx) {
    return this.eval(stack);
  }
  eval(stack) {
    const strs = new Array(this.vals.length);
    for (let i = 0; i < this.vals.length; i++) strs[i] = this.vals[i]?.eval(stack, "");
    return strs.join("");
  }
  static parse(s, px) {
    const parts = s.split(STR_TPL_SPLIT_RE);
    const vals = new Array(parts.length);
    let allConsts = true;
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i];
      const isExpr = s[0] === "{" && s.at(-1) === "}";
      const val = isExpr ? vp.parseText(s.slice(1, -1), px) : new ConstVal(s);
      vals[i] = val;
      allConsts &&= val instanceof ConstVal;
    }
    if (allConsts) return new ConstVal(vals.map((v) => v.val).join(""));
    let lo = 0;
    let hi = vals.length;
    while (lo < hi && vals[lo] instanceof ConstVal && vals[lo].val === "") lo++;
    while (hi > lo && vals[hi - 1] instanceof ConstVal && vals[hi - 1].val === "") hi--;
    return new StrTplVal(lo === 0 && hi === vals.length ? vals : vals.slice(lo, hi));
  }
}
export class NameVal extends VarVal {
  constructor(name) {
    super();
    this.name = name;
  }
  eval(stack) {
    return stack.lookupName(this.name);
  }
  toString() {
    return this.name;
  }
}
export class HandlerNameVal extends NameVal {
  constructor(name, namespace) {
    super(name);
    this.namespace = namespace;
  }
  eval(stack) {
    return (
      stack.getHandlerFor(this.name, this.namespace) ?? mk404Handler(this.namespace, this.name)
    );
  }
}
const mk404Handler = (type, name) =>
  function (...args) {
    console.warn("handler not found", { type, name, args }, this);
    return this;
  };
export class TypeVal extends NameVal {
  eval(stack) {
    return stack.lookupType(this.name);
  }
}
export class RequestVal extends NameVal {
  eval(stack) {
    return stack.lookupRequest(this.name);
  }
  toString() {
    return `!${this.name}`;
  }
}
export class RawFieldVal extends NameVal {
  eval(stack) {
    return stack.lookupFieldRaw(this.name);
  }
  toString() {
    return `.${this.name}`;
  }
}
export class RenderVal extends BaseVal {
  render(stack, _rx) {
    return this.eval(stack);
  }
}
export class RenderNameVal extends RenderVal {
  constructor(name) {
    super();
    this.name = name;
  }
}
export class BindVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupBind(this.name);
  }
  toString() {
    return `@${this.name}`;
  }
}
export class DynVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupDynamic(this.name);
  }
  toPathItem() {
    return null;
  }
  toString() {
    return `*${this.name}`;
  }
}
export class FieldVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupField(this.name);
  }
  toPathItem() {
    return new FieldStep(this.name);
  }
  toRawFieldVal() {
    return new RawFieldVal(this.name);
  }
  toString() {
    return `.${this.name}`;
  }
}
export class SeqAccessVal extends RenderVal {
  constructor(seqVal, keyVal) {
    super();
    this.seqVal = seqVal;
    this.keyVal = keyVal;
  }
  toPathItem() {
    return new SeqAccessStep(this.seqVal.name, this.keyVal.name);
  }
  eval(stack) {
    const key = this.keyVal.eval(stack);
    return this.seqVal.eval(stack)?.get(key, null);
  }
  toString() {
    return `${this.seqVal}[${this.keyVal}]`;
  }
}
const VAL_SUB_TYPE_STRING_TEMPLATE = 0;
const VAL_SUB_TYPE_SEQ_ACCESS = 1;
const VAL_SUB_TYPE_INVALID = 2;
const VAL_SUB_TYPE_CONST_STRING = 3;
function getValSubType(s) {
  let open = 0;
  let close = 0;
  for (let i = 0; i < s.length; i++) {
    switch (s.charCodeAt(i)) {
      case 91: // [
        if (open > 0) return VAL_SUB_TYPE_INVALID;
        open += 1;
        break;
      case 93: // ]
        if (close > 0 || open === 0) return VAL_SUB_TYPE_INVALID;
        close += 1;
        break;
      case 123: // {
        return VAL_SUB_TYPE_STRING_TEMPLATE;
      case 125: // } (may be an invalid template, treat it like a string constant)
        return VAL_SUB_TYPE_CONST_STRING;
    }
  }
  if (open > 0 || close > 0)
    return open === 1 && close === 1 ? VAL_SUB_TYPE_SEQ_ACCESS : VAL_SUB_TYPE_INVALID;
  return -1;
}
export const vp = new ValParser();

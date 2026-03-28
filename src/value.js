import { FieldStep, SeqAccessStep } from "./path.js";

const VALID_VAL_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const isValidValId = (name) => VALID_VAL_ID_RE.test(name);
const VALID_FLOAT_RE = /^-?[0-9]+(\.[0-9]+)?$/;
const parseStrTemplate = (v, px) => StrTplVal.parse(v, px);
const parseConst = (v, _) => new ConstVal(v);
const parseName = (v, _) => (isValidValId(v) ? new NameVal(v) : null);
const parseType = (v, _) => (isValidValId(v) ? new TypeVal(v) : null);
const parseBind = (v, _) => (isValidValId(v) ? new BindVal(v) : null);
const parseDyn = (v, _) => (isValidValId(v) ? new DynVal(v) : null);
const parseField = (v, _) => (isValidValId(v) ? new FieldVal(v) : null);
const parseComp = (v, _) => (isValidValId(v) ? new ComputedVal(v) : null);
const parseReq = (v, _) => (isValidValId(v) ? new RequestVal(v) : null);
export class ValParser {
  constructor() {
    this.allowFieldOnly();
    this.bindValIt = new BindVal("it");
    this.nullConstVal = new ConstVal(null);
  }
  const(v) {
    return new ConstVal(v);
  }
  allowFieldOnly() {
    this.okField = true;
    this.okBind = false;
    this.okComputed = false;
    this.okDyn = false;
    this.okType = false;
    this.okRequest = false;
    this.okName = false;
    this.okConst = false;
    this.okStrTpl = false;
    this.okSeqAccess = false;
  }
  parseIfOk(s, px, isOk, parseFn) {
    return isOk ? parseFn(s, px) : null;
  }
  _parseSeqAccess(s, px) {
    if (!this.okSeqAccess) {
      return null;
    }
    const openSquareBracketIndex = s.indexOf("[");
    this.allowFieldOnly();
    const left = this.parse(s.slice(0, openSquareBracketIndex), px);
    const right = this.parse(s.slice(openSquareBracketIndex + 1, -1), px);
    return left && right ? new SeqAccessVal(left, right) : null;
  }
  parse(s, px) {
    switch (getValSubType(s)) {
      case VAL_SUB_TYPE_STRING_TEMPLATE:
        return this.parseIfOk(s, px, this.okStrTpl, parseStrTemplate);
      case VAL_SUB_TYPE_CONST_STRING:
        return this.parseIfOk(s, px, this.okStrTpl, parseConst);
      case VAL_SUB_TYPE_SEQ_ACCESS:
        return this._parseSeqAccess(s, px);
      case VAL_SUB_TYPE_INVALID:
        return this.parseIfOk(s, px, this.okStrTpl, parseStrTemplate);
    }
    const charCode = s.charCodeAt(0);
    switch (charCode) {
      case 94: {
        const newS = px.frame.macroVars?.[s.slice(1)];
        if (newS !== undefined) {
          return this.parse(newS, px);
        }
        return null;
      }
      case 126: // ~ constant string with no spaces must use this prefix
        return this.parseIfOk(s.slice(1), px, this.okStrTpl, parseConst);
      case 39: // ''
        return this.parseIfOk(s.slice(1, -1), px, this.okStrTpl, parseConst);
      case 64: // @
        return this.parseIfOk(s.slice(1), px, this.okBind, parseBind);
      case 42: // *
        return this.parseIfOk(s.slice(1), px, this.okDyn, parseDyn);
      case 46: // .
        return this.parseIfOk(s.slice(1), px, this.okField, parseField);
      case 36: // $
        return this.parseIfOk(s.slice(1), px, this.okComputed, parseComp);
      case 33: // !
        return this.parseIfOk(s.slice(1), px, this.okRequest, parseReq);
    }
    const num = VALID_FLOAT_RE.test(s) ? parseFloat(s) : null;
    if (Number.isFinite(num)) {
      return this.parseIfOk(num, px, this.okConst, parseConst);
    } else if (s === "true" || s === "false") {
      return this.parseIfOk(s === "true", px, this.okConst, parseConst);
    } else if (charCode >= 97 /* a */ && charCode <= 122 /* z */) {
      return this.parseIfOk(s, px, this.okName, parseName);
    } else if (charCode >= 65 /* A */ && charCode <= 90 /* Z */) {
      return this.parseIfOk(s, px, this.okType, parseType);
    }
    return null;
  }
  parseDynamic(s, px) {
    this.allowFieldOnly();
    this.okComputed = true;
    return this.parse(s, px);
  }
  parseEach(s, px) {
    this.allowFieldOnly();
    this.okComputed = true; // NOTE: both only useful for leaf subtrees (can't transact)
    this.okDyn = true;
    return this.parse(s, px);
  }
  allowHandlerArg() {
    this.allowFieldOnly();
    this.okBind = true;
    this.okComputed = true;
    this.okDyn = true;
    this.okType = true;
    this.okRequest = true;
    this.okName = true;
    this.okConst = true;
  }
  parseHandlerArg(s, px) {
    this.allowHandlerArg();
    return this.parse(s, px);
  }
  _parseHandler(s, px, HandlerClass) {
    this.allowFieldOnly();
    this.okName = true;
    const val = this.parse(s, px);
    return val.toRawFieldVal ? val.toRawFieldVal() : new HandlerClass(val.name);
  }
  parseHandlerName(s, px) {
    return this._parseHandler(s, px, InputHandlerNameVal);
  }
  parseAlter(s, px) {
    return this._parseHandler(s, px, AlterHandlerNameVal);
  }
  parseAttr(s, px) {
    return this.parseText(s, px);
  }
  parseAll(s, px) {
    this.allowHandlerArg();
    this.okStrTpl = true;
    this.okSeqAccess = true;
    return this.parse(s, px);
  }
  parseCondValue(s, px) {
    this.allowFieldOnly();
    this.okBind = true;
    this.okComputed = true;
    this.okDyn = true;
    this.okConst = true;
    return this.parse(s, px);
  }
  parseText(s, px) {
    this.allowFieldOnly();
    this.okBind = true;
    this.okComputed = true;
    this.okDyn = true;
    this.okConst = true;
    this.okStrTpl = true;
    return this.parse(s, px);
  }
  parseRender(s, px) {
    this.allowFieldOnly();
    this.okSeqAccess = true;
    return this.parse(s, px);
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
  constructor(value) {
    super();
    this.value = value;
  }
  render(_stack, _rx) {
    return this.value;
  }
  eval(_stack) {
    return this.value;
  }
  toString() {
    const v = this.value;
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
    for (let i = 0; i < this.vals.length; i++) {
      strs[i] = this.vals[i]?.eval(stack, "");
    }
    return strs.join("");
  }
  static parse(s, px) {
    const parts = s.split(/(\{[^}]+\})/g);
    const vals = new Array(parts.length);
    let allConsts = true;
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i];
      const isExpr = s[0] === "{" && s.at(-1) === "}";
      const val = isExpr ? vp.parseText(s.slice(1, -1), px) : new ConstVal(s);
      vals[i] = val;
      allConsts &&= val instanceof ConstVal;
    }
    return allConsts ? new ConstVal(vals.map((v) => v.value).join("")) : new StrTplVal(vals);
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
export class InputHandlerNameVal extends NameVal {
  eval(stack) {
    return stack.getInputHandler(this.name) ?? mk404Handler("input", this.name);
  }
}
export class AlterHandlerNameVal extends NameVal {
  eval(stack) {
    return stack.getAlterHandler(this.name) ?? mk404Handler("alter", this.name);
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
export class ComputedVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupComputed(this.name);
  }
  toString() {
    return `$${this.name}`;
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
    return this.seqVal.eval(stack).get(key, null);
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
        if (open > 0) {
          return VAL_SUB_TYPE_INVALID;
        }
        open += 1;
        break;
      case 93: // ]
        if (close > 0 || open === 0) {
          return VAL_SUB_TYPE_INVALID;
        }
        close += 1;
        break;
      case 123: // {
        return VAL_SUB_TYPE_STRING_TEMPLATE;
      case 125: // } (may be an invalid template, treat it like a string constant)
        return VAL_SUB_TYPE_CONST_STRING;
    }
  }
  if (open > 0 || close > 0) {
    return open === 1 && close === 1 ? VAL_SUB_TYPE_SEQ_ACCESS : VAL_SUB_TYPE_INVALID;
  }
  return -1;
}
export const vp = new ValParser();

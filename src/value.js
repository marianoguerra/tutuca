import { is } from "../deps/immutable.js";
import { FieldStep, SeqAccessStep } from "./path.js";

// An identifier: a letter then letters/digits/underscores, with an optional
// trailing `?`. The `?` lets predicate names (`empty?`, `equals?`) parse as
// ordinary `NameVal` tokens, so a predicate call is just a token sequence.
const VALID_VAL_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*\??$/;
const isValidValId = (name) => VALID_VAL_ID_RE.test(name);
const VALID_FLOAT_RE = /^-?[0-9]+(\.[0-9]+)?$/;
const STR_TPL_SPLIT_RE = /(\{[^}]+\})/g; // Safe to share despite `g` flag: only used in split
const mkVal = (name, Cls) => (isValidValId(name) ? new Cls(name) : null);

// The single value tokenizer: a `$'…'` template run, a plain `'…'` string
// literal, or a whitespace-free run. Alternation order matters — the quoted
// alternatives must precede `\S+` so it never swallows `$'foo` up to the next
// space. Inside a quoted run `\\.` keeps escaped `\'`/`\\` in the token. Safe
// to share despite the `g` flag: only used via String.match.
const VAL_TOKEN_RE = /\$'(?:[^'\\]|\\.)*'|'(?:[^'\\]|\\.)*'|\S+/g;
export const tokenizeValue = (s) => s.match(VAL_TOKEN_RE) ?? [];
// Within a `'…'` literal only the delimiter and the escape char are
// escapable; every other backslash stays literal.
const unescapeStr = (s) => s.replace(/\\(['\\])/g, "$1");

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
const K_STR = 512; // plain `'…'` string literal (no `{…}` interpolation)
const K_METHOD = 1024; // `$name` no-arg method call

// Value groups, one per parsing context. Kept private: callers use the named
// `parseX` methods below so they never have to know about the bitmasks.
// `K_METHOD` is in every value-read group but never in a path-bearing one
// (`G_COMPONENT`, `G_SEQUENCE`): a method result has no addressable path, so
// `$m` in `@each`/`<x render>` is a parse error rather than a silent failure.
const G_BOOL = K_FIELD | K_METHOD | K_BIND | K_DYN | K_CONST;
const G_TEXT = G_BOOL | K_STRTPL;
const G_COMPONENT = K_FIELD | K_SEQ;
const G_SEQUENCE = K_FIELD | K_DYN;
const G_FIELD = K_FIELD | K_METHOD | K_CONST | K_STR;
const G_VALUE = K_FIELD | K_METHOD | K_BIND | K_DYN | K_NAME | K_TYPE | K_REQUEST | K_CONST;
const G_PRED_ARG = G_BOOL | K_STR; // boolean-predicate arguments
const G_HANDLER_ARG = G_VALUE | K_STR; // event-handler arguments
const G_ALL = G_VALUE | K_STRTPL | K_SEQ;

// Boolean predicates usable in conditional slots, e.g. `@show="empty? .items"`.
// `sizeOf` reads `.size` (immutable List/Map/Set/OrderedMap/Record) or
// `.length` (string/array), so predicates need no field-type info.
function sizeOf(v) {
  if (v == null) return null;
  const s = v.size;
  if (typeof s === "number") return s;
  const l = v.length;
  return typeof l === "number" ? l : null;
}
const predTruthy = (v) => {
  const n = sizeOf(v);
  return n === null ? !!v : n > 0;
};
const PREDICATES = {
  "empty?": { name: "empty?", arity: 1, fn: (v) => v == null || sizeOf(v) === 0 },
  "truthy?": { name: "truthy?", arity: 1, fn: predTruthy },
  "falsy?": { name: "falsy?", arity: 1, fn: (v) => !predTruthy(v) },
  "null?": { name: "null?", arity: 1, fn: (v) => v == null },
  "equals?": { name: "equals?", arity: 2, fn: (a, b) => is(a, b) },
};

export class ValParser {
  constructor() {
    this.bindValIt = new BindVal("it");
    this.nullConstVal = new ConstVal(null);
  }
  const(v) {
    return new ConstVal(v);
  }
  // Parse a single token into the richest `BaseVal` it can be, with no
  // context/kind filtering — that is the validators' job. Returns null when
  // the token is not a well-formed value.
  parseToken(s, px) {
    const c0 = s.charCodeAt(0);
    // Quoted tokens first: their `[` `]` `{` `}` are literal content, so they
    // must be handled before the bracket checks below.
    if (c0 === 39)
      // '…' string literal
      return s.length >= 2 && s.charCodeAt(s.length - 1) === 39
        ? new ConstVal(unescapeStr(s.slice(1, -1)), K_STR | K_STRTPL)
        : null;
    if (c0 === 36 && s.charCodeAt(1) === 39)
      // $'…' string template
      return s.length >= 3 && s.charCodeAt(s.length - 1) === 39
        ? StrTplVal.parse(s.slice(2, -1), px)
        : null;
    // Sequence access `.seq[.key]` — checked before the prefix switch since
    // the token starts with the `.` of its left-hand `FieldVal`.
    if (s.indexOf("[") !== -1 || s.indexOf("]") !== -1) return this._parseSeqAccess(s, px);
    // A bare `{…}` is a legacy unquoted template — no longer supported; it now
    // fails to parse (use `$'…'`). The linter turns this into a hint.
    if (s.indexOf("{") !== -1 || s.indexOf("}") !== -1) return null;
    switch (c0) {
      case 94: {
        // ^name macro variable
        const name = s.slice(1);
        const newS = px.frame.macroVars?.[name];
        if (newS !== undefined) {
          const tokens = tokenizeValue(newS.trim());
          return tokens.length === 1 ? this.parseToken(tokens[0], px) : null;
        }
        px.onParseIssue("bad-value", { role: "macro-var", name, value: s });
        return null;
      }
      case 36: // $name method call (a `$'…'` template was handled above)
        return mkVal(s.slice(1), MethodVal);
      case 64: // @name bind
        return mkVal(s.slice(1), BindVal);
      case 42: // *name dynamic
        return mkVal(s.slice(1), DynVal);
      case 46: // .name field
        return mkVal(s.slice(1), FieldVal);
      case 33: // !name request
        return mkVal(s.slice(1), RequestVal);
    }
    const num = VALID_FLOAT_RE.test(s) ? parseFloat(s) : null;
    if (Number.isFinite(num)) return new ConstVal(num);
    if (s === "true" || s === "false") return new ConstVal(s === "true");
    if (c0 >= 97 /* a */ && c0 <= 122 /* z */) return mkVal(s, NameVal);
    if (c0 >= 65 /* A */ && c0 <= 90 /* Z */) return mkVal(s, TypeVal);
    return null;
  }
  // `seq[key]`: exactly one `[`, a closing `]` as the last char, both sides
  // plain `FieldVal`s. Anything else (nested/unbalanced brackets) is rejected.
  _parseSeqAccess(s, px) {
    const open = s.indexOf("[");
    const close = s.indexOf("]");
    if (open < 1 || close !== s.length - 1 || close < open || s.indexOf("[", open + 1) !== -1)
      return null;
    const left = this.parseToken(s.slice(0, open), px);
    const right = this.parseToken(s.slice(open + 1, close), px);
    return left instanceof FieldVal && right instanceof FieldVal
      ? new SeqAccessVal(left, right)
      : null;
  }
  // Parse `s` as a single value and accept it only if its kind is in `group`.
  _parseSingle(s, px, group) {
    const tokens = tokenizeValue(s.trim());
    if (tokens.length !== 1) return null;
    const val = this.parseToken(tokens[0], px);
    return val !== null && kindOf(val) & group ? val : null;
  }
  // Conditionals: @show, @hide, @if.<attr>, x-op show/hide, x-wrapper attrs.
  // A single token is a plain G_BOOL value; multiple whitespace-separated
  // tokens are a predicate call like `empty? .items`.
  parseBool(s, px) {
    const t = s.trim();
    const tokens = tokenizeValue(t);
    if (tokens.length !== 1)
      return tokens.length === 0 ? null : this._parsePredicate(t, tokens, px);
    const val = this.parseToken(tokens[0], px);
    return val !== null && kindOf(val) & G_BOOL ? val : null;
  }
  // Text values: :attr, @text, <x text>, @then/@else, @push-view, @html.
  parseText(s, px) {
    return this._parseSingle(s, px, G_TEXT);
  }
  // A single component to render: <x render>.
  parseComponent(s, px) {
    return this._parseSingle(s, px, G_COMPONENT);
  }
  // A sequence to iterate: @each, <x render-each>.
  parseSequence(s, px) {
    return this._parseSingle(s, px, G_SEQUENCE);
  }
  // A `dynamic:` field definition (and the `default` of a `dynamic` alias):
  // a field/method reference or a constant value.
  parseField(s, px) {
    return this._parseSingle(s, px, G_FIELD);
  }
  // A single argument passed to an event handler.
  parseHandlerArg(s, px) {
    return this._parseSingle(s, px, G_HANDLER_ARG);
  }
  // Pass-through values on a macro-call element (:attr on a macro).
  parseMacroAttr(s, px) {
    return this._parseSingle(s, px, G_ALL);
  }
  // Handler reference + args for @on.<event>. Returns `{handlerVal, args}` so
  // `EventHandler.parse` is a thin wrapper, or null on a bad handler name.
  parseInputHandler(s, px) {
    return this._parseHandler(s, px, "input", true, true);
  }
  // Handler reference for @when, @enrich-with/@scope, @loop-with. No args, and
  // silent on failure — the directive caller reports the issue.
  parseAlterHandler(s, px) {
    const r = this._parseHandler(s, px, "alter", false, false);
    return r === null ? null : r.handlerVal;
  }
  // `$name` -> a `MethodVal` (used via `evalAsHandler`); a bare name -> a
  // `HandlerNameVal`. No field syntax: a `.field` cannot be a handler.
  _parseHandler(s, px, namespace, allowArgs, report) {
    const tokens = tokenizeValue(s.trim());
    const headTok = tokens[0] ?? "";
    const head = headTok === "" ? null : this.parseToken(headTok, px);
    const hk = kindOf(head);
    let handlerVal;
    if (hk & K_METHOD) handlerVal = head;
    else if (hk & K_NAME) handlerVal = new HandlerNameVal(head.name, namespace);
    else {
      if (report) px.onParseIssue("bad-value", { role: "handler-name", value: headTok });
      return null;
    }
    if (!allowArgs) return tokens.length === 1 ? { handlerVal, args: [] } : null;
    const args = new Array(tokens.length - 1);
    for (let i = 1; i < tokens.length; i++) {
      const val = this.parseToken(tokens[i], px);
      if (val !== null && kindOf(val) & G_HANDLER_ARG) args[i - 1] = val;
      else {
        if (report) px.onParseIssue("bad-value", { role: "handler-arg", value: tokens[i] });
        args[i - 1] = this.nullConstVal;
      }
    }
    return { handlerVal, args };
  }
  // Mirrors EventHandler.parse: head token is the predicate, tail are its
  // args parsed individually as G_PRED_ARG values. `tokens.length > 1` here.
  _parsePredicate(s, tokens, px) {
    const predName = tokens[0];
    const pred = PREDICATES[predName];
    if (pred === undefined) {
      px.onParseIssue("bad-value", { role: "predicate", value: predName });
      return null;
    }
    const arity = tokens.length - 1;
    if (arity !== pred.arity) {
      px.onParseIssue("bad-value", { role: "predicate-arity", value: s, predicate: predName });
      return null;
    }
    const args = new Array(arity);
    for (let i = 0; i < arity; i++) {
      const tok = tokens[i + 1];
      const val = this.parseToken(tok, px);
      if (val === null || !(kindOf(val) & G_PRED_ARG)) {
        px.onParseIssue("bad-value", { role: "predicate-arg", value: tok });
        return null;
      }
      args[i] = val;
    }
    return new PredicateVal(pred, args);
  }
}
// The kind bit of a parsed value, used by the validators to check it against
// a context's group mask. `ConstVal` carries its own kind (a literal differs
// from a number); the rest are fixed per class.
function kindOf(val) {
  if (val === null) return 0;
  if (val instanceof ConstVal) return val.kind;
  if (val instanceof StrTplVal) return K_STRTPL;
  if (val instanceof SeqAccessVal) return K_SEQ;
  if (val instanceof FieldVal) return K_FIELD;
  if (val instanceof MethodVal) return K_METHOD;
  if (val instanceof BindVal) return K_BIND;
  if (val instanceof DynVal) return K_DYN;
  if (val instanceof RequestVal) return K_REQUEST;
  if (val instanceof TypeVal) return K_TYPE;
  if (val instanceof NameVal) return K_NAME;
  return 0;
}
export class BaseVal {
  render(_stack, _rx) {}
  eval(_stack) {}
  toPathItem() {
    return null;
  }
  // Value of this expression when it sits in handler position (`@on.<event>`,
  // `@when`, `@enrich-with`, `@loop-with`): the dispatch machinery calls the
  // result with the event args. Defaults to `eval`; `MethodVal` overrides it
  // to hand back the raw function instead of invoking it.
  evalAsHandler(stack) {
    return this.eval(stack);
  }
}
export class ConstVal extends BaseVal {
  constructor(val, kind = K_CONST) {
    super();
    this.val = val;
    this.kind = kind;
  }
  render(_stack, _rx) {
    return this.val;
  }
  eval(_stack) {
    return this.val;
  }
  toString() {
    const v = this.val;
    return typeof v === "string" ? `'${v.replace(/(['\\])/g, "\\$1")}'` : `${v}`;
  }
}
export class PredicateVal extends BaseVal {
  constructor(pred, args) {
    super();
    this.pred = pred;
    this.args = args;
  }
  eval(stack) {
    const n = this.args.length;
    const vals = new Array(n);
    for (let i = 0; i < n; i++) vals[i] = this.args[i].eval(stack);
    return this.pred.fn(...vals);
  }
  toString() {
    return `${this.pred.name} ${this.args.map(String).join(" ")}`;
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
  // `s` is the interior of a `$'…'` template (the text between `$'` and `'`).
  // The interior is unescaped once (`\'`, `\\`) then split on `{…}` groups:
  // text between them becomes a `ConstVal`, expressions inside braces are
  // parsed via `parseText`.
  static parse(s, px) {
    const parts = unescapeStr(s).split(STR_TPL_SPLIT_RE);
    const vals = new Array(parts.length);
    let allConsts = true;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isExpr = part[0] === "{" && part.at(-1) === "}";
      const val = isExpr ? vp.parseText(part.slice(1, -1), px) : new ConstVal(part);
      vals[i] = val;
      allConsts &&= val instanceof ConstVal;
    }
    if (allConsts) return new ConstVal(vals.map((v) => v.val).join(""), K_STRTPL);
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
// `.name`: a plain field read on `this`. Never invokes — a method referenced
// via `.name` is a lint error; use `$name` instead.
export class FieldVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupFieldRaw(this.name);
  }
  toPathItem() {
    return new FieldStep(this.name);
  }
  toString() {
    return `.${this.name}`;
  }
}
// `$name`: a no-arg method call on `this`. Has no `toPathItem` (inherits
// `BaseVal`'s `null`), so it cannot reach a path-bearing slot. In a value
// slot `eval` invokes the method; in handler position `evalAsHandler` hands
// back the raw function for the dispatch machinery to call with event args.
export class MethodVal extends RenderNameVal {
  eval(stack) {
    return stack.lookupMethod(this.name);
  }
  evalAsHandler(stack) {
    return stack.lookupFieldRaw(this.name);
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
    return this.seqVal.eval(stack)?.get(key, null);
  }
  toString() {
    return `${this.seqVal}[${this.keyVal}]`;
  }
}
export const vp = new ValParser();

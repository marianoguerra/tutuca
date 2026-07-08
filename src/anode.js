import { Attributes, getAttrParser } from "./attribute.js";
import { DynEachStep, DynStep, EachBindStep, EachRenderItStep, ScopeBindStep } from "./path.js";
import {
  callEnricher,
  filterAlwaysTrue,
  makeLoopCtx,
  nullLoopWith,
  unpackLoopResult,
} from "./renderer.js";
import { isMac } from "./util/env.js";
import { DynVal, vp } from "./value.js";
import { HTML_NS } from "./vdom.js";

// Resolve the producer of a dynamic variable `name` declared on component
// `comp`: walk a LookupInfo (`lookup: { x: { for: "Producer.y" } }`) to the
// producing component and read that provide's own field path; a `provide`
// resolves to `comp` itself. Returns the producer component id plus the steps
// (normally one FieldStep) that locate the value in the producer, or null when
// it cannot be resolved.
function resolveDynProducer(comp, name) {
  let producerComp, producerProvide;
  const lk = comp?.lookup?.[name];
  if (lk != null) {
    // LookupInfo: forwards to another component's provide.
    producerComp = comp.scope?.lookupComponent(lk.compName);
    producerProvide = producerComp?.provide?.[lk.provideName];
  } else {
    const p = comp?.provide?.[name];
    if (p == null) return null;
    producerComp = comp;
    producerProvide = p;
  }
  if (producerComp == null || producerProvide == null) return null;
  const pi = producerProvide.val?.toPathItem?.() ?? null;
  return { producerCompId: producerComp.id, producerSteps: pi ? [pi] : [] };
}

class BaseNode {
  render(_stack, _rx) {
    return null;
  }
  setDataAttr(key, val) {
    console.warn("setDataAttr not implemented for", this, { key, val });
  }
  isConstant() {
    return false;
  }
  isWhiteSpace() {
    return false;
  }
  optimize() {}
}
export class TextNode extends BaseNode {
  constructor(val) {
    super();
    this.val = val;
  }
  render(_stack, _rx) {
    return this.val;
  }
  isWhiteSpace() {
    for (let i = 0; i < this.val.length; i++) {
      const c = this.val.charCodeAt(i);
      if (!(c === 32 || c === 10 || c === 9 || c === 13)) return false;
    }
    return true;
  }
  hasNewLine() {
    for (let i = 0; i < this.val.length; i++) {
      const c = this.val.charCodeAt(i);
      if (c === 10 || c === 13) return true;
    }
    return false;
  }
  condenseWhiteSpace(replacement = "") {
    this.val = replacement;
  }
  isConstant() {
    return true;
  }
  setDataAttr(_key, _val) {}
}
export class CommentNode extends TextNode {
  render(_stack, rx) {
    return rx.renderComment(this.val);
  }
}
function optimizeChilds(childs) {
  for (let i = 0; i < childs.length; i++) {
    const child = childs[i];
    if (child.isConstant()) childs[i] = new RenderOnceNode(child);
    else child.optimize();
  }
}
function optimizeNode(node) {
  if (node.isConstant()) return new RenderOnceNode(node);
  node.optimize();
  return node;
}
class ChildsNode extends BaseNode {
  constructor(childs) {
    super();
    this.childs = childs;
  }
  isConstant() {
    return this.childs.every((v) => v.isConstant());
  }
  optimize() {
    optimizeChilds(this.childs);
  }
}
export class DomNode extends ChildsNode {
  constructor(tagName, attrs, childs, namespace = null) {
    super(childs);
    this.tagName = tagName;
    this.attrs = attrs;
    this.namespace = namespace;
  }
  render(stack, rx) {
    const childNodes = new Array(this.childs.length);
    for (let i = 0; i < childNodes.length; i++)
      childNodes[i] = this.childs[i]?.render?.(stack, rx) ?? null;
    return rx.renderTag(this.tagName, this.attrs.eval(stack), childNodes, this.namespace);
  }
  setDataAttr(key, val) {
    this.attrs.setDataAttr(key, val);
  }
  isConstant() {
    return this.attrs.isConstant() && super.isConstant();
  }
}
export class FragmentNode extends ChildsNode {
  render(stack, rx) {
    return rx.renderFragment(this.childs.map((c) => c?.render(stack, rx)));
  }
  setDataAttr(key, val) {
    for (const child of this.childs) child.setDataAttr(key, val);
  }
}
const maybeFragment = (xs) => (xs.length === 1 ? xs[0] : new FragmentNode(xs));
const VALID_NODE_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
export class ANode extends BaseNode {
  constructor(nodeId, val) {
    super();
    this.nodeId = nodeId;
    this.val = val;
  }
  toPathStep(ctx) {
    return ctx.applyKey(this.val?.toPathItem?.() ?? null);
  }
  static parse(html, px) {
    const nodes = px.parseHTML(html);
    if (nodes.length === 0) return new CommentNode("Empty View in ANode.parse");
    if (nodes.length === 1) return ANode.fromDOM(nodes[0], px);
    const childs = [];
    for (let i = 0; i < nodes.length; i++) {
      const child = ANode.fromDOM(nodes[i], px);
      if (child !== null) childs.push(child);
    }
    const trimmed = condenseChildsWhites(childs);
    if (trimmed.length === 0) return new CommentNode("Empty View in ANode.parse");
    return maybeFragment(trimmed);
  }
  static fromDOM(node, px) {
    if (node instanceof px.Text) return new TextNode(node.textContent);
    else if (node instanceof px.Comment) return new CommentNode(node.textContent);
    const { childNodes, attributes: attrs, tagName: tag } = node;
    const childs = [];
    for (let i = 0; i < childNodes.length; i++) {
      const child = ANode.fromDOM(childNodes[i], px);
      if (child !== null) childs.push(child);
    }
    const prevTag = px.currentTag;
    px.currentTag = tag;
    try {
      const isPseudoX = attrs[0]?.name === "@x";
      if (tag === "X" || isPseudoX) return parseXOp(attrs, childs, isPseudoX ? 1 : 0, px);
      else if (
        tag.charCodeAt(1) === 58 &&
        (tag.charCodeAt(0) === 88 || tag.charCodeAt(0) === 120)
      ) {
        const macroName = tag.slice(2).toLowerCase();
        if (macroName === "slot") {
          const slotName = attrs.getNamedItem("name")?.value ?? "_";
          return px.frame.macroSlots[slotName] ?? maybeFragment(childs);
        }
        const [nAttrs, wrappers] = Attributes.parse(attrs, px, true);
        px.onAttributes(nAttrs, wrappers, null, true, tag);
        return wrap(px.newMacroNode(macroName, nAttrs.toMacroVars(), childs), px, wrappers);
      } else if (VALID_NODE_RE.test(tag)) {
        const [nAttrs, wrappers, textChild] = Attributes.parse(attrs, px);
        px.onAttributes(nAttrs, wrappers, textChild, false, tag);
        if (textChild) childs.unshift(new RenderTextNode(null, textChild));
        const domChilds = tag !== "PRE" ? condenseChildsWhites(childs) : childs;
        // The template parser already namespaces SVG / MathML subtrees; carry
        // a non-HTML namespace through so the renderer uses createElementNS.
        const ns = node.namespaceURI;
        const namespace = ns && ns !== HTML_NS ? ns : null;
        return wrap(new DomNode(tag, nAttrs, domChilds, namespace), px, wrappers);
      }
      return new CommentNode(`Error: InvalidTagName ${tag}`);
    } finally {
      px.currentTag = prevTag;
    }
  }
}
function parseXOp(attrs, childs, opIdx, px) {
  // `<X>` with no attrs or a bare `@x` with no op attr: plain fragment.
  if (attrs.length <= opIdx) return maybeFragment(childs);
  const { name, value } = attrs[opIdx];
  if (X_OPS[name]?.ignoresChildren && hasMeaningfulChilds(childs))
    px.onParseIssue("x-op-ignores-children", { op: name });
  const asAttr = attrs.getNamedItem("as")?.value ?? null;
  const as = asAttr === null ? null : parseViewName(asAttr, px);
  let node;
  switch (name) {
    case "slot":
      node = new SlotNode(null, vp.const(value), maybeFragment(childs));
      break;
    case "text":
      node = px.addNodeIf(RenderTextNode, parseXOpVal(name, value, px, vp.parseText));
      break;
    case "render":
      node = px.addNodeIf(RenderNode, parseXOpVal(name, value, px, vp.parseComponent), as);
      break;
    case "render-it":
      node = px.addNodeIf(RenderItNode, vp.bindValIt, as);
      break;
    case "render-each":
      node = parseRenderEach(px, value, as, attrs);
      break;
    case "show": {
      const val = parseXOpVal(name, value, px, vp.parseBool);
      node = px.addNodeIf(ShowNode, val, maybeFragment(childs));
      break;
    }
    case "hide": {
      const val = parseXOpVal(name, value, px, vp.parseBool);
      node = px.addNodeIf(HideNode, val, maybeFragment(childs));
      break;
    }
    default:
      px.onParseIssue("unknown-x-op", { name, value });
      return new CommentNode(`Error: InvalidSpecialTagOp ${name}=${value}`);
  }
  return processXExtras(node, attrs, name, opIdx + 1, px);
}
function parseXOpVal(opName, value, px, parserFn) {
  const val = parserFn.call(vp, value, px);
  if (val === null) px.onParseIssue("bad-value", { role: "x-op", op: opName, value });
  return val;
}
// `as=` view selector: a dynamic text value like `@push-view`, but a bare
// identifier (e.g. `as="edit"`, which parses as a NameVal outside G_TEXT and so
// yields null) falls back to a literal const view name for backward compat.
function parseViewName(s, px) {
  return vp.parseText(s, px) ?? vp.const(s);
}
function processXExtras(node, attrs, opName, startIdx, px) {
  const { consumed, wrappable } = X_OPS[opName];
  const wrappers = [];
  for (let i = startIdx; i < attrs.length; i++) {
    const a = attrs[i];
    const aName = a.name;
    if (consumed.has(aName)) continue;
    // `@show`/`@hide` directives — and their legacy bare `show`/`hide` spelling —
    // wrap the op's output node. The bare form gets a deprecation nudge (see
    // maybeDeprecateBareXDirective).
    const atPrefixed = aName.charCodeAt(0) === 64;
    const baseName = atPrefixed ? aName.slice(1) : aName;
    const wrapper = wrappable ? X_OPS[baseName]?.wrapper : null;
    if (wrapper) {
      if (!atPrefixed) maybeDeprecateBareXDirective(px, opName, baseName);
      wrappers.push([wrapper, vp.parseBool(a.value, px)]);
      continue;
    }
    const issueInfo = { op: opName, name: aName, value: a.value };
    px.onParseIssue("unknown-x-attr", issueInfo);
  }
  for (let i = wrappers.length - 1; i >= 0; i--) {
    const [Cls, val] = wrappers[i];
    const wrapper = px.addNodeIf(Cls, val, node);
    if (wrapper !== null) node = wrapper;
  }
  return node;
}
// TEMPORARY (added 2026-07-08): the bare `show`/`hide`/`when` attrs on `<x>` ops
// are the legacy spelling of the `@show`/`@hide`/`@when` directives, which now
// work directly on `<x>` ops too. Bare forms still parse, but the linter nudges
// authors to the `@`-prefixed form (see docs/spec/simplification-plan.md item 3).
// Once the corpus is migrated, drop bare support entirely and remove this helper
// plus the DEPRECATED_BARE_X_DIRECTIVE lint rule. Reported via `onDeprecatedSyntax`
// (a lint-only hook) so the live app's base ParseContext stays silent.
function maybeDeprecateBareXDirective(px, opName, name) {
  px.onDeprecatedSyntax("bare-x-directive", { op: opName, name });
}
function wrap(node, px, wrappers) {
  if (wrappers) {
    for (let i = wrappers.length - 1; i >= 0; i--) {
      const wrapperNode = makeWrapperNode(wrappers[i], px);
      if (wrapperNode) {
        wrapperNode.wrapNode(node);
        node = wrapperNode;
      }
    }
  }
  return node;
}
function makeWrapperNode(data, px) {
  const Cls = WRAPPER_NODES[data.name];
  const node = Cls.register ? px.addNodeIf(Cls, data.val) : data.val && new Cls(null, data.val);
  if (node !== null && data.name === "each") {
    node.iterInfo.enrichWithVal = data.enrichWithVal ?? null;
    node.iterInfo.whenVal = data.whenVal ?? null;
    node.iterInfo.loopWithVal = data.loopWithVal ?? null;
  }
  return node; // TODO: surface info if node is null here
}
export class MacroNode extends BaseNode {
  constructor(name, attrs, slots, px) {
    super();
    this.name = name;
    this.attrs = attrs;
    this.slots = slots;
    this.px = px;
    this.node = null;
    this.dataAttrs = {};
  }
  compile(scope) {
    const { name, attrs, slots } = this;
    if (this.px.isInsideMacro(name)) throw new Error(`Recursive macro expansion: ${name}`);
    const macro = scope.lookupMacro(name);
    if (macro === null) this.node = new CommentNode(`bad macro: ${name}`);
    else {
      const vars = { ...macro.defaults, ...attrs };
      this.node = macro.expand(this.px.enterMacro(name, vars, slots));
      for (const key in this.dataAttrs) this.node.setDataAttr(key, this.dataAttrs[key]);
    }
  }
  render(stack, rx) {
    return this.node.render(stack, rx);
  }
  setDataAttr(key, val) {
    this.dataAttrs[key] = val;
  }
  isConstant() {
    return this.node.isConstant();
  }
  optimize() {
    this.node = optimizeNode(this.node);
  }
}
export class Macro {
  constructor(defaults, rawView) {
    this.defaults = defaults;
    this.rawView = rawView;
  }
  expand(px) {
    return ANode.parse(this.rawView, px);
  }
}
class RenderViewId extends ANode {
  constructor(nodeId, val, viewVal) {
    super(nodeId, val);
    this.viewVal = viewVal;
  }
  // The `as=` view selector, evaluated against the host (enclosing) stack like
  // `@push-view`. Null when `as=` is absent, so the renderer falls through to
  // `stack.lookupBestView`.
  evalViewName(stack) {
    return this.viewVal ? this.viewVal.eval(stack) : null;
  }
  // A `<x render*>` produces no DOM element of its own to carry `data-cid`;
  // when it is a view's root the component boundary is recorded in the `Comp`
  // meta comment instead (see Renderer._rValComp), so this is a no-op.
  setDataAttr(_key, _val) {}
}
// Build the teleporting step for a dynamic render target `name` produced
// relative to `comp`: a DynStep, or a keyed DynEachStep when `key` is given.
// Returns null when the producer can't be resolved.
function dynRenderStep(comp, name, key) {
  const p = resolveDynProducer(comp, name);
  if (!p) return null;
  return key === undefined
    ? new DynStep(p.producerCompId, p.producerSteps)
    : new DynEachStep(p.producerCompId, p.producerSteps, key);
}
export class RenderNode extends RenderViewId {
  render(stack, rx) {
    const newStack = stack.enter(this.val.eval(stack), {}, true);
    return rx.renderIt(newStack, this, "", this.evalViewName(stack));
  }
  toPathStep(ctx) {
    if (this.val instanceof DynVal) return dynRenderStep(ctx.comp, this.val.name);
    return super.toPathStep(ctx);
  }
}
export class RenderItNode extends RenderViewId {
  render(stack, rx) {
    const newStack = stack.enter(stack.it, {}, true);
    return rx.renderIt(newStack, this, "", this.evalViewName(stack));
  }
  toPathStep(ctx) {
    const next = ctx.next();
    if (next === null) return null;
    const nextNode = next.resolveNode();
    if (nextNode instanceof EachNode && next.hasKey) {
      if (nextNode.val instanceof DynVal)
        return dynRenderStep(ctx.comp, nextNode.val.name, next.key);
      return new EachRenderItStep(nextNode.val.name, next.key);
    }
    return null;
  }
}
// `<x render-each="seq">` is syntactic sugar for `@each="seq"` wrapping a
// `<x render-it>`: it builds exactly that node pair so there is one iteration
// mechanism (EachNode + renderEachWhen) end to end — no dedicated render path or
// Step class. `@key`/`@value` therefore follow `@each` semantics: they live in
// the surrounding scope, and the `render-it` child sees a clean frame (they are
// NOT visible inside the item component's own view).
function parseRenderEach(px, value, as, attrs) {
  const seqVal = parseXOpVal("render-each", value, px, vp.parseSequence);
  if (seqVal === null) return null;
  const renderIt = px.addNodeIf(RenderItNode, vp.bindValIt, as);
  // Reuse the directive parser to read @when / @loop-with into an each wrapper,
  // then lift them onto the EachNode's iterInfo (there is no host element whose
  // attribute parse would otherwise carry them).
  const attrParser = getAttrParser(px);
  const eachAttr = (attrParser.eachAttr = attrParser.pushWrapper("each", value, seqVal));
  const when = attrs.getNamedItem("@when") ?? attrs.getNamedItem("when");
  if (when) {
    if (when.name.charCodeAt(0) !== 64) maybeDeprecateBareXDirective(px, "render-each", "when");
    attrParser._parseWhen(when.value);
  }
  const lWith = attrs.getNamedItem("loop-with");
  if (lWith) attrParser._parseLoopWith(lWith.value);
  const each = px.addNodeIf(EachNode, seqVal);
  each.iterInfo.whenVal = eachAttr.whenVal ?? null;
  each.iterInfo.loopWithVal = eachAttr.loopWithVal ?? null;
  // Marker so the linter checks this EachNode's @when/@loop-with in the node
  // loop — a render-each sugar node has no wrapperAttr entry to check instead.
  each.fromRenderEach = true;
  each.wrapNode(renderIt);
  return each;
}
export class RenderTextNode extends ANode {
  render(stack, _rx) {
    return this.val.eval(stack);
  }
  // Renders to a text node, which can't carry `data-cid`.
  setDataAttr(_key, _val) {}
}
export class RenderOnceNode extends BaseNode {
  constructor(node) {
    super();
    this.node = node;
    this._render = (stack, rx) => {
      const dom = node.render(stack, rx);
      this._render = (_stack, _rx) => dom;
      return dom;
    };
  }
  render(stack, rx) {
    return this._render(stack, rx);
  }
}
class WrapperNode extends ANode {
  constructor(nodeId, val, node = null) {
    super(nodeId, val);
    this.node = node;
  }
  wrapNode(node) {
    this.node = node;
  }
  setDataAttr(key, val) {
    this.node.setDataAttr(key, val);
  }
  optimize() {
    this.node = optimizeNode(this.node);
  }
  static register = false;
}
export class ShowNode extends WrapperNode {
  render(stack, rx) {
    return this.val.eval(stack) ? this.node.render(stack, rx) : null;
  }
}
export class HideNode extends WrapperNode {
  render(stack, rx) {
    return this.val.eval(stack) ? null : this.node.render(stack, rx);
  }
}
export class PushViewNameNode extends WrapperNode {
  render(stack, rx) {
    return this.node.render(stack.pushViewName(this.val.eval(stack)), rx);
  }
}
export class SlotNode extends WrapperNode {
  // Marker instead of `instanceof`: newMacroNode receives nodes that may come
  // from a different copy of this module (CLI tools import src/ while the
  // module under render imports the dist bundle), and cross-copy instanceof
  // is always false.
  isSlotNode = true;
  optimize() {
    this.node.optimize();
  }
}
export class ScopeNode extends WrapperNode {
  render(stack, rx) {
    const binds = this.val.evalAsHandler(stack)?.call(stack.it) ?? {};
    const dom = this.node.render(stack.enter(stack.it, binds, false), rx);
    // Emit a meta comment so event-path reconstruction can replay this scope's
    // binds (matches the §Each§ meta @each emits); see ScopeBindStep.
    return rx.renderScopeMeta(this.nodeId, dom);
  }
  toPathStep(_ctx) {
    return new ScopeBindStep(this.val);
  }
  wrapNode(node) {
    this.node = node;
    this.node.setDataAttr("data-nid", this.nodeId);
  }
  static register = true;
}
export class EachNode extends WrapperNode {
  constructor(nodeId, val) {
    super(nodeId, val);
    this.iterInfo = new IterInfo(val, null, null, null);
  }
  render(stack, rx) {
    return rx.renderEachWhen(stack, this.iterInfo, this.node, this.nodeId);
  }
  toPathStep(ctx) {
    return ctx.hasKey ? new EachBindStep(this.iterInfo, ctx.key) : null;
  }
  static register = true;
}
class IterInfo {
  constructor(val, whenVal, loopWithVal, enrichWithVal) {
    this.val = val;
    this.whenVal = whenVal;
    this.loopWithVal = loopWithVal;
    this.enrichWithVal = enrichWithVal;
  }
  eval(stack) {
    const seq = this.val.eval(stack) ?? [];
    const filter = this.whenVal?.evalAsHandler(stack) ?? filterAlwaysTrue;
    const loopWith = this.loopWithVal?.evalAsHandler(stack) ?? nullLoopWith;
    const enricher = this.enrichWithVal?.evalAsHandler(stack) ?? null;
    return { seq, filter, loopWith, enricher };
  }
  // Rebuild the per-item binds for `key`, mirroring renderEachWhen: seed
  // { key, value }, then run @enrich-with (with @loop-with's iterData) if any.
  enrichBinds(stack, key) {
    const { seq, filter, loopWith, enricher } = this.eval(stack);
    const value = seq?.get ? seq.get(key, null) : null;
    const binds = { key, value };
    if (enricher) {
      const { iterData } = unpackLoopResult(
        loopWith.call(stack.it, seq, makeLoopCtx(stack, filter)),
        seq,
      );
      callEnricher(enricher, stack.it, binds, key, value, iterData);
    }
    return binds;
  }
}
// consumed: attr names this op handles itself; wrappable: accepts show/hide wrapper
// attrs; wrapper: the node class to wrap with when this op's name is used as a wrapper attr
function xOp(consumed = [], { wrappable = false, wrapper = null, ignoresChildren = false } = {}) {
  return { consumed: new Set(consumed), wrappable, wrapper, ignoresChildren };
}
const X_OPS = {
  slot: xOp(),
  text: xOp([], { wrappable: true, ignoresChildren: true }),
  render: xOp(["as"], { wrappable: true, ignoresChildren: true }),
  "render-it": xOp(["as"], { wrappable: true, ignoresChildren: true }),
  // `@when` is consumed here (handled in parseRenderEach) so `processXExtras`
  // does not flag it as an unknown attr. TEMPORARY: bare `when` is deprecated in
  // favor of `@when` — see maybeDeprecateBareXDirective (added 2026-07-08).
  "render-each": xOp(["as", "when", "loop-with", "@when"], {
    wrappable: true,
    ignoresChildren: true,
  }),
  show: xOp([], { wrapper: ShowNode }),
  hide: xOp([], { wrapper: HideNode }),
};
const WRAPPER_NODES = {
  show: ShowNode,
  hide: HideNode,
  each: EachNode,
  // internal wrapper produced by a loop-less @enrich-with (no surface @scope directive)
  scope: ScopeNode,
  "push-view": PushViewNameNode,
};
export class ParseContext {
  constructor(document, Text, Comment, nodes, events, macroNodes, frame, parent) {
    this.nodes = nodes ?? [];
    this.events = events ?? [];
    this.macroNodes = macroNodes ?? [];
    this.parent = parent ?? null;
    this.frame = frame ?? {};
    this.document = document ?? globalThis.document;
    this.Text = Text ?? globalThis.Text;
    this.Comment = Comment ?? globalThis.Comment;
    this.cacheConstNodes = true;
    this.currentTag = null;
  }
  isInsideMacro(name) {
    return this.frame.macroName === name || this.parent?.isInsideMacro(name);
  }
  enterMacro(macroName, macroVars, macroSlots) {
    const { document, Text, Comment, nodes, events, macroNodes } = this;
    const frame = { macroName, macroVars, macroSlots };
    return new ParseContext(document, Text, Comment, nodes, events, macroNodes, frame, this);
  }
  parseHTML(html) {
    const t = this.document.createElement("template");
    t.innerHTML = html;
    return t.content.childNodes;
  }
  addNodeIf(Class, val, extra) {
    if (val !== null) {
      const nodeId = this.nodes.length;
      const node = new Class(nodeId, val, extra);
      this.nodes.push(node);
      return node;
    }
    return null;
  }
  registerEvents() {
    const id = this.events.length;
    const events = new NodeEvents(id);
    this.events.push(events);
    return events;
  }
  newMacroNode(macroName, mAttrs, childs) {
    const anySlot = [];
    const slots = { _: new FragmentNode(anySlot) };
    for (const child of childs)
      if (child.isSlotNode) slots[child.val.val] = child.node;
      else if (!child.isWhiteSpace()) anySlot.push(child);
    const node = new MacroNode(macroName, mAttrs, slots, this);
    this.macroNodes.push(node);
    return node;
  }
  compile(scope) {
    for (let i = 0; i < this.macroNodes.length; i++) this.macroNodes[i].compile(scope); // macroNodes may grow w/nested macros
  }
  *genEventNames() {
    for (const event of this.events) yield* event.genEventNames();
  }
  getEventForId(id) {
    return this.events[id] ?? null;
  }
  getNodeForId(id) {
    return this.nodes[id] ?? null;
  }
  onAttributes(_attrs, _wrapperAttrs, _textChild, _isMacroCall, _tag) {}
  onParseIssue(kind, info) {
    console.warn(`tutuca parse issue [${kind}]`, info);
  }
  // Lint-only channel for deprecation nudges on still-valid syntax; the base
  // (runtime) context ignores them so live apps stay quiet. See LintParseContext.
  onDeprecatedSyntax(_kind, _info) {}
}
const _htmlBlockTags =
  "ADDRESS,ARTICLE,ASIDE,BLOCKQUOTE,CAPTION,COL,COLGROUP,DETAILS,DIALOG,DIV,DD,DL,DT,FIELDSET,FIGCAPTION,FIGURE,FOOTER,FORM,H1,H2,H3,H4,H5,H6,HEADER,HGROUP,HR,LEGEND,LI,MAIN,MENU,NAV,OL,P,PRE,SECTION,SUMMARY,TABLE,TBODY,TD,TFOOT,TH,THEAD,TR,UL";
const HTML_BLOCK_TAGS = new Set(_htmlBlockTags.split(","));
const isBlockDomNode = (n) => {
  const node = n instanceof FragmentNode ? n.childs[0] : n;
  return node instanceof DomNode && HTML_BLOCK_TAGS.has(node.tagName);
};
const isEmptyText = (c) => c instanceof TextNode && c.val === "";
// A child an `<x>` op may legitimately carry even when the op ignores its body:
// insignificant whitespace (childs here aren't run through condenseChildsWhites,
// so whitespace TextNodes survive) and comments (CommentNode extends TextNode but
// its text isn't whitespace, so exclude it by type, not by isWhiteSpace).
const isIgnorableXChild = (c) => c instanceof CommentNode || (c.isWhiteSpace?.() ?? false);
const hasMeaningfulChilds = (childs) => childs.some((c) => !isIgnorableXChild(c));
// Collapse a leading/trailing whitespace child to nothing; returns whether it
// became an empty node that the final filter should drop.
function trimEdgeWhite(node) {
  if (!node.isWhiteSpace?.()) return false;
  node.condenseWhiteSpace();
  return true;
}
// Normalize insignificant whitespace between an element's children:
//  - leading/trailing whitespace is dropped
//  - an interior whitespace run with a newline collapses to a single space,
//    or to nothing when it sits between two block-level elements
// Empty text nodes produced this way are filtered out (allocating a new array
// only when something actually changed).
function condenseChildsWhites(childs) {
  if (childs.length === 0) return childs;
  const last = childs.length - 1;

  let emptied = trimEdgeWhite(childs[0]);
  if (last > 0 && trimEdgeWhite(childs[last])) emptied = true;

  for (let i = 1; i < last; i++) {
    const cur = childs[i];
    if (!(cur.isWhiteSpace?.() && cur.hasNewLine())) continue;
    const bothBlock = isBlockDomNode(childs[i - 1]) && isBlockDomNode(childs[i + 1]);
    cur.condenseWhiteSpace(bothBlock ? "" : " ");
    if (bothBlock) emptied = true;
  }

  return emptied ? childs.filter((c) => !isEmptyText(c)) : childs;
}
export class View {
  constructor(name, rawView = "No View Defined", style = "", anode = null, ctx = null) {
    this.name = name;
    this.anode = anode;
    this.style = style;
    this.ctx = ctx;
    this.rawView = rawView;
  }
  compile(ctx, scope, cid) {
    this.ctx = ctx;
    this.anode = ANode.parse(this.rawView, ctx);
    this.anode.setDataAttr("data-cid", cid);
    this.anode.setDataAttr("data-vid", this.name);
    this.ctx.compile(scope);
    if (ctx.cacheConstNodes) this.anode = optimizeNode(this.anode);
  }
  render(stack, rx) {
    // A null anode means this view was never compiled — i.e. a value whose component
    // is not registered in the rendering scope was rendered (getCompFor resolves the
    // component off the value itself, bypassing the registry). Fail loud, but name the
    // view and show a snippet instead of the cryptic `null.render` TypeError.
    if (this.anode === null) {
      throw new Error(
        `tutuca: view "${this.name}" was rendered before it was compiled — its ` +
          `component is not registered in this app/scope. Source: ` +
          `${String(this.rawView).slice(0, 80).replace(/\s+/g, " ")}…`,
      );
    }
    return this.anode.render(stack, rx);
  }
}
export class NodeEvents {
  constructor(id) {
    this.id = id;
    this.handlers = [];
  }
  add(name, handlerCall, modifiers) {
    this.handlers.push(new NodeEvent(name, handlerCall, modifiers));
  }
  *genEventNames() {
    for (const handler of this.handlers) yield handler.name;
  }
  getHandlersFor(eventName) {
    let r = null;
    for (const handler of this.handlers)
      if (handler.handlesEventName(eventName)) {
        r ??= [];
        r.push(handler);
      }
    return r;
  }
}
class NodeEvent {
  constructor(name, handlerCall, modifiers) {
    this.name = name;
    this.handlerCall = handlerCall;
    this.modifierWrapper = compileModifiers(name, modifiers);
    this.modifiers = modifiers;
  }
  handlesEventName(name) {
    return this.name === name;
  }
  getHandlerAndArgs(stack, event) {
    const r = this.handlerCall.getHandlerAndArgs(stack, event);
    r[0] = this.modifierWrapper(r[0], event);
    return r;
  }
}
const fwdIfCtxPred = (pred) => (w) => (that, f, args, ctx) =>
  pred(ctx) ? w(that, f, args, ctx) : that;
const fwdIfKey = (keyName) => fwdIfCtxPred((ctx) => ctx.e.key === keyName);
const fwdCtrl = fwdIfCtxPred(({ e }) => (isMac && e.metaKey) || e.ctrlKey);
const fwdMeta = fwdIfCtxPred(({ e }) => e.metaKey);
const fwdAlt = fwdIfCtxPred(({ e }) => e.altKey);
const metaWraps = { ctrl: fwdCtrl, cmd: fwdCtrl, meta: fwdMeta, alt: fwdAlt };
export const MOD_WRAPPERS_BY_EVENT = {
  keydown: {
    send: fwdIfKey("Enter"),
    cancel: fwdIfKey("Escape"),
    ...metaWraps,
  },
  click: { ...metaWraps },
};
const identityModifierWrapper = (f, _ctx) => f;
export function compileModifiers(eventName, names) {
  if (names.length === 0) return identityModifierWrapper;
  const wrappers = MOD_WRAPPERS_BY_EVENT[eventName] ?? {};
  let w = (that, f, args, _ctx) => f.apply(that, args);
  for (const name of names) {
    const wrapper = wrappers[name];
    if (wrapper !== undefined) w = wrapper(w);
  }
  return (f, ctx) =>
    function (...args) {
      return w(this, f, args, ctx);
    };
}

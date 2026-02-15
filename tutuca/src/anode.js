import { Attributes, getAttrParser } from "./attribute.js";
import { BindStep } from "./path.js";
import { vp } from "./value.js";

export class BaseNode {
  render(_stack, rx) {
    return rx.renderEmpty();
  }
  setDataAttr(key, val) {
    console.warn("setDataAttr not implemented for", this, { key, val });
  }
  isConstant() {
    return false;
  }
  optimize() {}
}
export class TextNode extends BaseNode {
  constructor(v) {
    super();
    this.v = v;
  }
  render(_stack, rx) {
    return rx.renderText(this.v);
  }
  isWhiteSpace() {
    for (let i = 0; i < this.v.length; i++) {
      const c = this.v.charCodeAt(i);
      if (!(c === 32 || c === 10 || c === 9 || c === 13)) {
        return false;
      }
    }
    return true;
  }
  hasNewLine() {
    for (let i = 0; i < this.v.length; i++) {
      const c = this.v.charCodeAt(i);
      if (c === 10 || c === 13) {
        return true;
      }
    }
    return false;
  }
  condenseWhiteSpace() {
    this.v = "";
  }
  isConstant() {
    return true;
  }
  setDataAttr(_key, _val) {}
}
export class CommentNode extends TextNode {
  render(_stack, rx) {
    return rx.renderComment(this.v);
  }
}
function optimizeChilds(childs) {
  for (let i = 0; i < childs.length; i++) {
    const child = childs[i];
    if (child.isConstant()) {
      childs[i] = new RenderOnceNode(child);
    } else {
      child.optimize();
    }
  }
}
function optimizeNode(node) {
  if (node.isConstant()) {
    return new RenderOnceNode(node);
  }
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
  constructor(tagName, attrs, childs) {
    super(childs);
    this.tagName = tagName;
    this.attrs = attrs;
  }
  render(stack, rx) {
    const childNodes = new Array(this.childs.length);
    for (let i = 0; i < childNodes.length; i++) {
      childNodes[i] = this.childs[i]?.render?.(stack, rx) ?? null;
    }
    return rx.renderTag(this.tagName, this.attrs.eval(stack), childNodes);
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
    for (const child of this.childs) {
      child.setDataAttr(key, val);
    }
  }
}
const maybeFragment = (xs) => (xs.length === 1 ? xs[0] : new FragmentNode(xs));
const VALID_NODE_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
let _parser = null;
export class ANode extends BaseNode {
  constructor(nodeId, val) {
    super();
    this.nodeId = nodeId;
    this.val = val;
  }
  toPathItem() {
    return this.val.toPathItem();
  }
  static parse(html, px) {
    _parser ??= px.newDOMParser();
    const nodes = _parser.parseFromString(html, "text/html").body.childNodes;
    return ANode.fromDOM(nodes[0] ?? new px.Text(""), px);
  }
  static fromDOM(node, px) {
    if (px.isTextNode(node)) {
      return new TextNode(node.textContent);
    } else if (px.isCommentNode(node)) {
      return new CommentNode(node.textContent);
    }
    const { childNodes, attributes: attrs, tagName: tag } = node;
    const childs = new Array(childNodes.length);
    for (let i = 0; i < childNodes.length; i++) {
      childs[i] = ANode.fromDOM(childNodes[i], px);
    }
    if (tag === "X") {
      if (attrs.length === 0) {
        return maybeFragment(childs);
      }
      const { name, value } = attrs[0];
      const as = attrs.getNamedItem("as")?.value ?? null;
      switch (name) {
        case "slot":
          return new SlotNode(null, vp.const(value), maybeFragment(childs));
        case "text":
          return new RenderTextNode(null, vp.parseText(value, px) ?? vp.const(""));
        case "render":
          return px.addNodeIf(RenderNode, vp.parseRender(value, px), as);
        case "render-it":
          return px.addNodeIf(RenderItNode, vp.bindValIt, as);
        case "render-each":
          return RenderEachNode.parse(px, vp, value, as, attrs);
      }
      return new CommentNode(`Error: InvalidSpecialTagOp ${name}=${value}`);
    } else if (tag.charCodeAt(1) === 58 && tag.charCodeAt(0) === 88) {
      const macroName = tag.slice(2).toLowerCase();
      if (macroName === "slot") {
        const slotName = attrs.getNamedItem("name")?.value ?? "_";
        return px.frame.macroSlots[slotName] ?? maybeFragment(childs);
      }
      const [nAttrs, wrappers] = Attributes.parse(attrs, px, true);
      px.onAttributes(nAttrs, wrappers, null);
      return wrap(px.newMacroNode(macroName, nAttrs.toMacroVars(), childs), px, wrappers);
    } else if (VALID_NODE_RE.test(tag)) {
      const [nAttrs, wrappers, textChild] = Attributes.parse(attrs, px);
      px.onAttributes(nAttrs, wrappers, textChild);
      if (textChild) {
        childs.unshift(new RenderTextNode(null, textChild));
      }
      const domChilds = tag !== "PRE" ? condenseChildsWhites(childs) : childs;
      return wrap(new DomNode(tag.toLowerCase(), nAttrs, domChilds), px, wrappers);
    }
    return new CommentNode(`Error: InvalidTagName ${tag}`);
  }
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
  const node = Cls.register ? px.addNodeIf(Cls, data.val) : new Cls(null, data.val);
  if (data.name === "each") {
    node.iterInfo.enrichWithVal = data.enrichWithVal ?? null;
    node.iterInfo.whenVal = data.whenVal ?? null;
    node.iterInfo.loopWithVal = data.loopWithVal ?? null;
  }
  return node;
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
    if (this.px.isInsideMacro(name)) {
      throw new Error(`Recursive macro expansion: ${name}`);
    }
    const macro = scope.lookupMacro(name);
    if (macro === null) {
      this.node = new CommentNode(`bad macro: ${name}`);
    } else {
      const vars = { ...macro.defaults, ...attrs };
      this.node = macro.expand(this.px.enterMacro(name, vars, slots));
      for (const key in this.dataAttrs) {
        this.node.setDataAttr(key, this.dataAttrs[key]);
      }
    }
  }
  render(stack, rx) {
    return this.node.render(stack, rx);
  }
  setDataAttr(key, val) {
    this.dataAttrs[key] = val;
  }
  isConstant() {
    return this.node !== null && this.node.isConstant();
  }
  optimize() {
    if (this.node !== null) {
      this.node = optimizeNode(this.node);
    }
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
  constructor(nodeId, val, viewId) {
    super(nodeId, val);
    this.viewId = viewId;
  }
}
export class RenderNode extends RenderViewId {
  render(stack, rx) {
    const newStack = stack.enter(this.val.eval(stack), {}, true);
    return rx.renderIt(newStack, this.nodeId, "", this.viewId);
  }
}
export class RenderItNode extends RenderViewId {
  render(stack, rx) {
    return rx.renderIt(stack, this.nodeId, "", this.viewId);
  }
  pathInNext = true;
}
export class RenderEachNode extends RenderViewId {
  constructor(nodeId, val, viewId) {
    super(nodeId, val, viewId);
    this.iterInfo = new IterInfo(val, null, null, null);
  }
  render(stack, rx) {
    return rx.renderEach(stack, this.iterInfo, this.nodeId, this.viewId);
  }
  static parse(px, vp, s, as, attrs) {
    const node = px.addNodeIf(RenderEachNode, vp.parseEach(s, px), as);
    if (node !== null) {
      const attrParser = getAttrParser(px);
      attrParser.eachAttr = attrParser.pushWrapper("each", s, node.val);
      const when = attrs.getNamedItem("when");
      when && attrParser._parseWhen(when.value);
      const lWith = attrs.getNamedItem("loop-with");
      lWith && attrParser._parseLoopWith(lWith.value);
      node.iterInfo.whenVal = attrParser.eachAttr.whenVal ?? null;
      node.iterInfo.loopWithVal = attrParser.eachAttr.loopWithVal ?? null;
    }
    return node;
  }
}
export class RenderTextNode extends ANode {
  render(stack, rx) {
    return rx.renderText(this.val.eval(stack));
  }
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
export class WrapperNode extends ANode {
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
    return this.val.eval(stack) ? this.node.render(stack, rx) : rx.renderEmpty();
  }
}
export class HideNode extends WrapperNode {
  render(stack, rx) {
    return this.val.eval(stack) ? rx.renderEmpty() : this.node.render(stack, rx);
  }
}
export class PushViewNameNode extends WrapperNode {
  render(stack, rx) {
    return this.node.render(stack.pushViewName(this.val.eval(stack)), rx);
  }
}
export class SlotNode extends WrapperNode {
  optimize() {
    this.node.optimize();
  }
}
export class ScopeNode extends WrapperNode {
  render(stack, rx) {
    const bindings = this.val.eval(stack)?.call(stack.it) ?? {};
    return this.node.render(stack.enter(stack.it, bindings, false), rx);
  }
  toPathItem() {
    return new BindStep({});
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
  toPathItem() {
    return new BindStep({});
  }
  static register = true;
}
export class IterInfo {
  constructor(val, whenVal, loopWithVal, enrichWithVal) {
    this.val = val;
    this.whenVal = whenVal;
    this.loopWithVal = loopWithVal;
    this.enrichWithVal = enrichWithVal;
  }
  eval(stack) {
    const seq = this.val.eval(stack) ?? [];
    const filter = this.whenVal?.eval(stack) ?? filterAlwaysTrue;
    const loopWith = this.loopWithVal?.eval(stack) ?? nullLoopWith;
    const enricher = this.enrichWithVal?.eval(stack) ?? null;
    return { seq, filter, loopWith, enricher };
  }
}
const filterAlwaysTrue = (_v, _k, _seq) => true;
const nullLoopWith = (seq) => ({ seq });
const WRAPPER_NODES = {
  slot: SlotNode,
  show: ShowNode,
  hide: HideNode,
  each: EachNode,
  scope: ScopeNode,
  "push-view": PushViewNameNode,
};
export class ParseContext {
  constructor(DOMParser, Text, Comment, nodes, events, macroNodes, frame, parent) {
    this.nodes = nodes ?? [];
    this.events = events ?? [];
    this.macroNodes = macroNodes ?? [];
    this.parent = parent ?? null;
    this.frame = frame ?? {};
    this.DOMParser = DOMParser ?? globalThis.DOMParser;
    this.Text = Text ?? globalThis.Text;
    this.Comment = Comment ?? globalThis.Comment;
    this.cacheConstNodes = true;
  }
  isInsideMacro(name) {
    return this.frame.macroName === name || this.parent?.isInsideMacro(name);
  }
  enterMacro(macroName, macroVars, macroSlots) {
    const { DOMParser: DP, Text, Comment, nodes, events, macroNodes } = this;
    const frame = { macroName, macroVars, macroSlots };
    return new ParseContext(DP, Text, Comment, nodes, events, macroNodes, frame, this);
  }
  newDOMParser() {
    return new this.DOMParser();
  }
  isTextNode(v) {
    return v instanceof this.Text;
  }
  isCommentNode(v) {
    return v instanceof this.Comment;
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
    for (const child of childs) {
      if (child instanceof SlotNode) {
        slots[child.val.value] = child.node;
      } else if (!(child instanceof TextNode) || !child.isWhiteSpace()) {
        anySlot.push(child);
      }
    }
    const node = new MacroNode(macroName, mAttrs, slots, this);
    this.macroNodes.push(node);
    return node;
  }
  compile(scope) {
    for (let i = 0; i < this.macroNodes.length; i++) {
      this.macroNodes[i].compile(scope); // macroNodes may grow w/nested macros
    }
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
  onAttributes(_attrs, _wrapperAttrs, _textChild) {}
}
const isTextNodeAllBlanks = (n) => n instanceof TextNode && n.isWhiteSpace();
const isFirstDomNode = (n) =>
  n instanceof DomNode || // only checks first childs of first fragment
  (n instanceof FragmentNode && n.childs[0] instanceof DomNode);
function condenseChildsWhites(childs) {
  let end = childs.length; // adapted from vuejs compiler-core parser.ts
  if (end === 0) {
    return childs;
  }
  let start = 0;
  let changed = false;
  if (isTextNodeAllBlanks(childs[0])) {
    start = 1;
    changed = true;
  }
  if (end > 1 && isTextNodeAllBlanks(childs[end - 1])) {
    end -= 1;
    changed = true;
  }
  for (let i = 1; i < end - 1; i++) {
    const cur = childs[i];
    if (
      isTextNodeAllBlanks(cur) &&
      isFirstDomNode(childs[i - 1]) &&
      isFirstDomNode(childs[i + 1]) &&
      cur.hasNewLine()
    ) {
      cur.condenseWhiteSpace();
    }
  }
  return changed ? childs.slice(start, end) : childs;
}
export class View {
  constructor(name, rawView, style = "", anode = null, ctx = null) {
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
    if (ctx.cacheConstNodes) {
      this.anode = optimizeNode(this.anode);
    }
  }
  render(stack, rx) {
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
    for (const handler of this.handlers) {
      if (handler.handlesEventName(eventName)) {
        r ??= [];
        r.push(handler);
      }
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
const isMac = (globalThis.navigator?.userAgent ?? "").toLowerCase().includes("mac");
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
  if (names.length === 0) {
    return identityModifierWrapper;
  }
  const wrappers = MOD_WRAPPERS_BY_EVENT[eventName] ?? {};
  let w = (that, f, args, _ctx) => f.apply(that, args);
  for (const name of names) {
    const wrapper = wrappers[name];
    if (wrapper !== undefined) {
      w = wrapper(w);
    }
  }
  return (f, ctx) =>
    function (...args) {
      return w(this, f, args, ctx);
    };
}

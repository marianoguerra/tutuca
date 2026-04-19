import { ComponentStack } from "./components.js";
import { Path } from "./path.js";
import { Stack } from "./stack.js";
import { Transactor } from "./transactor.js";
import { render } from "./vdom.js";

const _evs = "dragstart dragover dragend touchstart touchmove touchend touchcancel".split(" ");
export class App {
  constructor(rootNode, comps, renderer, ParseContext) {
    this.rootNode = rootNode;
    this.comps = comps;
    this.compStack = new ComponentStack(comps);
    this.transactor = new Transactor(comps, null);
    this.ParseContext = ParseContext;
    this.renderer = renderer;
    this.maxEventNodeDepth = Infinity;
    this._transactNextBatchId = this._evictCacheId = null;
    this._eventNames = new Set(_evs);
    this.dragInfo = this.curDragOver = null;
    this._touch = null;
    this.transactor.onTransactionPushed = (_transaction) => {
      if (this._transactNextBatchId === null) this._scheduleNextTransactionBatchExecution();
    };
    this._compiled = false;
    this._renderOpts = { document: rootNode.ownerDocument };
  }
  get state() {
    return this.transactor.state;
  }
  handleEvent(e) {
    const { type } = e;
    if (type[0] === "t" && type.startsWith("touch")) {
      this._handleTouchEvent(e);
      return;
    }
    this._dispatchEvent(e);
  }
  _dispatchEvent(e) {
    const { type } = e;
    const isDrag = type === "dragover" || type === "dragstart" || type === "dragend";
    const { rootNode: root, maxEventNodeDepth: maxDepth, comps } = this;
    const [path, handlers] = Path.fromEvent(e, root, maxDepth, comps, !isDrag);
    if (isDrag) this._handleDragEvent(e, type, path);
    if (path !== null && handlers !== null) {
      for (const handler of handlers) {
        this.transactor.transactInputNow(path, e, handler, this.dragInfo);
      }
    }
  }
  _handleTouchEvent(e) {
    const { type } = e;
    if (type === "touchstart") {
      if (this._touch !== null || e.touches.length !== 1) return;
      const t = e.touches[0];
      const draggable = t.target?.closest?.('[draggable="true"]');
      if (!draggable) return;
      this._touch = makeTouchInfo(t.identifier, t.clientX, t.clientY, draggable, false);
      return;
    }
    if (this._touch === null) return;
    const touch = findTouch(e, this._touch.id);
    const { rootNode, _touch } = this;
    if (type === "touchmove") {
      if (touch === null) return;
      const { clientX, clientY } = touch;
      if (!_touch.active) {
        const dx = clientX - _touch.startX;
        const dy = clientY - _touch.startY;
        if (dx * dx + dy * dy < TOUCH_DRAG_THRESHOLD_SQ) return;
        _touch.active = true;
        e.preventDefault();
        this._dispatchEvent(makeSyntheticDragEvent("dragstart", _touch.target, clientX, clientY));
      } else {
        e.preventDefault();
        const target = hitTest(rootNode, clientX, clientY);
        this._dispatchEvent(makeSyntheticDragEvent("dragover", target, clientX, clientY));
      }
      return;
    }
    if (type === "touchend" || type === "touchcancel") {
      if (touch === null) return;
      if (_touch.active) {
        const { clientX, clientY } = touch;
        if (type === "touchend") {
          const target = hitTest(rootNode, clientX, clientY);
          this._dispatchEvent(makeSyntheticDragEvent("drop", target, clientX, clientY));
        }
        this._dispatchEvent(makeSyntheticDragEvent("dragend", _touch.target, clientX, clientY));
      }
      this._touch = null;
    }
  }
  _handleDragEvent(e, type, path) {
    if (type === "dragover") {
      const dropTarget = getClosestDropTarget(e.target, this.rootNode, 50);
      if (dropTarget !== null) {
        e.preventDefault();
        this._cleanDragOverAttrs();
        this.curDragOver = dropTarget;
        dropTarget.dataset.draggingover = this.dragInfo?.type ?? "_external";
      }
    } else if (type === "dragstart") {
      e.target.dataset.dragging = 1;
      const rootValue = this.state.val;
      const value = path.lookup(rootValue);
      const dragType = e.target.dataset.dragtype ?? "?";
      const stack = path.buildStack(this.makeStack(rootValue));
      this.dragInfo = new DragInfo(path, stack, e, value, dragType, e.target);
    } else {
      if (this.dragInfo !== null) {
        delete this.dragInfo.node.dataset.dragging;
        this.dragInfo = null;
      }
      this._cleanDragOverAttrs();
    }
  }
  makeStack(rootValue) {
    return Stack.root(this.comps, rootValue);
  }
  _cleanDragOverAttrs() {
    if (this.curDragOver !== null) {
      delete this.curDragOver.dataset.draggingover;
      this.curDragOver = null;
    }
  }
  render() {
    const root = this.state.val;
    const stack = this.makeStack(root);
    return render(this.renderer.renderRoot(stack, root), this.rootNode, this._renderOpts);
  }
  onChange(callback) {
    this.transactor.state.onChange(callback);
  }
  compile() {
    for (const Comp of this.comps.byId.values()) {
      Comp.compile(this.ParseContext);
      for (const key in Comp.views)
        for (const name of Comp.views[key].ctx.genEventNames()) this._eventNames.add(name);
    }
    this._compiled = true;
  }
  start(opts) {
    if (!this._compiled) this.compile();
    for (const name of this._eventNames)
      this.rootNode.addEventListener(name, this, listenerOpts(name));
    this.onChange((info) => {
      if (info.val !== info.old) this.render();
    });
    injectCss("tutuca-app", this.comps.compileStyles(), opts?.head ?? document.head);
    if (opts?.noCache) {
      this.renderer.setNullCache();
      this.comps.setNullComputedCache();
    } else {
      this.startCacheEvictionInterval();
    }
    this.render();
  }
  stop() {
    this.stopCacheEvictionInterval();
    for (const name of this._eventNames)
      this.rootNode.removeEventListener(name, this, listenerOpts(name));
  }
  dispatchLogicAtRoot(name, args, opts) {
    return this.transactor.pushLogic(new Path([]), name, args, opts);
  }
  registerComponents(comps, aliases) {
    const scope = this.compStack.enter();
    scope.registerComponents(comps, aliases);
    return scope;
  }
  _transactNextBatch(maxRunTimeMs = 10) {
    this._transactNextBatchId = null;
    const startTs = Date.now();
    const t = this.transactor;
    while (t.hasPendingTransactions && Date.now() - startTs < maxRunTimeMs) t.transactNext();
    if (t.hasPendingTransactions) this._scheduleNextTransactionBatchExecution();
  }
  _scheduleNextTransactionBatchExecution() {
    this._transactNextBatchId = setTimeout(() => this._transactNextBatch(), 0);
  }
  startCacheEvictionInterval(intervalMs = 30000) {
    this._evictCacheId = setInterval(() => this.renderer.cache.evict(), intervalMs);
  }
  stopCacheEvictionInterval() {
    clearInterval(this._evictCacheId);
    this._evictCacheId = null;
  }
}
export function injectCss(nodeId, style, styleTarget = document.head) {
  const styleNode = document.createElement("style");
  const currentNodeWithId = styleTarget.querySelector(`#${nodeId}`);
  if (currentNodeWithId) styleTarget.removeChild(currentNodeWithId);
  styleNode.id = nodeId;
  styleNode.innerHTML = style;
  styleTarget.appendChild(styleNode);
}
const TOUCH_DRAG_THRESHOLD_PX = 10;
const TOUCH_DRAG_THRESHOLD_SQ = TOUCH_DRAG_THRESHOLD_PX * TOUCH_DRAG_THRESHOLD_PX;
const NOOP = () => {};
function makeSyntheticDragEvent(type, target, clientX, clientY) {
  return { type, target, clientX, clientY, preventDefault: NOOP };
}
function makeTouchInfo(id, startX, startY, target, active) {
  return { id, startX, startY, target, active };
}
function findTouch(e, id) {
  for (const t of e.changedTouches) if (t.identifier === id) return t;
  for (const t of e.touches) if (t.identifier === id) return t;
  return null;
}
const listenerOpts = (name) => (name === "touchmove" ? { passive: false } : undefined);
function hitTest(rootNode, x, y) {
  const root = rootNode.getRootNode();
  let el = root.elementFromPoint?.(x, y) ?? null;
  while (el?.shadowRoot) {
    const next = el.shadowRoot.elementFromPoint(x, y);
    if (next === null || next === el) break;
    el = next;
  }
  return el ?? rootNode;
}
function getClosestDropTarget(target, rootNode, count) {
  let node = target;
  while (count-- > 0 && node !== rootNode) {
    if (node.dataset?.droptarget !== undefined) return node;
    node = node.parentNode;
  }
  return null;
}
class DragInfo {
  constructor(path, stack, e, val, type, node) {
    this.path = path;
    this.stack = stack;
    this.e = e;
    this.val = val;
    this.type = type;
    this.node = node;
  }
  lookupBind(name) {
    return this.stack.lookupBind(name);
  }
}

import { ComponentStack } from "./components.js";
import { Path } from "./path.js";
import { Stack } from "./stack.js";
import { Transactor } from "./transactor.js";

export class App {
  constructor(rootNode, renderFn, comps, renderer, ParseContext) {
    this.rootNode = rootNode;
    this.comps = comps;
    this.compStack = new ComponentStack(comps);
    this.transactor = new Transactor(comps, null);
    this.ParseContext = ParseContext;
    this.renderer = renderer;
    this.renderFn = renderFn;
    this.maxEventNodeDepth = Infinity;
    this._transactNextBatchId = this._evictCacheId = null;
    this._eventNames = new Set(["dragstart", "dragover", "dragend"]);
    this.dragInfo = this.curDragOver = null;
    this.transactor.onTransactionPushed = (_transaction) => {
      if (this._transactNextBatchId === null) {
        this._scheduleNextTransactionBatchExecution();
      }
    };
  }
  get state() {
    return this.transactor.state;
  }
  handleEvent(e) {
    const isDragStart = e.type === "dragstart";
    const isDragOver = e.type === "dragover";
    const isDragEnd = e.type === "dragend";
    const { rootNode: root, maxEventNodeDepth: maxDepth, comps } = this;
    const stopOnNoEvent = !(isDragOver || isDragStart || isDragEnd);
    const [path, handlers] = Path.fromEvent(e, root, maxDepth, comps, stopOnNoEvent);
    if (isDragOver) {
      const dropTarget = getClosestDropTarget(e.target, this.rootNode, 50);
      if (dropTarget !== null) {
        e.preventDefault();
        this._cleanDragOverAttrs();
        this.curDragOver = dropTarget;
        dropTarget.dataset.draggingover = this.dragInfo.type;
      }
    } else if (isDragStart) {
      e.target.dataset.dragging = 1;
      const rootValue = this.state.value;
      const value = path.lookup(rootValue);
      const type = e.target.dataset.dragtype ?? "?";
      const stack = path.buildStack(this.makeStack(rootValue));
      this.dragInfo = new DragInfo(path, stack, e, value, type, e.target);
    } else if (isDragEnd) {
      delete this.dragInfo.node.dataset.dragging;
      this.dragInfo = null;
      this._cleanDragOverAttrs();
    }
    if (path !== null && handlers !== null) {
      for (const handler of handlers) {
        this.transactor.transactInputNow(path, e, handler, this.dragInfo);
      }
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
    const root = this.state.value;
    const stack = this.makeStack(root);
    return this.renderFn(this.renderer.renderRoot(stack, root), this.rootNode);
  }
  onChange(callback) {
    this.transactor.state.onChange(callback);
  }
  compile() {
    for (const Comp of this.comps.byId.values()) {
      Comp.compile(this.ParseContext);
      for (const key in Comp.views) {
        for (const name of Comp.views[key].ctx.genEventNames()) {
          this._eventNames.add(name);
        }
      }
    }
  }
  start(opts) {
    this.compile();
    this.startNoCompile(opts);
  }
  startNoCompile(opts) {
    for (const name of this._eventNames) {
      this.rootNode.addEventListener(name, this);
    }
    this.onChange((info) => {
      if (info.value !== info.old) {
        this.render();
      }
    });
    injectCss("tutuca-app", this.comps.compileStyles());
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
    for (const name of this._eventNames) {
      this.rootNode.removeEventListener(name, this);
    }
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
    while (t.hasPendingTransactions && Date.now() - startTs < maxRunTimeMs) {
      t.transactNext();
    }
    if (t.hasPendingTransactions) {
      this._scheduleNextTransactionBatchExecution();
    }
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
function injectCss(nodeId, style) {
  const styleNode = document.createElement("style");
  const currentNodeWithId = document.head.querySelector(`#${nodeId}`);
  if (currentNodeWithId) {
    document.head.removeChild(currentNodeWithId);
  }
  styleNode.id = nodeId;
  styleNode.innerHTML = style;
  document.head.appendChild(styleNode);
}
function getClosestDropTarget(target, rootNode, count) {
  let node = target;
  while (count-- > 0 && node !== rootNode) {
    if (node.dataset?.droptarget !== undefined) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}
class DragInfo {
  constructor(path, stack, e, value, type, node) {
    this.path = path;
    this.stack = stack;
    this.e = e;
    this.value = value;
    this.type = type;
    this.node = node;
  }
  lookupBind(name) {
    return this.stack.lookupBind(name);
  }
}

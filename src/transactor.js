import { Path, PathBuilder } from "./path.js";
import { Stack } from "./stack.js";
import { isMac } from "./util/env.js";

class State {
  constructor(val) {
    this.val = val;
    this.changeSubs = [];
  }
  onChange(cb) {
    this.changeSubs.push(cb);
  }
  set(val, info) {
    const old = this.val;
    this.val = val;
    for (const sub of this.changeSubs) sub({ val, old, info, timestamp: Date.now() });
  }
  update(fn, info) {
    return this.set(fn(this.val), info);
  }
}
export class Transactor {
  constructor(comps, rootValue) {
    this.comps = comps;
    this.transactions = [];
    this.state = new State(rootValue);
    this.onTransactionPushed = () => {};
    // In-flight request promises, so the global `settle()` drain can await async
    // requests. (Per-dispatch completion is tracked separately via `Completion`; this
    // set is the thing `settle()` actually awaits to make progress on pending requests.)
    this._inflight = new Set();
  }
  pushTransaction(t) {
    this.transactions.push(t);
    this.onTransactionPushed(t);
  }
  // Make `child` a tracked unit of `parent`'s subtree: the parent's completion stays open
  // until the child's *whole* subtree settles. Tracking happens at dispatch time — during
  // the parent's handler or afterTransaction — while the parent's self-unit is still held,
  // so the parent counter can't reach zero before the child is registered. Returns `child`.
  _link(child, parent) {
    if (parent) {
      const release = parent.completion.track();
      child.completion.whenSubtreeSettled().then(release);
    }
    return child;
  }
  pushSend(path, name, args = [], opts = {}, parent = null) {
    const t = new SendEvent(path, this, name, args, parent, opts);
    this.pushTransaction(t);
    return this._link(t, parent);
  }
  pushInput(path, name, args = [], opts = {}, parent = null) {
    const t = new InputDispatchEvent(path, this, name, args, parent, opts);
    this.pushTransaction(t);
    return this._link(t, parent);
  }
  pushBubble(path, name, args = [], opts = {}, parent = null, targetPath = null) {
    const newOpts = opts.skipSelf ? { ...opts, skipSelf: false } : opts;
    const t = new BubbleEvent(path, this, name, args, parent, newOpts, targetPath);
    this.pushTransaction(t);
    return this._link(t, parent);
  }
  pushRequest(path, name, args = [], opts = {}, parent = null) {
    // Track on the parent synchronously, before any await, so the parent's subtree can't
    // settle while the request is in flight. The unit is later transferred onto the
    // ResponseEvent's subtree (see _runRequest), so it follows the whole response chain.
    const release = parent ? parent.completion.track() : null;
    const p = this._runRequest(path, name, args, opts, parent, release);
    this._inflight.add(p);
    p.finally(() => this._inflight.delete(p));
    return p;
  }
  // Drain queued transactions and await in-flight requests until quiescent. Each
  // awaited request enqueues a ResponseEvent, which may dispatch more work, so we
  // loop. `maxTurns` backstops a pathological non-terminating cascade.
  async settle(maxTurns = 10000) {
    while ((this.hasPendingTransactions || this._inflight.size) && maxTurns-- > 0) {
      while (this.hasPendingTransactions) this.transactNext();
      if (this._inflight.size) await Promise.allSettled([...this._inflight]);
    }
  }
  async _runRequest(path, name, args = [], opts = {}, parent = null, release = null) {
    // Transfer the parent's request-unit (see pushRequest) onto the ResponseEvent's
    // subtree, so the parent stays open until the whole response chain settles. The
    // response is pushed via pushTransaction directly (not _link), so it is not counted
    // twice. `released` guards the error path below so the unit is never lost or doubled.
    let released = false;
    const transfer = (t) => {
      if (release) {
        released = true;
        t.completion.whenSubtreeSettled().then(release);
      }
    };
    try {
      const curRoot = this.state.val;
      const txnPath = path.toTransactionPath();
      const curLeaf = txnPath.lookup(curRoot);
      const handler = this.comps.getRequestFor(curLeaf, name) ?? mkReq404(name);
      // Request handlers run with no `this`, and receive a RequestContext as their
      // final argument (consistent with receive/input/response, where ctx is last).
      const reqCtx = new RequestContext(path, this, parent, curRoot);
      const resHandlerName = opts?.onResName ?? name;
      // Pin field-resolved keys (e.g. `.sheets[.selId]`) to their value *now*, so the
      // response updates the item that issued the request even if the key changed while
      // the request was in flight. `livePath: true` opts out and re-evaluates live.
      const resPath = opts?.livePath ? null : txnPath.pinKeys(curRoot);
      const push = (specificName, baseName, singleArg, result, error) => {
        const resArgs = specificName ? [singleArg] : [result, error];
        const t = new ResponseEvent(path, this, specificName ?? baseName, resArgs, parent, resPath);
        transfer(t);
        this.pushTransaction(t);
      };
      try {
        const result = await handler.fn.apply(null, [...args, reqCtx]);
        push(opts?.onOkName, resHandlerName, result, result, null);
      } catch (error) {
        push(opts?.onErrorName, resHandlerName, error, null, error);
      }
    } finally {
      // If we threw before any ResponseEvent was created, the parent would otherwise hang.
      if (release && !released) release();
    }
  }
  get hasPendingTransactions() {
    return this.transactions.length > 0;
  }
  transactNext() {
    if (this.hasPendingTransactions) this.transact(this.transactions.shift());
  }
  transact(transaction) {
    // `finally` guarantees the self-unit is released and self is settled on every exit:
    // the undefined-state branch, the skipSelf path, and a throwing handler. Otherwise an
    // un-released unit would hang this transaction's (and its parent's) subtree forever.
    // afterTransaction() stays inside `try`, before the release, so a bubble it pushes is
    // counted before the subtree counter can reach zero.
    try {
      const curState = this.state.val;
      const newState = transaction.run(curState, this.comps);
      if (newState !== undefined) {
        this.state.set(newState, { transaction });
        transaction.afterTransaction();
      } else console.warn("undefined new state", { curState, transaction });
    } finally {
      transaction._completion?.ensureSelfSettled();
      transaction._completion?.releaseSelf();
    }
  }
  transactInputNow(path, event, eventHandler, dragInfo) {
    this.transact(new InputEvent(path, event, eventHandler, this, dragInfo));
  }
}
function mkReq404(name) {
  const fn = () => {
    throw new Error(`Request not found: ${name}`);
  };
  return { fn };
}
function nullHandler() {
  return this;
}
class Transaction {
  constructor(path, transactor, parentTransaction = null) {
    this.path = path;
    this.transactor = transactor;
    this.parentTransaction = parentTransaction;
    this._completion = null;
  }
  // Lazily created (like the rest of the per-transaction state): a leaf event that
  // nobody tracks or awaits never allocates one. See `class Completion`.
  get completion() {
    this._completion ??= new Completion();
    return this._completion;
  }
  // Resolves once this transaction's own handler has run.
  whenSettled() {
    return this.completion.whenSettled();
  }
  // Resolves once this transaction AND all transitively-derived work (sends, bubbles,
  // requests and the responses they produce, recursively) have settled.
  whenSubtreeSettled() {
    return this.completion.whenSubtreeSettled();
  }
  run(rootValue, comps) {
    return this.updateRootValue(rootValue, comps);
  }
  afterTransaction() {}
  buildRootStack(root, comps) {
    return Stack.root(comps, root);
  }
  buildStack(root, comps) {
    return this.path.toTransactionPath().buildStack(this.buildRootStack(root, comps));
  }
  callHandler(root, instance, comps) {
    const [handler, args] = this.getHandlerAndArgs(root, instance, comps);
    return handler.apply(instance, args);
  }
  getHandlerAndArgs(_root, _instance, _comps) {
    return null;
  }
  // The path used to apply the mutation. Teleports dynamic-var renders so it lands on
  // the data's real location (the dispatch `this.path` keeps intermediates). A subclass
  // may override to supply a pre-resolved path (see ResponseEvent's pinned keys).
  getTransactionPath() {
    return this.path.toTransactionPath();
  }
  updateRootValue(curRoot, comps) {
    const txnPath = this.getTransactionPath();
    const curLeaf = txnPath.lookup(curRoot);
    const newLeaf = this.callHandler(curRoot, curLeaf, comps);
    this._completion?.markSelfSettled({ value: newLeaf, old: curLeaf });
    return curLeaf !== newLeaf ? txnPath.setValue(curRoot, newLeaf) : curRoot;
  }
  lookupName(_name) {
    return null;
  }
}
const toNullIfNaN = (v) => (Number.isNaN(v) ? null : v);
export function getValue(e) {
  return e.target.type === "checkbox"
    ? e.target.checked
    : ((e instanceof CustomEvent ? e.detail : e.target.value) ?? null);
}
class InputEvent extends Transaction {
  constructor(path, e, handler, transactor, dragInfo) {
    // Keep the raw reconstructed path: buildStack needs its frame steps intact.
    // `dispatchPath` (compacted) drives ctx dispatch + bubbling; `buildStack` /
    // lookup / setValue teleport it via toTransactionPath().
    super(path, transactor);
    this.e = e;
    this.handler = handler;
    this.dragInfo = dragInfo;
    this._dispatchPath = null;
  }
  // Frame steps removed, DynStep + one step per crossed component kept: bubbling
  // it visits every component (including intermediates of a dynamic-var render).
  get dispatchPath() {
    this._dispatchPath ??= this.path.compact();
    return this._dispatchPath;
  }
  buildRootStack(root, comps) {
    return Stack.root(comps, root, this);
  }
  getHandlerAndArgs(root, _instance, comps) {
    const stack = this.buildStack(root, comps);
    const [handler, args] = this.handler.getHandlerAndArgs(stack, this);
    const path = this.dispatchPath; // ctx.bubble visits intermediate components
    let dispatcher;
    for (let i = 0; i < args.length; i++) {
      if (args[i]?.toHandlerArg) {
        dispatcher ??= new Dispatcher(path, this.transactor, this);
        args[i] = args[i].toHandlerArg(dispatcher);
      }
    }
    args.push(new EventContext(path, this.transactor, this));
    return [handler, args];
  }
  lookupName(name) {
    const { e } = this; // update lint if more cases are added
    switch (name) {
      case "value":
        return getValue(e);
      case "valueAsInt":
        return toNullIfNaN(parseInt(getValue(e), 10));
      case "valueAsFloat":
        return toNullIfNaN(parseFloat(getValue(e)));
      case "target":
        return e.target;
      case "event":
        return e;
      case "isAlt":
        return e.altKey;
      case "isShift":
        return e.shiftKey;
      case "isCtrl": /* falls through */
      case "isCmd":
        return (isMac && e.metaKey) || e.ctrlKey;
      case "key":
        return e.key;
      case "keyCode":
        return e.keyCode;
      case "isUpKey":
        return e.key === "ArrowUp";
      case "isDownKey":
        return e.key === "ArrowDown";
      case "isSend":
        return e.key === "Enter";
      case "isCancel":
        return e.key === "Escape";
      case "isTabKey":
        return e.key === "Tab";
      case "ctx":
        return new EventContext(this.dispatchPath, this.transactor, this);
      case "dragInfo":
        return this.dragInfo;
    }
    return null;
  }
}
class NameArgsTransaction extends Transaction {
  constructor(path, transactor, name, args, parentTransaction, opts = {}) {
    super(path, transactor, parentTransaction);
    this.name = name;
    this.args = args;
    this.opts = opts;
    this.targetPath = path;
  }
  handlerProp = null;
  getHandlerForName(comp) {
    const handlers = comp?.[this.handlerProp];
    return handlers?.[this.name] ?? handlers?.$unknown ?? nullHandler;
  }
  getHandlerAndArgs(_root, instance, comps) {
    const handler = this.getHandlerForName(comps.getCompFor(instance));
    return [handler, [...this.args, new EventContext(this.path, this.transactor, this)]];
  }
}
class ResponseEvent extends NameArgsTransaction {
  handlerProp = "response";
  constructor(path, transactor, name, args, parent, txnPath = null) {
    super(path, transactor, name, args, parent);
    // Pre-pinned transaction path captured at request time; null re-evaluates live.
    // `this.path` stays the dispatch path so ctx.path/targetPath are unaffected.
    this._txnPath = txnPath;
  }
  getTransactionPath() {
    return this._txnPath ?? super.getTransactionPath();
  }
}
class SendEvent extends NameArgsTransaction {
  handlerProp = "receive";
  run(rootVal, comps) {
    return this.opts.skipSelf ? rootVal : this.updateRootValue(rootVal, comps);
  }
  afterTransaction() {
    const { path, name, args, opts, targetPath } = this;
    if (opts.bubbles && path.steps.length > 0)
      this.transactor.pushBubble(path.popStep(), name, args, opts, this, targetPath);
  }
}
class BubbleEvent extends SendEvent {
  handlerProp = "bubble";
  constructor(path, transactor, name, args, parent, opts, targetPath) {
    super(path, transactor, name, args, parent, opts);
    this.targetPath = targetPath ?? path;
  }
  stopPropagation() {
    this.opts.bubbles = false;
  }
}
// Dispatch a named `input` handler by name with explicit args (no DOM event).
// Mirrors SendEvent/ResponseEvent: NameArgsTransaction resolves comp.input[name]
// and appends an EventContext. Used by ctx.inputAtPath / Transactor.pushInput.
class InputDispatchEvent extends NameArgsTransaction {
  handlerProp = "input";
}
// Per-transaction completion scope (structured-concurrency / WaitGroup style). A counter
// of outstanding "units": one self-unit (the transaction's own processing) plus one per
// derived child or in-flight request. Self settles when the handler runs; the subtree
// settles when the counter reaches zero — i.e. this transaction and everything it spawned,
// recursively, are done. Promises are allocated lazily, only when actually awaited.
class Completion {
  constructor() {
    this.val = undefined;
    this.selfSettled = false;
    this.subtreeSettled = false;
    this.pending = 1; // the self-unit, released after handler + afterTransaction
    this._selfResolve = null;
    this._selfPromise = null;
    this._subtreeResolve = null;
    this._subtreePromise = null;
    this._selfReleased = false;
  }
  whenSettled() {
    if (this.selfSettled) return Promise.resolve(this.val);
    this._selfPromise ??= new Promise((res) => {
      this._selfResolve = res;
    });
    return this._selfPromise;
  }
  whenSubtreeSettled() {
    if (this.subtreeSettled) return Promise.resolve(this.val);
    this._subtreePromise ??= new Promise((res) => {
      this._subtreeResolve = res;
    });
    return this._subtreePromise;
  }
  // The transaction's own handler ran (records its {value, old}). Does not touch the counter.
  markSelfSettled(val) {
    if (this.selfSettled) return;
    this.selfSettled = true;
    this.val = val;
    this._selfResolve?.(val);
  }
  // Settle self even when no handler produced a value (skipSelf / undefined / throw paths).
  ensureSelfSettled() {
    if (!this.selfSettled) this.markSelfSettled(this.val);
  }
  // Register an outstanding unit; returns a one-shot release.
  track() {
    this.pending++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this._release();
    };
  }
  releaseSelf() {
    if (this._selfReleased) return;
    this._selfReleased = true;
    this._release();
  }
  _release() {
    if (--this.pending === 0) {
      this.subtreeSettled = true;
      this._subtreeResolve?.(this.val);
    }
  }
}
class Dispatcher {
  constructor(path, transactor, parentTransaction, root = transactor.state.val) {
    this.path = path;
    this.transactor = transactor;
    this.parent = parentTransaction;
    // The state tree this ctx's `path` indexes into, captured at dispatch. Immutable,
    // so `walkPath` can be called any time (before or after an await).
    this.root = root;
  }
  // Walk the component instances on this ctx's path, leaf→root, calling
  // callback(Component, instance). Return false from the callback to stop early.
  walkPath(callback) {
    const comps = this.transactor.comps;
    const chain = this.path.toTransactionPath().resolveChain(this.root);
    for (let i = chain.length - 1; i >= 0; i--) {
      const comp = comps.getCompFor(chain[i]);
      if (comp && callback(comp, chain[i]) === false) return;
    }
  }
  get at() {
    return new PathChanges(this);
  }
  send(name, args, opts) {
    return this.sendAtPath(this.path, name, args, opts);
  }
  bubble(name, args, opts) {
    return this.send(name, args, { skipSelf: true, bubbles: true, ...opts });
  }
  sendAtPath(path, name, args, opts) {
    return this.transactor.pushSend(path, name, args, opts, this.parent);
  }
  request(name, args, opts) {
    return this.requestAtPath(this.path, name, args, opts);
  }
  requestAtPath(path, name, args, opts) {
    return this.transactor.pushRequest(path, name, args, opts, this.parent);
  }
  inputAtPath(path, name, args, opts) {
    return this.transactor.pushInput(path, name, args, opts, this.parent);
  }
  lookupTypeFor(name, inst) {
    return this.transactor.comps.getCompFor(inst).scope.lookupComponent(name);
  }
}
class EventContext extends Dispatcher {
  get name() {
    return this.parent?.name ?? null;
  }
  get targetPath() {
    return this.parent.targetPath;
  }
  stopPropagation() {
    return this.parent.stopPropagation();
  }
}
// The ctx handed to a request handler as its final argument. A distinct type (and a
// home for any request-only helpers later); `walkPath` lives on Dispatcher.
class RequestContext extends Dispatcher {}
class PathChanges extends PathBuilder {
  constructor(dispatcher) {
    super();
    this.dispatcher = dispatcher;
  }
  send(name, args, opts) {
    return this.dispatcher.sendAtPath(this.buildPath(), name, args, opts);
  }
  bubble(name, args, opts) {
    return this.send(name, args, { skipSelf: true, bubbles: true, ...opts });
  }
  buildPath() {
    return this.dispatcher.path.concat(this.pathChanges);
  }
}
// A Dispatcher rooted at the empty path, so code outside a handler (e.g. a test
// harness) can send/request/input at an absolute path without a DOM event.
export function rootDispatcher(transactor) {
  return new Dispatcher(new Path([]), transactor, null);
}

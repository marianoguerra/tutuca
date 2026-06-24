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
    // In-flight request promises, so `settle()` can await async requests (the
    // dead Task tree can't: a request's parent transaction completes before its
    // ResponseEvent exists, so addDep would assert on an already-completed task).
    this._inflight = new Set();
  }
  pushTransaction(t) {
    this.transactions.push(t);
    this.onTransactionPushed(t);
  }
  pushSend(path, name, args = [], opts = {}, parent = null) {
    this.pushTransaction(new SendEvent(path, this, name, args, parent, opts));
  }
  pushInput(path, name, args = [], opts = {}, parent = null) {
    this.pushTransaction(new InputDispatchEvent(path, this, name, args, parent, opts));
  }
  pushBubble(path, name, args = [], opts = {}, parent = null, targetPath = null) {
    const newOpts = opts.skipSelf ? { ...opts, skipSelf: false } : opts;
    this.pushTransaction(new BubbleEvent(path, this, name, args, parent, newOpts, targetPath));
  }
  pushRequest(path, name, args = [], opts = {}, parent = null) {
    const p = this._runRequest(path, name, args, opts, parent);
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
  async _runRequest(path, name, args = [], opts = {}, parent = null) {
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
      this.pushTransaction(t);
    };
    try {
      const result = await handler.fn.apply(null, [...args, reqCtx]);
      push(opts?.onOkName, resHandlerName, result, result, null);
    } catch (error) {
      push(opts?.onErrorName, resHandlerName, error, null, error);
    }
  }
  get hasPendingTransactions() {
    return this.transactions.length > 0;
  }
  transactNext() {
    if (this.hasPendingTransactions) this.transact(this.transactions.shift());
  }
  transact(transaction) {
    const curState = this.state.val;
    const newState = transaction.run(curState, this.comps);
    if (newState !== undefined) {
      this.state.set(newState, { transaction });
      transaction.afterTransaction();
    } else console.warn("undefined new state", { curState, transaction });
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
    this._task = null;
  }
  get task() {
    this._task ??= new Task();
    return this._task;
  }
  getCompletionPromise() {
    return this.task.promise;
  }
  setParent(parentTransaction) {
    this.parentTransaction = parentTransaction;
    parentTransaction.task.addDep(this.task);
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
    this._task?.complete?.({ value: newLeaf, old: curLeaf });
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
class Task {
  constructor() {
    this.deps = [];
    this.val = this.resolve = this.reject = null;
    this.promise = new Promise((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.isCompleted = false;
  }
  addDep(task) {
    console.assert(!this.isCompleted, "addDep for completed task", this, task);
    this.deps.push(task);
    task.promise.then((_) => this._check());
  }
  complete(val) {
    this.val = val;
    this._check();
  }
  _check() {
    if (this.deps.every((task) => task.isCompleted)) {
      this.isCompleted = true;
      this.resolve(this);
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

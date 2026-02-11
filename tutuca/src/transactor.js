import { PathBuilder } from "./path.js";
import { Stack } from "./stack.js";

class State {
  constructor(value) {
    this.value = value;
    this.changeSubs = [];
  }
  onChange(cb) {
    this.changeSubs.push(cb);
  }
  set(value, info) {
    const old = this.value;
    this.value = value;
    for (const sub of this.changeSubs) {
      sub({ value, old, info, timestamp: Date.now() });
    }
  }
  update(fn, info) {
    return this.set(fn(this.value), info);
  }
}
export class Transactor {
  constructor(comps, rootValue) {
    this.comps = comps;
    this.transactions = [];
    this.state = new State(rootValue);
    this.onTransactionPushed = () => {};
  }
  pushTransaction(t) {
    this.transactions.push(t);
    this.onTransactionPushed(t);
    return t;
  }
  pushLogic(path, name, args = [], opts = {}, parent = null) {
    return this.pushTransaction(new LogicEvent(path, this, name, args, parent, opts));
  }
  pushBubble(path, name, args = [], opts = {}, parent = null) {
    const newOpts = opts.skipSelf ? { ...opts, skipSelf: false } : opts;
    return this.pushTransaction(new BubbleEvent(path, this, name, args, parent, newOpts));
  }
  async pushRequest(path, name, args = [], opts = {}, parent = null) {
    const curRoot = this.state.value;
    const curLeaf = path.lookup(curRoot);
    const handler = this.comps.getRequestFor(curLeaf, name) ?? mkReq404(name);
    const resHandlerName = opts?.onResName ?? name;
    const push = (specificName, baseName, singleArg, result, error) => {
      const resArgs = specificName ? [singleArg] : [result, error];
      const t = new ResponseEvent(path, this, specificName ?? baseName, resArgs, parent);
      return this.pushTransaction(t);
    };
    try {
      const result = await handler.fn.apply(null, args);
      return push(opts?.onOkName, resHandlerName, result, result, null);
    } catch (error) {
      return push(opts?.onErrorName, resHandlerName, error, null, error);
    }
  }
  get hasPendingTransactions() {
    return this.transactions.length > 0;
  }
  transactNext() {
    if (this.hasPendingTransactions) {
      this.transact(this.transactions.shift());
    }
  }
  transactAll() {
    while (this.hasPendingTransactions) {
      this.transact(this.transactions.shift());
    }
  }
  transact(transaction) {
    const curState = this.state.value;
    const newState = transaction.run(curState, this.comps);
    if (newState !== undefined) {
      this.state.set(newState, { transaction });
      transaction.afterTransaction();
    } else {
      console.warn("undefined new state", { curState, transaction });
    }
  }
  transactInputNow(path, event, eventHandler, dragInfo) {
    this.transact(new InputEvent(path, event, eventHandler, this, dragInfo));
  }
}
function mkReq404(name) {
  return () => {
    throw new Error(`Request not found: ${name}`);
  };
}
function nullHandler() {
  return this;
}
class Transaction {
  constructor(path, transactor) {
    this.path = path;
    this.transactor = transactor;
    this.parentTransaction = null;
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
    const stack = this.path.buildStack(this.buildRootStack(root, comps));
    return stack ? stack.upToFrameBinds() : null;
  }
  callHandler(root, instance, comps) {
    const [handler, args] = this.getHandlerAndArgs(root, instance, comps);
    return handler.apply(instance, args);
  }
  getHandlerAndArgs(_root, _instance, _comps) {
    return null;
  }
  updateRootValue(curRoot, comps) {
    const curLeaf = this.path.lookup(curRoot);
    const newLeaf = this.callHandler(curRoot, curLeaf, comps);
    this._task?.complete?.({ value: newLeaf, old: curLeaf });
    return curLeaf !== newLeaf ? this.path.setValue(curRoot, newLeaf) : curRoot;
  }
  lookupName(_name) {
    return null;
  }
}
const isMac = (globalThis.navigator?.userAgent ?? "").toLowerCase().includes("mac");
export function getValue(e) {
  return e.target.type === "checkbox"
    ? e.target.checked
    : ((e instanceof CustomEvent ? e.detail : e.target.value) ?? null);
}
class InputEvent extends Transaction {
  constructor(path, e, handler, transactor, dragInfo) {
    super(path, transactor);
    this.e = e;
    this.handler = handler;
    this.dragInfo = dragInfo;
  }
  buildRootStack(root, comps) {
    return Stack.root(comps, root, this);
  }
  getHandlerAndArgs(root, _instance, comps) {
    const stack = this.buildStack(root, comps);
    const [handler, args] = this.handler.getHandlerAndArgs(stack, this);
    let dispatcher;
    for (let i = 0; i < args.length; i++) {
      if (args[i]?.toHandlerArg) {
        dispatcher ??= new Dispatcher(this.path, this.transactor, this);
        args[i] = args[i].toHandlerArg(dispatcher);
      }
    }
    return [handler, args];
  }
  lookupName(name) {
    const { e } = this; // update lint if more cases are added
    switch (name) {
      case "value":
        return getValue(e);
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
        return new EventContext(this.path, this.transactor, this);
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
  }
  getHandlerForName(_comp) {
    return nullHandler;
  }
  getHandlerAndArgs(_root, instance, comps) {
    const handler = this.getHandlerForName(comps.getCompFor(instance));
    return [handler, [...this.args, new EventContext(this.path, this.transactor, this)]];
  }
}
class ResponseEvent extends NameArgsTransaction {
  getHandlerForName(comp) {
    return comp?.response?.[this.name] ?? nullHandler;
  }
}
class LogicEvent extends NameArgsTransaction {
  getHandlerForName(comp) {
    return comp?.logic?.[this.name] ?? nullHandler;
  }
  run(rootVal, comps) {
    return this.opts.skipSelf ? rootVal : this.updateRootValue(rootVal, comps);
  }
  afterTransaction() {
    const { path, name, args, opts } = this;
    if (opts.bubbles && path.steps.length > 0) {
      this.transactor.pushBubble(path.popStep(), name, args, opts, this);
    }
  }
}
class BubbleEvent extends LogicEvent {
  getHandlerForName(comp) {
    return comp?.bubble?.[this.name] ?? nullHandler;
  }
  stopPropagation() {
    this.opts.bubbles = false;
  }
}
class Task {
  constructor(info) {
    this.info = info;
    this.deps = [];
    this.value = this.resolve = this.reject = null;
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
  complete(value) {
    this.value = value;
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
  constructor(path, transactor, parentTransaction = null) {
    this.path = path;
    this.transactor = transactor;
    this.parent = parentTransaction;
  }
  get at() {
    return new PathChanges(this);
  }
  logic(name, args, opts) {
    return this.logicAtPath(this.path, name, args, opts);
  }
  bubble(name, args, opts) {
    return this.logic(name, args, { skipSelf: true, bubbles: true, ...opts });
  }
  logicAtPath(path, name, args, opts) {
    return this.transactor.pushLogic(path, name, args, opts, this.parent);
  }
  request(name, args, opts) {
    return this.requestAtPath(this.path, name, args, opts);
  }
  requestAtPath(path, name, args, opts) {
    return this.transactor.pushRequest(path, name, args, opts, this.parent);
  }
  lookupTypeFor(name, inst) {
    return this.transactor.comps.getCompFor(inst).scope.lookupComponent(name);
  }
}
class EventContext extends Dispatcher {
  stopPropagation() {
    return this.parent.stopPropagation();
  }
}
class PathChanges extends PathBuilder {
  constructor(dispatcher) {
    super();
    this.dispatcher = dispatcher;
  }
  logic(name, args, opts) {
    return this.dispatcher.logicAtPath(this.buildPath(), name, args, opts);
  }
  bubble(name, args, opts) {
    return this.logic(name, args, { skipSelf: true, bubbles: true, ...opts });
  }
  buildPath() {
    return this.dispatcher.path.concat(this.pathChanges);
  }
}

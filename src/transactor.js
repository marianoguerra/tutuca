import { produce } from "./immer.js";
import { validateDraftFields } from "./oo.js";
import { Path, PathBuilder } from "./path.js";
import { Stack } from "./stack.js";
import { isMac } from "./util/env.js";
import { getValue, toNullIfNaN } from "./value.js";

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
    // Observers notified once per handler invocation with a normalized record
    // (see `_emitTransaction`). Multi-subscriber, generic; a dev tool subscribes
    // via `observe()` to trace dispatch activity. Empty by default: zero overhead.
    this._observers = [];
    // In-flight request promises, so the global `settle()` drain can await async
    // requests. (Per-dispatch completion is tracked separately via `Completion`; this
    // set is the thing `settle()` actually awaits to make progress on pending requests.)
    this._inflight = new Set();
  }
  pushTransaction(t) {
    this.transactions.push(t);
    this.onTransactionPushed(t);
  }
  // Subscribe to a normalized record for every handler invocation. `kind` is the
  // handler bucket (`receive` / `intent`), plus `answer` — an observation-only kind for
  // a message the runtime wrote to answer an intent. The BUCKET does not know about
  // that distinction, and must not: a handler cannot tell an answer from a message its
  // parent sent. Returns an unsubscribe function. Records
  // carry: kind, name, args, path, pathKeys, targetPath, handler, handlerName,
  // matched, before, after, parent, timestamp. Purely observational.
  observe(cb) {
    this._observers.push(cb);
    return () => {
      const i = this._observers.indexOf(cb);
      if (i !== -1) this._observers.splice(i, 1);
    };
  }
  _emit(record) {
    for (const cb of this._observers) cb(record);
  }
  // Build and dispatch the observer record for a settled transaction. The
  // resolved handler (`_resolvedHandler`/`_matched`) and per-leaf before/after
  // (`_before`/`_after`) were captured while the handler ran (see callHandler /
  // updateRootValue). No-op when nobody is observing.
  _emitTransaction(transaction, root) {
    if (this._observers.length === 0) return;
    // No handler ran: nothing to report.
    if (transaction._resolvedHandler === undefined) return;
    // Pin field-resolved keys (e.g. a `.a[.selId]` render target reconstructed from a
    // DOM event) against the root the handler read, so pathKeys carries concrete keys
    // instead of dropping the dynamic step.
    const path = transaction.getTransactionPath().pinKeys(root);
    this._emit({
      kind: transaction.observeKind,
      name: transaction.observeName,
      args: transaction.args ?? null,
      path,
      pathKeys: path.toKeys(),
      targetPath: transaction.targetPath ?? transaction.path,
      handler: transaction._resolvedHandler ?? null,
      handlerName: transaction._resolvedHandler?.name || null,
      matched: transaction._matched ?? null,
      before: transaction._before,
      after: transaction._after,
      parent: transaction.parentTransaction,
      timestamp: Date.now(),
    });
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
  // Raise an intent: a job the sender did not address, walked along a route until
  // something answers. `opts.route` is a list of legs (see DEFAULT_ROUTE) and
  // `opts.livePath` opts out of pinning the answer's destination keys.
  pushIntent(path, name, args = [], opts = {}, parent = null) {
    // Track on the parent synchronously, before any await, so its subtree can't settle
    // while the walk is in flight (a `lex` hop is async). The unit is transferred onto
    // the answer's subtree when one goes out, so it follows the whole chain.
    const release = parent ? parent.completion.track() : null;
    const walk = new IntentWalk(this, path, name, args, opts, parent, release);
    walk.advance();
    return walk;
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
        this._emitTransaction(transaction, curState);
      } else console.warn("undefined new state", { curState, transaction });
    } finally {
      // A hop that threw, or returned undefined, never reached afterTransaction. Without
      // this the walk would stall mid-route and its tracked unit would never be released,
      // hanging the parent's subtree forever. Continuing past that hop is also the right
      // MEANING: the transition did not happen, so the handler did not answer, and a hop
      // that did not answer is one the walk moves past.
      transaction.ensureWalkAdvanced?.();
      transaction._completion?.ensureSelfSettled();
      transaction._completion?.releaseSelf();
    }
  }
  transactInputNow(path, event, eventHandler, dragInfo) {
    this.transact(new InputEvent(path, event, eventHandler, this, dragInfo));
  }
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
  // Resolves once this transaction AND all transitively-derived work (sends and
  // intents, including the answers they produce, recursively) have settled.
  whenSubtreeSettled() {
    return this.completion.whenSubtreeSettled();
  }
  run(rootValue, comps) {
    return this.updateRootValue(rootValue, comps);
  }
  afterTransaction() {}
  // Ending a walk and forwarding belong to the two dispatch buckets; the base warns
  // rather than throwing, so a stray call from the wrong place is a message and not a
  // crash. `walk` is undefined here, which is how ctx.reply/ctx.fail tell the two apart.
  stop() {
    console.warn('ctx.stop() is only meaningful in an "intent" handler - ignored');
  }
  forward(_opts) {
    console.warn('ctx.forward() needs a "receive" or "intent" handler - ignored');
  }
  buildRootStack(root, comps) {
    return Stack.root(comps, root);
  }
  buildStack(root, comps) {
    return this.path.toTransactionPath().buildStack(this.buildRootStack(root, comps));
  }
  // The kind reported to observers (see Transactor.observe); null on the base.
  get observeKind() {
    return null;
  }
  // The name reported to observers; null on the base. Overridden by NameArgs (the
  // dispatched message name) and InputEvent (the DOM event type). Kept separate from
  // `name`/`ctx.name` so it can't change handler-visible behavior.
  get observeName() {
    return null;
  }
  callHandler(root, instance, draft, comps) {
    const [handler, args] = this.getHandlerAndArgs(root, instance, comps);
    this._resolvedHandler = handler; // captured for observers
    return handler.apply(instance, [draft, ...args]);
  }
  getHandlerAndArgs(_root, _instance, _comps) {
    return null;
  }
  // The path used to apply the mutation. Teleports dynamic-var renders so it lands on
  // the data's real location (the dispatch `this.path` keeps intermediates). A subclass
  // may override to supply a pre-resolved path (see ResponseEvent's pinned keys).
  getTransactionPath() {
    // Frame-only bind steps are needed to replay handler arguments, but they do not
    // address state. Compact them before lookup/grafting so a handler inside @each
    // still updates the component that owns the view.
    return this.path.toTransactionPath().compact();
  }
  updateRootValue(curRoot, comps) {
    const txnPath = this.getTransactionPath();
    const curLeaf = txnPath.lookup(curRoot);
    const newLeaf = produce(curLeaf, (draft) => {
      const result = this.callHandler(curRoot, curLeaf, draft, comps);
      if (result === undefined || result === draft) validateDraftFields(curLeaf, draft);
      return result;
    });
    this._before = curLeaf; // captured for observers (see _emitTransaction)
    this._after = newLeaf;
    this._completion?.markSelfSettled({ value: newLeaf, old: curLeaf });
    return curLeaf !== newLeaf ? txnPath.setValue(curRoot, newLeaf) : curRoot;
  }
  lookupName(_name) {
    return null;
  }
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
  // A DOM event is an ADDRESSED message like any other — it reaches the component that
  // owns the view and stops. It keeps its own class only because it resolves its handler
  // from the compiled view and runs synchronously, not because it is a different channel.
  get observeKind() {
    return "receive";
  }
  get observeName() {
    return this.e?.type ?? null;
  }
  // A view's name is a message. `forward` is where that name can LEAVE the component:
  // it becomes an intent with the same name and the same arguments, so a view that says
  // `@on.click="saveDraft .text"` never has to change when an ancestor takes the job over.
  // (A `$method` handler has a name too, so forwarding one raises an intent under it.)
  forward(opts) {
    this._forward = opts ?? {};
  }
  afterTransaction() {
    const f = this._forward;
    if (f === undefined) return;
    this._forward = undefined;
    const { args = this._handlerArgs ?? [], ...rest } = f;
    // `handler` is a NodeEvent, whose own `name` is the DOM event type; the MESSAGE
    // name is the one the view wrote, on the handler call it wraps.
    const hv = this.handler?.handlerCall?.handlerVal ?? this.handler?.handlerVal;
    const name = hv?.name;
    if (name === undefined)
      return console.warn("ctx.forward() from a handler with no name - ignored");
    this.transactor.pushIntent(this.dispatchPath, name, args, rest, this);
  }
  buildRootStack(root, comps) {
    return Stack.root(comps, root, this);
  }
  getHandlerAndArgs(root, _instance, comps) {
    const stack = this.buildStack(root, comps);
    const [handler, args] = this.handler.getHandlerAndArgs(stack, this);
    this._handlerArgs = [...args]; // without ctx, so `forward` can re-raise them
    const path = this.dispatchPath; // an intent walk visits intermediate components
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
  // NameArgs verbs map their handler bucket straight to the observed kind:
  // receive / intent.
  get observeKind() {
    return this.handlerProp;
  }
  get observeName() {
    return this.name;
  }
  getHandlerForName(comp) {
    const handlers = comp?.[this.handlerProp];
    const exact = handlers?.[this.name];
    if (exact) {
      this._matched = "exact";
      return exact;
    }
    const unknown = handlers?.$unknown;
    if (unknown) {
      this._matched = "unknown";
      return unknown;
    }
    this._matched = "none";
    return nullHandler;
  }
  getHandlerAndArgs(_root, instance, comps) {
    const handler = this.getHandlerForName(comps.getCompFor(instance));
    return [handler, [...this.args, new EventContext(this.path, this.transactor, this)]];
  }
}
class SendEvent extends NameArgsTransaction {
  handlerProp = "receive";
  // `receive` is the ADDRESSED bucket, and it is the only one: a view's `@on.click`,
  // a parent's ctx.send, the host's sendAtRoot and an answer to an intent all arrive
  // here, and a handler cannot tell them apart. Splitting on where a message came from
  // would let the view's name through and turn the parent's away, though the two say
  // the same thing — and neither a test nor a parent could drive the component.
  get observeKind() {
    // The one place the origin IS visible, and only to the inspector: an answer is an
    // ordinary receive and the bucket must not know, so this is an observation kind
    // rather than a handler bucket.
    return this._isAnswer ? "answer" : "receive";
  }
  // `forward` in a RECEIVE body starts a walk: the message that arrived becomes an
  // intent, keeping its name and payload. This is what lets a view's name leave the
  // component without the view changing.
  forward(opts) {
    this._forward = opts ?? {};
  }
  afterTransaction() {
    const f = this._forward;
    if (f === undefined) return;
    this._forward = undefined;
    const { args = this.args, ...rest } = f;
    this.transactor.pushIntent(this.path, this.name, args, rest, this);
  }
}
// One hop of an intent's walk. The walk itself lives in `IntentWalk`, shared by
// reference across every hop.
class IntentEvent extends NameArgsTransaction {
  handlerProp = "intent";
  constructor(path, transactor, walk) {
    super(path, transactor, walk.name, walk.args, walk.parent, {});
    this.walk = walk;
    // The position the intent was raised at, pinned for every hop, so a handler can
    // address the originator back with ctx.sendAtPath(ctx.targetPath, ...).
    this.targetPath = walk.origin;
  }
  // `forward` in an INTENT body amends the hop about to be pushed — it does not push
  // one itself, because a walk advances on its own.
  forward(opts) {
    this.walk.amend(opts, this.path);
  }
  stop() {
    this.walk.finish(null, null);
  }
  afterTransaction() {
    // THE rule: a reply ends the walk; running does not. A handler that changed state
    // and returned without replying is an OBSERVER, and the intent goes on to the next
    // hop. That is what makes an observer and an answerer the same construct with and
    // without a `reply`, so no separate listener bucket has to exist.
    this.ensureWalkAdvanced();
  }
  // Idempotent, because both afterTransaction and the transactor's `finally` call it —
  // whichever gets there first advances the walk exactly once.
  ensureWalkAdvanced() {
    if (this._advanced) return;
    this._advanced = true;
    this.walk.advance();
  }
}
// What a scope-registered intent handler returns to DECLINE. It is the handler's half
// of "running is not answering": the walk goes on to the next handler instead of
// stopping, and a route where everything declines is what makes `<name>Unhandled`
// reachable. "Nothing claimed it" and "a handler refused it" are different sentences,
// so they get different answers.
//
// `Symbol.for`, not `Symbol`: this value is compared by IDENTITY across a module
// boundary, and more than one copy of tutuca in a process is ordinary rather than
// exotic — the storybook engine imports the bare "tutuca" specifier (the built bundle)
// while a test or an app imports the source. A unique symbol would be a different
// symbol in each copy, so every `return PASS` would read as an ANSWER of an opaque
// value instead of a decline, silently. The global registry makes the two the same.
export const PASS = Symbol.for("tutuca.intent.pass");
// The route a bare `ctx.intent(...)` takes: the ancestors, then the registered scopes.
// Written down HERE and nowhere else, so "what does a routeless intent do" has one
// answer and no second copy to drift.
const DEFAULT_ROUTE = ["dyn", "lex"];
// How many hops a walk may take before the runtime refuses instead of looping.
const INTENT_DEPTH = 64;

// One intent, shared BY REFERENCE across every hop of its walk. That sharing is the
// whole reason this is an object rather than arguments threaded through the hops: the
// one-shot is per INTENT, not per hop, so a second `reply` — from this handler or from
// one three hops up — finds `ended` already true.
class IntentWalk {
  constructor(transactor, path, name, args, opts, parent, release) {
    this.transactor = transactor;
    this.name = name;
    this.args = args;
    this.route = opts?.route ?? DEFAULT_ROUTE;
    this.parent = parent;
    this.release = release;
    this.origin = path;
    // Where an answer lands, resolved NOW. Pinning means a late answer updates the item
    // that raised the intent even if the key moved while the walk was in flight (the
    // user switched tabs); `livePath: true` opts out and re-resolves on delivery.
    this.answerPath = opts?.livePath
      ? null
      : path.toTransactionPath().pinKeys(transactor.state.val);
    this.legIndex = 0;
    this.dynAt = path;
    this.hops = 0;
    this.ended = false;
  }
  // Offer the intent to the next hop. Called once at dispatch, and again by every hop
  // that ran without answering.
  advance() {
    if (this.ended) return;
    if (this.hops++ >= INTENT_DEPTH) return this.exhaust("intentDepth");
    while (this.legIndex < this.route.length) {
      const leg = this.route[this.legIndex];
      if (leg === "dyn") {
        // The `dyn` leg starts at the sender's PARENT: an intent is never offered to the
        // component that raised it, because one that wanted to handle it itself would
        // have written the body inline.
        if (this.dynAt.steps.length === 0) {
          this.legIndex++;
          continue;
        }
        this.dynAt = this.dynAt.popStep();
        this.transactor.pushTransaction(new IntentEvent(this.dynAt, this.transactor, this));
        return;
      }
      if (leg === "lex") {
        this.legIndex++;
        return this._tryLex();
      }
      console.warn("unknown intent route leg", leg, '- expected "dyn" or "lex"');
      this.legIndex++;
    }
    this.exhaust("noHandler");
  }
  // The `lex` leg: the handlers registered on the scope chain of the component that
  // raised the intent, in order.
  _tryLex() {
    const root = this.transactor.state.val;
    const txnPath = this.origin.toTransactionPath();
    const leaf = txnPath.lookup(root);
    const chain = this.transactor.comps.getIntentChainFor(leaf, this.name);
    // A `dyn` hop is a transaction and emits its own record; a `lex` hop is not, so the
    // attempt is reported here or the inspector would show only the answer.
    if (this.transactor._observers.length > 0) {
      const path = txnPath.pinKeys(root);
      this.transactor._emit({
        kind: "intent",
        name: this.name,
        args: this.args,
        path,
        pathKeys: path.toKeys(),
        targetPath: this.origin,
        handler: chain[0]?.fn ?? null,
        handlerName: chain[0]?.fn?.name || this.name,
        matched: chain.length > 0 ? "exact" : "none",
        before: leaf,
        after: undefined,
        parent: this.parent,
        timestamp: Date.now(),
      });
    }
    if (chain.length === 0) return this.advance();
    const p = this._runLex(chain, 0);
    // Registered on the transactor so the global settle() drain can await it.
    this.transactor._inflight.add(p);
    p.finally(() => this.transactor._inflight.delete(p));
  }
  async _runLex(chain, i) {
    if (this.ended) return;
    if (i >= chain.length) return this.advance();
    const ctx = new IntentContext(this.origin, this.transactor, this.parent);
    try {
      const res = await chain[i].fn.apply(null, [...this.args, ctx]);
      // Resolving is an answer and throwing is a failure — the shapes an async function
      // already has. Only DECLINING needed a new spelling, and that is PASS.
      if (res === PASS) return this._runLex(chain, i + 1);
      this.answer("Ok", res);
    } catch (error) {
      this.answer("Error", error);
    }
  }
  // A hop answered. Ends the walk.
  answer(suffix, value) {
    this.finish(`${this.name}${suffix}`, [value]);
  }
  // `forward` from an intent body: keep walking, optionally with new arguments or a
  // narrowed route.
  amend(opts, from) {
    if (opts?.args !== undefined) this.args = opts.args;
    if (opts?.route !== undefined) {
      this.route = opts.route;
      this.legIndex = 0;
      this.dynAt = from ?? this.dynAt;
    }
  }
  // The route ran out. What the sender hears depends only on what it DECLARES, which is
  // how "a sender expects an answer if and only if it declares an answer arm" becomes
  // code — nobody writes it down twice, and there is no schema to keep in step.
  exhaust(reason) {
    if (this.ended) return;
    const { name, args } = this;
    const comp = this.transactor.comps.getCompFor(
      this.origin.toTransactionPath().lookup(this.transactor.state.val),
    );
    // The three derived answer names. Nobody declares them twice: the sender's own
    // `receive` bucket IS the declaration, and this reads it at the moment the walk ends.
    const declares = (n) => comp?.receive?.[n] !== undefined;
    if (declares(`${name}Unhandled`)) {
      // Carries the intent's OWN arguments, not an error: the sender can degrade or
      // retry without having kept a copy.
      this.finish(`${name}Unhandled`, args);
    } else if (declares(`${name}Error`)) {
      this.finish(`${name}Error`, [reason]);
    } else {
      // Declaring only an Ok arm means an answer was expected and none came. Say so
      // rather than dropping it: an answer never disappears in silence.
      if (declares(`${name}Ok`))
        console.warn(
          `intent "${name}" was not answered (${reason}) and this component declares only ` +
            `"${name}Ok" - add "${name}Unhandled" or "${name}Error" to handle it`,
        );
      // Otherwise: no answer arm at all, so this was a notification and nothing happened.
      this.finish(null, null);
    }
  }
  // End the walk. `name === null` means no answer goes out, which is what `stop` and a
  // fire-and-forget notification both are — the tracked unit is released here instead
  // of following an answer's subtree.
  finish(name, args) {
    if (this.ended) return;
    this.ended = true;
    if (name === null) return this.release?.();
    const path = this.answerPath ?? this.origin;
    // An answer is dispatched as an ORDINARY message. A component cannot tell one from
    // a message its parent sent, and does not need to — that indistinguishability is
    // the design's claim, and the reason one bucket is enough.
    const t = new SendEvent(path, this.transactor, name, args, this.parent, {});
    t._isAnswer = true;
    this.transactor.pushTransaction(t);
    if (this.release) t.completion.whenSubtreeSettled().then(this.release);
  }
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
    // The state tree this ctx's `path` indexes into, captured at dispatch. Frozen,
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
  // A message is ADDRESSED: it names one component and stops there.
  send(name, args, opts) {
    return this.sendAtPath(this.path, name, args, opts);
  }
  sendAtPath(path, name, args, opts) {
    return this.transactor.pushSend(path, name, args, opts, this.parent);
  }
  // An intent is ROUTED: it names a job and walks until something answers. The verb
  // does not decide which scope answers — `opts.route` does, written here at the call
  // site, which is where the decision actually is.
  intent(name, args, opts) {
    return this.intentAtPath(this.path, name, args, opts);
  }
  intentAtPath(path, name, args, opts) {
    return this.transactor.pushIntent(path, name, args, opts, this.parent);
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
  // Answer the intent being handled, with a result or with an error. Either ENDS the
  // walk. Legal only in an `intent` handler: a message has no sender waiting on it.
  reply(value) {
    return this.parent.walk === undefined
      ? warnNotIntent("reply")
      : this.parent.walk.answer("Ok", value);
  }
  fail(error) {
    return this.parent.walk === undefined
      ? warnNotIntent("fail")
      : this.parent.walk.answer("Error", error);
  }
  // End the walk answering nothing — "served, and no answer".
  stop() {
    return this.parent.stop();
  }
  // From an `intent` body: hand the intent to the next hop, optionally amending it.
  // From a `receive` body: turn the message that arrived into an intent. One word from
  // both ends of a walk; which one you get depends on which bucket you are in.
  forward(opts) {
    return this.parent.forward(opts);
  }
}
// The ctx handed to a scope-registered intent handler as its final argument. A distinct
// type (and a home for any lex-only helpers later); `walkPath` lives on Dispatcher.
class IntentContext extends Dispatcher {}
function warnNotIntent(verb) {
  console.warn(`ctx.${verb}() is only meaningful in an "intent" handler - ignored`);
}
class PathChanges extends PathBuilder {
  constructor(dispatcher) {
    super();
    this.dispatcher = dispatcher;
  }
  send(name, args, opts) {
    return this.dispatcher.sendAtPath(this.buildPath(), name, args, opts);
  }
  intent(name, args, opts) {
    return this.dispatcher.intentAtPath(this.buildPath(), name, args, opts);
  }
  buildPath() {
    return this.dispatcher.path.concat(this.pathChanges);
  }
}
// A Dispatcher rooted at the empty path, so code outside a handler (e.g. a test
// harness) can send/intent at an absolute path without a DOM event.
export function rootDispatcher(transactor) {
  return new Dispatcher(new Path([]), transactor, null);
}

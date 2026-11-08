// The host: registers components in scopes, renders the root and runs tasks against its state.
// Everything from outside the tree comes in through send: DOM events, and the messages of
// whatever drives the app (an agent, a test, a bar). Without a document it is headless: it
// renders nothing and listens to no events, and the tree runs the same.
import { current, isDraft, produce } from "../deps/immer.js";
import { apply, checkInvariants, query } from "./contract.js";
import { DROP_EVENTS, DragTracker } from "./drag.js";
import { SyncEngines } from "./engines.js";
import { eventSend } from "./events.js";
import { Scope } from "./scope.js";
import { specOf } from "./spec.js";
import { Address, DispatchPath, Selector, selectorFrom, Target } from "./tree/index.js";
import { HostTask, schedulerFor } from "./tree-binding.js";
import { morph, toVChilds } from "./vdom.js";
import { RenderContext, renderView } from "./view.js";

// What handlers read from the world, through ctx.now(), ctx.random() and ctx.uuid(): the
// clock in ms since the epoch, a number in [0, 1) and a new id. Each mirrors the global it
// stands for, so a host can swap them for ones that repeat (testEnv in tutuca/pbt).
export const browserEnv = {
	now: () => Date.now(),
	random: () => Math.random(),
	uuid: () => globalThis.crypto.randomUUID(),
};

export class Host {
	// checks is what dev mode runs, made with notify: DevChecks from tutuca/dev (src/dev/checks.js)
	// checks the state against the schemas on start and after each task. Null outside dev mode,
	// so the core doesn't carry them.
	constructor({ document = null, rootNode = null, checks = null, env = browserEnv } = {}) {
		this.document = document;
		this.rootNode = rootNode;
		this.checks = checks === null ? null : new checks((type, info) => this.notify(type, info));
		this.env = env; // What handlers read from the world, through ctx.
		this.root = null;
		// Delivers the tasks against the root (src/tree): this host renders, listens and syncs.
		this.scheduler = schedulerFor(this);
		this.scope = new Scope((spec) => this.addEventListeners(spec.eventNames));
		this._listeners = new Set();
		this.pushTask = this.pushTask.bind(this);
		this.handleTasks = this.handleTasks.bind(this);
		this._curVDom = null;
		this._taskTickTimeoutId = null;
		this._handlingTasks = false;
		this._eventsAdded = new Set();
		this._idleWaiters = [];
		this._scopeTimers = new Map();
		this.drags = new DragTracker(rootNode);
		this.engines = new SyncEngines((type, info) => this.notify(type, info));
	}
	// What the scheduler tells the host (tree-binding.js's schedulerFor): a task committed, there
	// are tasks to run, and a settle scope opened or settled.
	taskCommitted(task, ctx, info) {
		this.checks?.state(task, info.curRoot, this.root);
		this.checks?.message(task, ctx, info.instance, info.path.getIn(info.newRoot));
		this.notify("taskHandled", { task, ...info });
	}
	wake() {
		if (!this._handlingTasks) this.scheduleNextTaskTick();
	}
	// A settle scope with a timeout is cancelled with timeout once it's up.
	startScopeTimer(scope) {
		if (scope.timeout === null) return;
		const timer = setTimeout(() => {
			this._scopeTimers.delete(scope.id);
			if (this.scheduler.cancelScope(scope.id, "timeout")) this.scheduleNextTaskTick();
		}, scope.timeout);
		this._scopeTimers.set(scope.id, timer);
	}
	stopScopeTimer(scope) {
		clearTimeout(this._scopeTimers.get(scope.id));
		this._scopeTimers.delete(scope.id);
	}
	// The element being dragged, from dragstart to dragend.
	get drag() {
		return this.drags.drag;
	}
	start(root) {
		this.root = root;
		this.checks?.start(root);
		this.render();
	}
	render() {
		if (this.document === null) return;
		const ctx = RenderContext.root(this.root);
		const curVDom = this._curVDom;
		const newVDom = toVChilds(renderView(this.root, ctx));
		morph(this.document, this.rootNode, newVDom, curVDom);
		this._curVDom = newVDom;
		this.notify("render", { ctx, newVDom, curVDom });
	}
	handleEvent(e) {
		if (this.root === null) return;
		const { type } = e;
		const bubbles = DROP_EVENTS.has(type);
		this.drags.beforeEvent(e, this.root);
		let sent = null;
		try {
			sent = eventSend(e, this.rootNode, this.root, this.drag, bubbles);
		} catch (error) {
			// The DOM doesn't match the root it routes against (a render that failed), or an event
			// arg failed: reported, as a failed task is, instead of escaping the listener.
			this.notify("eventFailed", { event: e, error });
		}
		if (sent !== null) {
			const { name, args, to, node } = sent;
			this.send(name, args, { to, now: true, event: e, node, drag: this.drag });
		}
		this.drags.afterEvent(e);
	}
	// Sends name(...args) from the host to the component at to: an Address, a DispatchPath, a
	// Selector or a selector fn (as ctx.sendAt takes) from the root; the root by default. One
	// sent now (as a DOM event is: spec/tree's env rule) has run when send returns: it goes ahead
	// of the queue, behind the ones sent now before it and a bubble under way. Any other waits at
	// the back of the queue for the next tick. event, node and drag are what the handler reads as
	// ctx.event, ctx.node and ctx.drag. Returns the task.
	send(
		name,
		args = [],
		{ to = new DispatchPath(), now = false, event = null, node = null, drag = null } = {},
	) {
		const task = new HostTask(name, args, targetOf(to), { now, event, node, drag });
		task.prepare(this.root);
		if (now) {
			this.scheduler.arrive(task);
			this.handleTasks();
		} else this.scheduler.push(task);
		return task;
	}
	// Applies the pure message name(...args) to the component at to (as send takes it) at once,
	// as an external change: no task, no queue, rendered when it returns. Throws a ContractError
	// if the component there doesn't support it.
	// Nothing changes if it breaks the component's invariants.
	apply(name, args = [], { to = new DispatchPath() } = {}) {
		const at = this.addressOf(to).keyPath;
		const produceWith =
			this.checks === null ? produce : (root, fn) => this.checks.applied(name, root, at, fn);
		this.applyExternal(
			(root) => {
				const target = at.getIn(root);
				const next = apply(target, name, ...args);
				checkInvariants(specOf(target), name, isDraft(next) ? current(next) : next);
				return at.setIn(root, next);
			},
			null,
			null,
			produceWith,
		);
	}
	// What the query name(...args) of the component at to returns, read from the current root.
	query(name, args = [], { to = new DispatchPath() } = {}) {
		return query(this.addressOf(to).keyPath.getIn(this.root), name, ...args);
	}
	// The Address to (as send takes it) reaches in the current root.
	addressOf(to) {
		const where = targetOf(to);
		return where instanceof Address ? where : Address.of(where, this.root);
	}
	// Resolves once nothing is left to run: no task queued and no ask waiting for its answer.
	whenIdle() {
		if (this.root === null || this.scheduler.isIdle) return Promise.resolve();
		return new Promise((resolve) => this._idleWaiters.push(resolve));
	}
	// A stopped host (force) runs nothing more, so whoever waits stops waiting.
	resolveIdle(force = false) {
		if (this._idleWaiters.length === 0 || !(force || this.scheduler.isIdle)) return;
		const waiters = this._idleWaiters;
		this._idleWaiters = [];
		for (const resolve of waiters) resolve();
	}
	addEventListeners(eventNames) {
		if (this.rootNode === null) return;
		for (const eventName of eventNames) {
			if (this._eventsAdded.has(eventName)) continue;
			this._eventsAdded.add(eventName);
			this.rootNode.addEventListener(eventName, this);
		}
	}
	get tasks() {
		return this.scheduler.tasks;
	}
	pushTask(task) {
		this.scheduler.push(task);
	}
	scheduleNextTaskTick() {
		if (this._taskTickTimeoutId !== null) return;
		this._taskTickTimeoutId = setTimeout(this.handleTasks, 0);
	}
	// Drops the queued tasks and the pending tick. An async ask reply in flight still arrives;
	// a stopped host drops it.
	clearTasks() {
		this.scheduler.clear();
		for (const timer of this._scopeTimers.values()) clearTimeout(timer);
		this._scopeTimers.clear();
		this.cancelTick();
	}
	cancelTick() {
		clearTimeout(this._taskTickTimeoutId);
		this._taskTickTimeoutId = null;
	}
	// Stops handling events and tasks: handleEvent ignores events without a root.
	stop() {
		this.clearTasks();
		this.detachSync();
		this.root = null;
		this.resolveIdle(true);
	}
	// Engines see every committed change and can apply changes from elsewhere (see engines.js).
	attachSync(...engines) {
		for (const engine of engines) {
			this.engines.attach(engine, {
				host: this,
				root: () => this.root,
				apply: (producer, info = null) => this.applyExternal(producer, engine, info),
			});
		}
	}
	detachSync() {
		this.engines.detach();
	}
	// Applies a change made elsewhere (by source, an engine) as a producer on the root, at once,
	// so it applies to the state it was made against. Renders unless a task run will. During
	// the engines' commit it waits for them to finish, so every engine sees changes in order.
	// produceWith makes the new root (host.apply's records who wrote what in dev).
	applyExternal(producer, source = null, info = null, produceWith = produce) {
		const again = () => this.applyExternal(producer, source, info, produceWith);
		if (this.engines.deferWhileCommitting(again)) return;
		const curRoot = this.root;
		if (curRoot === null) return;
		const newRoot = produceWith(curRoot, producer);
		if (newRoot === curRoot) return;
		const commit = this.engines.prepare(curRoot, newRoot, null, source);
		this.root = newRoot;
		commit();
		this.checks?.state(null, curRoot, newRoot);
		this.notify("externalApplied", { source, info, curRoot, newRoot });
		if (this._handlingTasks) return;
		this.render();
		this.checks?.settled(this.root);
	}
	handleTasks() {
		if (this._handlingTasks) return;
		if (this.root === null) return this.clearTasks();
		this._handlingTasks = true;
		this.cancelTick();
		const t1 = Date.now();
		const oldRoot = this.root;
		try {
			while (!this.scheduler.isEmpty) {
				this.scheduler.step();
				if (Date.now() - t1 > 16) break;
			}
		} finally {
			try {
				if (oldRoot !== this.root) this.render();
			} catch (error) {
				// Reported as a failed task is, instead of escaping the tick that rendered.
				this.notify("renderFailed", { error });
			} finally {
				this._handlingTasks = false;
				if (this.tasks.length > 0) this.scheduleNextTaskTick();
				else {
					this.checks?.settled(this.root);
					this.resolveIdle();
				}
			}
		}
	}
	// fn(type, info) hears what the host reports (render, taskHandled, taskFailed, stateInvalid,
	// …), each after the task that caused it, in the order they were added. Returns a function
	// that stops it.
	listen(fn) {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}
	notify(type, info) {
		if (this._listeners.size === 0) return;
		setTimeout(() => {
			for (const fn of this._listeners) fn(type, info);
		}, 0);
	}
}
// Where a message from the host goes: to as it is, if it is an Address; otherwise a Target from
// the root, fixed when it is sent.
const targetOf = (to) => {
	if (to instanceof Address) return to;
	if (to instanceof DispatchPath) return new Target(to);
	if (to instanceof Selector) return new Target(new DispatchPath(), to);
	if (typeof to === "function") return new Target(new DispatchPath(), selectorFrom(to));
	throw new Error(
		`send needs an Address, DispatchPath, Selector or selector fn, got ${String(to)}`,
	);
};

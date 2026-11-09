// The host: registers components in scopes, renders the root and runs tasks against its state.
// Everything from outside the tree comes in through send: DOM events, and the messages of
// whatever drives the app (an agent, a test, a bar). Without a document it is headless: it
// renders nothing and listens to no events, and the tree runs the same.
import { current, isDraft, produce } from "../../deps/immer.js";
import {
	Address,
	DispatchPath,
	HOST,
	Selector,
	selectorFrom,
	Target,
	Transition,
} from "../tree/index.js";
import { apply, checkInvariants, query } from "./contract.js";
import { DROP_EVENTS, DragTracker } from "./drag.js";
import { eventSend } from "./events.js";
import { engineName, Lifecycle } from "./lifecycle.js";
import { Scope } from "./scope.js";
import { specOf } from "./spec.js";
import { SyncEngines } from "./sync-engines.js";
import { HostTask, schedulerFor } from "./tree-binding.js";
import { morph, toVChilds } from "./vdom.js";
import { RenderContext, renderView } from "./view.js";

// What handlers read from the world, through ctx.now(), ctx.random() and ctx.uuid(): the
// clock in ms since the epoch, a number in [0, 1) and a new id. Each mirrors the global it
// stands for, so a host can swap them for ones that repeat (testEnv in tutuca/testing).
export const browserEnv = {
	now: () => Date.now(),
	random: () => Math.random(),
	uuid: () => globalThis.crypto.randomUUID(),
};

export class Host {
	// checks is what dev mode runs: DevChecks from tutuca/dev (src/dev/checks.js) checks the state
	// against the schemas on start and after each task, and what it finds is in the issues of
	// what the host reports. Null outside dev mode, so the core doesn't carry them.
	constructor({ document = null, rootNode = null, checks = null, env = browserEnv } = {}) {
		this.document = document;
		this.rootNode = rootNode;
		this.checks = checks === null ? null : new checks();
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
		this.engines = new SyncEngines((phase, fields) => this.report(phase, fields));
		this._reported = 0; // How many reports were made, to number the next one.
		this._lastSeq = null; // The seq of the last task the scheduler was done with.
		this._settledRoot = null; // The root as of the last settled report.
	}
	// What the scheduler tells the host (tree-binding.js's schedulerFor): what became of a task,
	// there are tasks to run, and a settle scope opened or settled.
	// A task whose handler ran (ctx) is checked in dev mode, and what's wrong is in its issues.
	transitioned(record, ctx) {
		if (record.seq !== null) this._lastSeq = record.seq;
		if (this.checks !== null && ctx !== undefined && record.committed) {
			const { task, before, after, instance } = record;
			record.issues.push(
				...this.checks.state(task, before, after),
				...this.checks.message(ctx, instance, record.to.keyPath.getIn(after)),
			);
		}
		this.notify(record);
	}
	wake() {
		if (!this._handlingTasks) this.scheduleNextTaskTick();
	}
	scopeOpened(scope) {
		this.startScopeTimer(scope);
		const { id, watcher, timeout } = scope;
		this.report("scopeOpened", { scope: id, watcher, timeout });
	}
	scopeSettled(scope) {
		this.stopScopeTimer(scope);
		const { id, ...report } = scope.report();
		this.report("scopeSettled", { scope: id, ...report });
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
		this._settledRoot = root;
		this.report("started", {}, { root }, this.checks?.start(root) ?? []);
		this.render();
	}
	render() {
		if (this.document === null) return;
		const ctx = RenderContext.root(this.root);
		const curVDom = this._curVDom;
		const newVDom = toVChilds(renderView(this.root, ctx));
		morph(this.document, this.rootNode, newVDom, curVDom);
		this._curVDom = newVDom;
		this.report("rendered", { upTo: this._lastSeq }, { ctx, newVDom, curVDom });
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
			this.report("eventFailed", { eventType: type, error }, { event: e });
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
	// It's reported as a transition (mode apply), failed when it throws.
	apply(name, args = [], { to = new DispatchPath() } = {}) {
		const address = this.addressOf(to);
		const at = address.keyPath;
		const seq = this.scheduler.nextSeq();
		const fields = { seq, origin: seq, mode: "apply", name, args, from: HOST, to: address };
		const before = this.root;
		let writeIssues = [];
		const produceWith =
			this.checks === null
				? produce
				: (root, fn) => {
						const [next, issues] = this.checks.applied(name, root, at, fn);
						writeIssues = issues;
						return next;
					};
		const report = (curRoot, newRoot, stateIssues) => {
			const instance = at.getIn(curRoot);
			const record = new Transition(fields, { before: curRoot, after: newRoot, instance });
			record.issues.push(...writeIssues, ...stateIssues);
			this._lastSeq = seq;
			this.notify(record);
		};
		const producer = (root) => {
			const target = at.getIn(root);
			const next = apply(target, name, ...args);
			checkInvariants(specOf(target), name, isDraft(next) ? current(next) : next);
			return at.setIn(root, next);
		};
		try {
			this.applyExternal(producer, { produceWith, report });
		} catch (error) {
			const failed = { ...fields, outcome: "failed", error };
			this.notify(new Transition(failed, { before, after: before, instance: at.getIn(before) }));
			throw error;
		}
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
		this.report("stopped");
		this.resolveIdle(true);
	}
	// Engines see every committed change and can apply changes from elsewhere (see sync-engines.js).
	attachSync(...engines) {
		for (const engine of engines) {
			this.engines.attach(engine, {
				host: this,
				root: () => this.root,
				apply: (producer, info = null) => this.applyExternal(producer, { source: engine, info }),
			});
		}
	}
	detachSync() {
		this.engines.detach();
	}
	// Applies a change made elsewhere (by source, an engine) as a producer on the root, at once,
	// so it applies to the state it was made against. Renders unless a task run will. During
	// the engines' commit it waits for them to finish, so every engine sees changes in order.
	// produceWith makes the new root (host.apply's records who wrote what in dev). It's reported
	// as an externalChange, unless report(curRoot, newRoot, issues) reports it (host.apply's,
	// which hears about a producer that changed nothing too).
	applyExternal(
		producer,
		{ source = null, info = null, produceWith = produce, report = null } = {},
	) {
		const again = () => this.applyExternal(producer, { source, info, produceWith, report });
		if (this.engines.deferWhileCommitting(again)) return;
		const curRoot = this.root;
		if (curRoot === null) return;
		const newRoot = produceWith(curRoot, producer);
		if (newRoot === curRoot) return report?.(curRoot, newRoot, []);
		const commit = this.engines.prepare(curRoot, newRoot, null, source);
		this.root = newRoot;
		commit();
		const issues = this.checks?.state(null, curRoot, newRoot) ?? [];
		if (report !== null) report(curRoot, newRoot, issues);
		else {
			const fields = { source: this.engineName(source) };
			this.report("externalChange", fields, { info, before: curRoot, after: newRoot }, issues);
		}
		if (this._handlingTasks) return;
		this.render();
		this.reportSettled();
	}
	// The root settled: nothing is left to run. Reported, with the invariants it breaks, once per
	// root that settles.
	reportSettled() {
		if (this.root === this._settledRoot) return;
		this._settledRoot = this.root;
		this.report("settled", { upTo: this._lastSeq }, {}, this.checks?.settled(this.root) ?? []);
	}
	// An engine as reports name it.
	engineName(engine) {
		return engineName(engine, this.engines.list);
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
				this.report("renderFailed", { error, upTo: this._lastSeq });
			} finally {
				this._handlingTasks = false;
				if (this.tasks.length > 0) this.scheduleNextTaskTick();
				else {
					this.reportSettled();
					this.resolveIdle();
				}
			}
		}
	}
	// fn(record) hears what the host reports, each after what caused it, in the order they were
	// added: a Transition (src/tree/transition.js) for what became of each task and each
	// host.apply, a Lifecycle (lifecycle.js) for the rest (started, rendered, settled, a sync
	// engine that failed, ...). Returns a function that stops it.
	listen(fn) {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}
	// Reports a Lifecycle of phase: fields plain, heavy hidden, issues what dev checks found.
	report(phase, fields = {}, heavy = {}, issues = []) {
		const record = new Lifecycle(phase, fields, heavy);
		record.issues.push(...issues);
		this.notify(record);
		return record;
	}
	// Numbers record, stamps it with the clock and publishes it.
	notify(record) {
		record.n = ++this._reported;
		record.at = this.env.now();
		this.publish(record);
	}
	// Tells the listeners, after the current task: a Driver hears it at once instead.
	publish(record) {
		if (this._listeners.size === 0) return;
		setTimeout(() => {
			for (const fn of this._listeners) fn(record);
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

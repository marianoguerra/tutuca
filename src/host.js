// The host: registers components in scopes, renders the root and runs tasks against its state.
import { produce } from "../deps/immer.js";
import { DevChecks } from "./checks.js";
import { DROP_EVENTS, DragTracker } from "./drag.js";
import { SyncEngines } from "./engines.js";
import { getEventInfoFor } from "./events.js";
import { scopeOf } from "./schema.js";
import { Scope } from "./scope.js";
import { componentKinds, EventTask, TutucaContext } from "./tasks.js";
import { Scheduler } from "./tree/index.js";
import { render as $render, toVChilds } from "./vdom.js";
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
	constructor({ document, rootNode, dev = false, env = browserEnv }) {
		this.document = document;
		this.rootNode = rootNode;
		this.dev = dev;
		// Dev mode checks the state against the schemas on start and after each task.
		this.checks = dev ? new DevChecks((type, info) => this.notify(type, info)) : null;
		this.env = env; // What handlers read from the world, through ctx.
		this.root = null;
		this.registrations = new Set();
		this.componentNames = new Set(); // In any scope, aliases included.
		// Delivers the tasks against the root (src/tree): this host renders, listens and syncs.
		this.scheduler = new Scheduler({
			kinds: componentKinds,
			store: { get: () => this.root, set: (root) => (this.root = root) },
			transact: (root, path, fn) =>
				produce(root, (rootDraft) => path.setIn(rootDraft, fn(path.getIn(rootDraft)))),
			hooks: {
				context: (task, instance, nextRequest) =>
					new TutucaContext(task, nextRequest, this.env, scopeOf(instance)),
				beforeCommit: (prev, next, task) => this.engines.prepare(prev, next, task),
				committed: (task, ctx, info) => {
					this.checks?.state(task, info.curRoot, this.root);
					this.checks?.message(task, ctx, info.instance, info.path.getIn(info.newRoot));
					this.notify("taskHandled", { task, ...info });
				},
				observe: (type, info) => this.notify(type, info),
				wake: () => {
					if (!this._handlingTasks) this.scheduleNextTaskTick();
				},
			},
		});
		this.scope = new Scope((spec, name) => {
			this.registrations.add(spec);
			this.componentNames.add(name);
			this.addEventListeners(spec.eventNames);
		});
		this.onNotify = (_type, _info) => {};
		this.pushTask = this.pushTask.bind(this);
		this.handleTasks = this.handleTasks.bind(this);
		this._curVDom = null;
		this._taskTickTimeoutId = null;
		this._handlingTasks = false;
		this._eventsAdded = new Set();
		this.drags = new DragTracker(rootNode);
		this.engines = new SyncEngines((type, info) => this.notify(type, info));
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
		const ctx = RenderContext.root(this.root);
		const curVDom = this._curVDom;
		const newVDom = toVChilds(renderView(this.root, ctx));
		$render(this.document, this.rootNode, newVDom, curVDom);
		this._curVDom = newVDom;
		this.notify("render", { ctx, newVDom, curVDom });
	}
	handleEvent(e) {
		if (this.root === null) return;
		const { type } = e;
		const bubbles = DROP_EVENTS.has(type);
		this.drags.beforeEvent(e, this.root);
		let info;
		try {
			info = getEventInfoFor(e.target, type, this.rootNode, this.root, bubbles);
		} catch (error) {
			// The DOM doesn't match the root it routes against (a render that failed): reported,
			// as a failed task is, instead of escaping the listener.
			info = null;
			this.notify("eventFailed", { event: e, error });
		}
		if (info !== null) {
			this.scheduler.arrive(new EventTask(e, info, this.drag));
			this.handleTasks();
		}
		this.drags.afterEvent(e);
	}
	addEventListeners(eventNames) {
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
	applyExternal(producer, source = null, info = null) {
		if (this.engines.deferWhileCommitting(() => this.applyExternal(producer, source, info))) return;
		const curRoot = this.root;
		if (curRoot === null) return;
		const newRoot = produce(curRoot, producer);
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
				else this.checks?.settled(this.root);
			}
		}
	}
	notify(type, info) {
		setTimeout(() => this.onNotify(type, info), 0);
	}
}

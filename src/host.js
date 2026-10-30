// The host: registers components in scopes, renders the root and runs tasks against its state.
import { produce } from "../deps/immer.js";
import { DROP_EVENTS, Drag } from "./drag.js";
import { browserEnv } from "./env.js";
import { getEventInfoFor, pathOf } from "./events.js";
import { findInvalidFields, messageIssues, scopeOf } from "./schema.js";
import { Scope } from "./scope.js";
import { AskTask, EventTask, MessageContext, NotifyTask } from "./tasks.js";
import { render as $render, toVChilds } from "./vdom.js";
import { RenderContext, renderView } from "./view.js";

export class Host {
	constructor({ document, rootNode, dev = false, env = browserEnv }) {
		this.document = document;
		this.rootNode = rootNode;
		this.dev = dev; // Check the state against the schemas on start and after each task.
		this.env = env; // What handlers read from the world, through ctx.
		this.rootComponent = null;
		this.registrations = new Set();
		this.componentNames = new Set(); // In any scope, aliases included.
		this.tasks = [];
		this._requests = 0; // The ids of the asks made, counted per host so runs repeat.
		this.nextRequest = () => ++this._requests;
		this.scope = new Scope((spec, name) => {
			this.registrations.add(spec);
			this.componentNames.add(name);
			this.addEventListeners(spec.eventNames);
		});
		this.onNotify = (_type, _info) => {};
		this.pushTask = this.pushTask.bind(this);
		this.handleTasks = this.handleTasks.bind(this);
		this._curVDom = null;
		this._settledRoot = null; // The root as of the last empty queue, for checkSettled.
		this._taskTickTimeoutId = null;
		this._handlingTasks = false;
		this._eventsAdded = new Set();
		this.drag = null; // The element being dragged, from dragstart to dragend.
		this._dragOver = null; // The drop target with data-draggingover.
		this.engines = []; // Sync engines: told about each change, and can apply their own.
		this._committing = false; // Engines are writing a change: applies wait in _deferred.
		this._deferred = [];
	}
	start(rootComponent) {
		this.rootComponent = rootComponent;
		this._settledRoot = rootComponent;
		this.checkState(null, null);
		this.render();
	}
	checkState(task, prevRoot) {
		if (!this.dev) return;
		// A task can leave invariants broken for the tasks it queued, so they wait for checkSettled.
		this.reportInvalid(prevRoot, { fields: true, invariants: task === null }, { task });
	}
	// Dev mode: once the queue is empty, check the invariants of what changed since it last was.
	checkSettled() {
		if (!this.dev || this._settledRoot === this.rootComponent) return;
		const prevRoot = this._settledRoot;
		this._settledRoot = this.rootComponent;
		const check = { fields: false, invariants: true };
		this.reportInvalid(prevRoot, check, { task: null, settled: true });
	}
	reportInvalid(prevRoot, check, info) {
		const issues = findInvalidFields(this.rootComponent, prevRoot, check);
		if (issues.length > 0) this.notify("stateInvalid", { ...info, issues });
	}
	checkMessage(task, ctx, prev, next) {
		if (!this.dev || ctx.handled === null) return;
		const { message, args } = ctx.handled;
		const issues = messageIssues(message, prev, next, args, ctx);
		if (issues.length > 0) this.notify("messageInvalid", { task, message: message.name, issues });
	}
	render() {
		const ctx = RenderContext.root(this.rootComponent);
		const curVDom = this._curVDom;
		const newVDom = toVChilds(renderView(this.rootComponent, ctx));
		$render(this.document, this.rootNode, newVDom, curVDom);
		this._curVDom = newVDom;
		this.notify("render", { ctx, newVDom, curVDom });
	}
	handleEvent(e) {
		if (this.rootComponent === null) return;
		const { type } = e;
		const bubbles = DROP_EVENTS.has(type);
		if (type === "dragstart") this.startDrag(e);
		else if (bubbles) this.dragOver(e);
		let info;
		try {
			info = getEventInfoFor(e.target, type, this.rootNode, this.rootComponent, bubbles);
		} catch (error) {
			// The DOM doesn't match the root it routes against (a render that failed): reported,
			// as a failed task is, instead of escaping the listener.
			info = null;
			this.notify("eventFailed", { event: e, error });
		}
		if (info !== null) {
			this.arrive(new EventTask(e, info, this.drag));
			this.handleTasks();
		}
		if (type === "dragend") this.endDrag();
	}
	// Remembers what is dragged: the closest draggable element, where it was rendered and its value.
	startDrag(e) {
		const node = e.target.closest?.('[draggable="true"]');
		const path = node ? pathOf(node, this.rootNode) : null;
		if (path === null) return;
		this.endDrag();
		const value = path.resolve().getIn(this.rootComponent);
		this.drag = new Drag(path, node.getAttribute("data-dragtype"), node, value);
		node.setAttribute("data-dragging", "");
		if (e.dataTransfer) {
			e.dataTransfer.setData("text/plain", ""); // Firefox starts no drag without data.
			e.dataTransfer.effectAllowed = "move";
		}
	}
	// Over a drop target, an element with a drop handler, lets the drop happen and marks it.
	dragOver(e) {
		if (e.type === "drop") {
			e.preventDefault();
			this.markDragOver(null);
		} else if (e.type === "dragleave") {
			if (!this.rootNode.contains(e.relatedTarget ?? null)) this.markDragOver(null);
		} else {
			const info = getEventInfoFor(e.target, "drop", this.rootNode, this.rootComponent, true);
			// The browser shows a move cursor over a drop target, a not-allowed one elsewhere.
			if (info !== null) {
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			}
			this.markDragOver(info?.node ?? null);
		}
	}
	markDragOver(node) {
		if (node === this._dragOver) return;
		if (this._dragOver !== null) this._dragOver.removeAttribute("data-draggingover");
		this._dragOver = node;
		if (node !== null) node.setAttribute("data-draggingover", this.drag?.type ?? "external");
	}
	endDrag() {
		this.markDragOver(null);
		if (this.drag !== null) this.drag.node.removeAttribute("data-dragging");
		this.drag = null;
	}
	addEventListeners(eventNames) {
		for (const eventName of eventNames) {
			if (this._eventsAdded.has(eventName)) continue;
			this._eventsAdded.add(eventName);
			this.rootNode.addEventListener(eventName, this);
		}
	}
	// An event runs at once, ahead of the queue, against the tree it happened on: after the events
	// that came before it, and after the rest of a bubble under way, which is one turn.
	arrive(task) {
		const { tasks } = this;
		let i = 0;
		const ahead = (t) => t instanceof EventTask || (t instanceof NotifyTask && t.hops !== null);
		while (i < tasks.length && ahead(tasks[i])) i++;
		tasks.splice(i, 0, task);
		if (!this._handlingTasks) this.scheduleNextTaskTick();
	}
	pushTask(task) {
		this.tasks.push(task);
		if (!this._handlingTasks) this.scheduleNextTaskTick();
	}
	scheduleNextTaskTick() {
		if (this._taskTickTimeoutId !== null) return;
		this._taskTickTimeoutId = setTimeout(this.handleTasks, 0);
	}
	// Drops the queued tasks and the pending tick. An async ask reply in flight still arrives;
	// a stopped host drops it.
	clearTasks() {
		this.tasks.length = 0;
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
		this.rootComponent = null;
	}
	// Engines see every committed change through prepare(change) and commit(change, prepared),
	// change being { prev, next, task }, and apply changes from elsewhere through the link attach
	// gets. A throwing prepare fails the task, before any engine wrote the change; a throwing
	// commit is reported as syncFailed and the change stands.
	attachSync(...engines) {
		for (const engine of engines) {
			this.engines.push(engine);
			engine.attach?.({
				host: this,
				root: () => this.rootComponent,
				apply: (producer, info = null) => this.applyExternal(producer, engine, info),
			});
		}
	}
	detachSync() {
		for (const engine of this.engines.splice(0)) engine.detach?.();
	}
	// Prepares the change from prev to next with every engine but source, and returns the
	// function that commits it, to call once next is the root. A prepare that throws fails a
	// task's change; a change from elsewhere happened already, so that engine skips it instead.
	prepareEngines(prev, next, task, source = null) {
		if (prev === next) return () => {};
		const change = { prev, next, task };
		const prepared = [];
		for (const engine of this.engines) {
			if (engine === source) continue;
			try {
				prepared.push([engine, engine.prepare?.(change)]);
			} catch (error) {
				if (task !== null) throw error;
				this.notify("syncFailed", { engine, error });
			}
		}
		return () => {
			this._committing = true;
			try {
				for (const [engine, p] of prepared) {
					try {
						engine.commit(change, p);
					} catch (error) {
						this.notify("syncFailed", { engine, error });
					}
				}
			} finally {
				this._committing = false;
			}
			// An engine applied a change while the others still hadn't seen this one: now they have.
			while (this._deferred.length > 0) this._deferred.shift()();
		};
	}
	// Applies a change made elsewhere (by source, an engine) as a producer on the root, at once,
	// so it applies to the state it was made against. Renders unless a task run will. During
	// the engines' commit it waits for them to finish, so every engine sees changes in order.
	applyExternal(producer, source = null, info = null) {
		if (this._committing) {
			this._deferred.push(() => this.applyExternal(producer, source, info));
			return;
		}
		const curRoot = this.rootComponent;
		if (curRoot === null) return;
		const newRoot = produce(curRoot, producer);
		if (newRoot === curRoot) return;
		const commit = this.prepareEngines(curRoot, newRoot, null, source);
		this.rootComponent = newRoot;
		commit();
		this.checkState(null, curRoot);
		this.notify("externalApplied", { source, info, curRoot, newRoot });
		if (this._handlingTasks) return;
		this.render();
		this.checkSettled();
	}
	handleTasks() {
		if (this._handlingTasks) return;
		if (this.rootComponent === null) return this.clearTasks();
		this._handlingTasks = true;
		this.cancelTick();
		const t1 = Date.now();
		const oldRootComponent = this.rootComponent;
		try {
			while (this.tasks.length > 0) {
				const task = this.tasks.shift();
				try {
					this.handleTask(task);
				} catch (error) {
					this.notify("taskFailed", { task, error });
				}
				if (Date.now() - t1 > 16) break;
			}
		} finally {
			try {
				if (oldRootComponent !== this.rootComponent) this.render();
			} catch (error) {
				// Reported as a failed task is, instead of escaping the tick that rendered.
				this.notify("renderFailed", { error });
			} finally {
				this._handlingTasks = false;
				if (this.tasks.length > 0) this.scheduleNextTaskTick();
				else this.checkSettled();
			}
		}
	}
	// Fixes where a task made outside a handler goes, against root, before pushTask.
	prepareTask(task, root) {
		task.prepare(root);
	}
	handleTask(task) {
		const curRoot = this.rootComponent;
		// A notification starts from its sender, found as any address is, and visits the ancestors
		// it has then.
		if (task instanceof NotifyTask && task.hops === null) {
			if (this.receiver(task, task.from, curRoot) === null) return;
			task.start(curRoot);
		}
		const { to } = task;
		const path = to.updatePath;
		const instance = this.receiver(task, to, curRoot);
		if (instance === null) return;
		if (task instanceof AskTask) return this.startAsk(task, instance);
		let ctx;
		let newRoot;
		try {
			newRoot = produce(curRoot, (rootDraft) => {
				const leafDraft = path.getIn(rootDraft);
				ctx = new MessageContext(task, this.env, scopeOf(instance), this.nextRequest);
				const newLeaf = task.run(instance, leafDraft, ctx);
				return path.setIn(rootDraft, newLeaf);
			});
		} catch (error) {
			// What went unhandled before the failure is reported, as the spec and tutuca-wax do.
			for (const message of ctx?.unhandled ?? []) this.notify("unhandled", { task, message });
			throw error;
		}
		// Where what it sends goes is fixed against the tree it committed.
		for (const child of ctx.tasks) child.prepare(newRoot);
		const commit = this.prepareEngines(curRoot, newRoot, task);
		this.rootComponent = newRoot;
		commit();
		for (const child of ctx.tasks) this.pushTask(child);
		// A bubble's hops run back to back; what each hop sends waits behind them.
		if (ctx.nextHop !== null) this.tasks.unshift(ctx.nextHop);
		for (const message of ctx.unhandled) this.notify("unhandled", { task, message });
		this.checkState(task, curRoot);
		this.checkMessage(task, ctx, instance, path.getIn(newRoot));
		this.notify("taskHandled", { task, path, instance, curRoot, newRoot });
	}
	// The component address names in root, or null when there is none to deliver task to: the
	// one it recorded is gone (orphaned), or another took its place (stale: it was replaced, or a
	// list shifted), so the message, for the one before, is dropped and reported. A notification's
	// hops can't move while it bubbles, so one that can't find its next hop is a bug (lost).
	receiver(task, address, root) {
		const path = address.updatePath;
		const found = address.resolve(root);
		if (found.instance !== undefined) return found.instance;
		if (task instanceof NotifyTask && address === task.to) {
			console.assert(false, "a notification lost its hop", task);
			this.notify("lost", { task, path });
		} else if (found.orphaned) this.notify("orphaned", { task, path });
		else this.notify("stale", { task, path, id: address.id, found: found.stale });
		return null;
	}
	// An ask starts here, after what asked committed, outside any transaction: nothing can
	// undo what its handler started. A reply now runs next, ahead of the queue; a later one
	// joins the queue when it settles.
	startAsk(task, instance) {
		const ctx = new MessageContext(task, this.env, scopeOf(instance), this.nextRequest);
		const { now, later } = task.start(instance, ctx);
		if (now !== undefined) this.tasks.unshift(now);
		if (later !== undefined) later.then((reply) => this.pushTask(reply));
		const root = this.rootComponent;
		this.notify("taskHandled", {
			task,
			path: task.to.updatePath,
			instance,
			curRoot: root,
			newRoot: root,
		});
	}
	notify(type, info) {
		setTimeout(() => this.onNotify(type, info), 0);
	}
}

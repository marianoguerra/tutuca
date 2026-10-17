// The host: registers components in scopes, renders the root and runs tasks against its state.
import { produce } from "../deps/immer.js";
import { getEventInfoFor } from "./events.js";
import { routeFor } from "./paths.js";
import { findInvalidFields, messageIssues } from "./schema.js";
import { EventTask, MessageContext } from "./tasks.js";
import { render as $render } from "./vdom.js";
import { RenderContext, renderView, toVChilds } from "./view.js";

export class Scope {
	constructor(onRegister, parent = null) {
		this.onRegister = onRegister;
		this.parent = parent;
		this.byName = Object.create(null);
		this.askHandlers = Object.create(null);
		this.components = new Proxy(Object.create(null), {
			get: (_target, name) => this.factory(name),
		});
	}
	enter() {
		return new Scope(this.onRegister, this);
	}
	register(comps) {
		const factories = {};
		for (const name in comps) {
			const spec = comps[name];
			this.byName[name] = spec;
			this.onRegister(spec, name);
			factories[name] = this.factory(name);
		}
		return factories;
	}
	factory(name) {
		return (args) => this.make(name, args);
	}
	lookup(getter) {
		let scope = this;
		while (scope !== null) {
			const v = getter(scope);
			if (v !== undefined) return v;
			scope = scope.parent;
		}
		return null;
	}
	registerAskHandlers(handlers) {
		Object.assign(this.askHandlers, handlers);
	}
	lookupAskHandler(name) {
		return this.lookup((scope) => scope.askHandlers[name]);
	}
	lookupByName(name) {
		return this.lookup((scope) => scope.byName[name]);
	}
	// Every spec registered here or in a parent, by name; inner registrations win.
	allSpecs() {
		const specs = {};
		for (let s = this; s !== null; s = s.parent) {
			for (const name in s.byName) specs[name] ??= s.byName[name];
		}
		return specs;
	}
	make(name, args) {
		const spec = this.lookupByName(name);
		if (spec === null) throw new Error(`Component ${String(name)} is not registered`);
		return spec.make(args, this);
	}
}
export class Host {
	constructor({ document, rootNode, dev = false }) {
		this.document = document;
		this.rootNode = rootNode;
		this.dev = dev; // Check the state against the schemas on start and after each task.
		this.rootComponent = null;
		this.registrations = new Set();
		this.componentNames = new Set(); // In any scope, aliases included.
		this.tasks = [];
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
		const check = { fields: true, invariants: task === null };
		const issues = findInvalidFields(this.rootComponent, prevRoot, check);
		if (issues.length > 0) this.notify("stateInvalid", { task, issues });
	}
	// Dev mode: once the queue is empty, check the invariants of what changed since it last was.
	checkSettled() {
		if (!this.dev || this._settledRoot === this.rootComponent) return;
		const check = { fields: false, invariants: true };
		const issues = findInvalidFields(this.rootComponent, this._settledRoot, check);
		this._settledRoot = this.rootComponent;
		if (issues.length > 0) this.notify("stateInvalid", { task: null, settled: true, issues });
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
		const info = getEventInfoFor(e, this.rootNode, this.rootComponent);
		if (info === null) return;
		this.pushTask(new EventTask(e, info));
		this.handleTasks();
	}
	addEventListeners(eventNames) {
		for (const eventName of eventNames) {
			if (this._eventsAdded.has(eventName)) continue;
			this._eventsAdded.add(eventName);
			this.rootNode.addEventListener(eventName, this);
		}
	}
	pushTask(task) {
		this.tasks.push(task);
		if (!this._handlingTasks) this.scheduleNextTaskTick();
	}
	scheduleNextTaskTick() {
		if (this._taskTickTimeoutId !== null) return;
		this._taskTickTimeoutId = setTimeout(this.handleTasks, 0);
	}
	// Drops the queued tasks and the pending tick; an async ask reply in flight still arrives.
	clearTasks() {
		this.tasks.length = 0;
		clearTimeout(this._taskTickTimeoutId);
		this._taskTickTimeoutId = null;
	}
	// Stops handling events and tasks: handleEvent ignores events without a root.
	stop() {
		this.clearTasks();
		this.rootComponent = null;
	}
	handleTasks() {
		if (this._handlingTasks) return;
		this._handlingTasks = true;
		clearTimeout(this._taskTickTimeoutId);
		this._taskTickTimeoutId = null;
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
			} finally {
				this._handlingTasks = false;
				if (this.tasks.length > 0) this.scheduleNextTaskTick();
				else this.checkSettled();
			}
		}
	}
	prepareTask(task, root) {
		if (task.route !== null) return;
		task.route = routeFor(task.target.freeze(root));
	}
	handleTask(task) {
		const curRoot = this.rootComponent;
		const { route } = task;
		const path = route.updatePath;
		const instance = path.getIn(curRoot);
		const children = [];
		let status = "pending";
		// The context can outlive this transaction (e.g. an ask reply). Only pending
		// children are staged; later messages enqueue normally after a successful commit.
		const pushTask = (child) => {
			if (status === "pending") children.push(child);
			else if (status === "committed") {
				this.prepareTask(child, this.rootComponent);
				this.pushTask(child);
			}
		};
		let newRoot;
		let ctx;
		try {
			newRoot = produce(curRoot, (rootDraft) => {
				const leafDraft = path.getIn(rootDraft);
				ctx = new MessageContext(task, route.path, pushTask);
				const newLeaf = task.run(instance, leafDraft, ctx);
				return path.setIn(rootDraft, newLeaf);
			});
			for (const child of children) this.prepareTask(child, newRoot);
		} catch (error) {
			status = "failed";
			children.length = 0;
			throw error;
		}
		this.rootComponent = newRoot;
		status = "committed";
		for (const child of children) this.pushTask(child);
		children.length = 0;
		this.checkState(task, curRoot);
		this.checkMessage(task, ctx, instance, path.getIn(newRoot));
		this.notify("taskHandled", { task, path, instance, curRoot, newRoot });
	}
	notify(type, info) {
		setTimeout(() => this.onNotify(type, info), 0);
	}
}

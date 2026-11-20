// How tutuca binds src/tree: how a component's spec gives the tree its handlers, the context
// they get (the world, the scope and the DOM event), messages from the host (DOM events among
// them), and the Scheduler a Host runs its tasks with.
import { current, isDraft, produce } from "../../../deps/immer.js";
import { HOST, hidden, KeyPath, MessageContext, Scheduler, Task } from "../../tree/index.js";
import { metaOf } from "../model/component-meta.js";
import { isComponent, scopeOf, specOf } from "../model/spec.js";

// The handlers of a component: its spec's on (sends and notifications) and answers, and its
// scope's ask handlers.
export const componentHandlers = {
	handler(instance, { mode, name, outcome }) {
		const spec = specOf(instance);
		const handler = mode === "answer" ? spec.answers[name]?.[outcome] : spec.on[name];
		return handler === undefined ? undefined : swapChecked(handler);
	},
	askHandler: (instance, name) => scopeOf(instance)?.lookupAskHandler(name) ?? null,
};
// A handler as the tree runs it: its run changes next and returns nothing (or next); a swap
// handler's may return the component its own becomes instead. One that returns anything else
// fails its task. Made once per handler; the spec keeps the handler as written, for lint.
const checkedRuns = new WeakMap();
const swapChecked = (handler) => {
	if (typeof handler?.run !== "function") return handler;
	let checked = checkedRuns.get(handler);
	if (checked !== undefined) return checked;
	const { run, swap, name } = handler;
	const result = (r, next) => {
		if (r === undefined || r === next) return r;
		if (!swap) {
			throw new Error(
				`${name} returned a value: a message that replaces its component says swap: true`,
			);
		}
		if (!isComponent(r)) {
			throw new TypeError(
				`${name} is a swap: it returns the component its own becomes, or nothing, not ${String(r)}`,
			);
		}
		return r;
	};
	checked = Object.create(handler, {
		run: {
			value: handler.pure
				? function (next, args) {
						return result(run.call(this, next, args), next);
					}
				: function (next, args, ctx) {
						return result(run.call(this, next, args, ctx), next);
					},
		},
	});
	checkedRuns.set(handler, checked);
	return checked;
};
export class HandlerContext extends MessageContext {
	/** @param {import("../model/scope.js").Scope | null} scope */
	constructor(task, nextId, env, scope) {
		super(task, nextId);
		this.env = env;
		this.scope = scope; // The handling component's scope, to make components from.
		this.event = task.event ?? null; // The DOM event, in event tasks.
		this.node = task.node ?? null; // The element whose handler an event task runs.
		// What is being dragged, in drag events, as this handler reads it (drag.js's Drag.at).
		this.drag = task.drag?.at(this.path) ?? null;
	}
	// A component made in the handling component's scope, by its registered name: what a
	// handler puts in its state.
	make(name, fields = {}) {
		if (this.scope === null) throw new Error(`ctx.make(${name}): the component has no scope`);
		return this.scope.make(name, fields);
	}
	// make's result instead of its failure: { ok: component } or { err: { error, issues } }, for
	// a handler to show instead of failing its task.
	tryMake(name, fields = {}) {
		if (this.scope === null) {
			return { err: { error: `${name} can't be made: the component has no scope`, issues: [] } };
		}
		return this.scope.tryMake(name, fields);
	}
	// The names of the components a handler can make: its scope's, with walk its parents' too.
	componentNames(walk = false) {
		return this.scope?.componentNames(walk) ?? [];
	}
	// What the type a handler's scope can make as name says under uri (metaOf, over its meta
	// schema's defaults), or null when the scope can't make it: what a picker shows it by.
	metaOf(name, uri) {
		const spec = this.scope?.lookupSpec(name) ?? null;
		return spec === null ? null : metaOf(spec, uri, this.scope);
	}
	// A draft logged is logged as it is now: it's revoked once the handler commits.
	log(value) {
		super.log(isDraft(value) ? current(value) : value);
	}
	// A message nobody handled: warned about here, reported after the commit.
	reportUnhandled(name, instance) {
		const on = instance === null ? "" : ` on ${specOf(instance)?.name ?? "?"}`;
		console.warn(`handler ${name} not found${on} at ${this.path}`);
		super.reportUnhandled(name, instance);
	}
	// The world, as the host's env gives it, so a Driver's runs repeat. Handlers use these
	// instead of Date.now(), Math.random() and crypto.randomUUID().
	now() {
		return this.env.now();
	}
	random() {
		return this.env.random();
	}
	uuid() {
		return this.env.uuid();
	}
	// An ask handler reads the asker's scope (to list or make the components it can), path,
	// source key and the world.
	readable() {
		return {
			...super.readable(),
			scope: this.scope,
			componentNames: (walk) => this.componentNames(walk),
			metaOf: (name, uri) => this.metaOf(name, uri),
			// What it logs is the asked transition's logs.
			log: (value) => this.log(value),
			now: () => this.now(),
			random: () => this.random(),
			uuid: () => this.uuid(),
		};
	}
}
// A message from the host, the root's parent: what host.send makes, for a DOM event or for
// anything outside the app (an agent, a test, a bar). Its args are values, worked out before it
// is sent. One sent now (an environment event: spec/tree's env rule) runs ahead of the queue, and
// the ones sent now after it wait behind it. event, node and drag are what its handler reads as
// ctx.event, ctx.node and ctx.drag.
export class HostTask extends Task {
	constructor(name, args, to, { now = false, event = null, node = null, drag = null } = {}) {
		super(name, args, HOST, to, null);
		this.now = now;
		hidden(this, { event, node, drag }); // back-references into the DOM
	}
	get runsBeforeEnv() {
		return this.now;
	}
}
// A task's transaction: root with the node at keyPath replaced by what fn makes of its draft.
// The root is held in a record, so what replaces the node (a swap) replaces the root as it would
// any other node, its draft written or not: immer refuses a recipe that writes its draft and
// returns another value.
export const leafProduce = (root, keyPath, fn) => {
	const at = new KeyPath(["root", ...keyPath.keys]);
	return produce({ root }, (holder) => {
		const leaf = at.getIn(holder);
		const next = fn(leaf);
		if (next !== leaf) at.setIn(holder, next);
	}).root;
};
// The Scheduler that delivers host's tasks against its root: the tree's store is the host's
// root, a transaction is immer's produce (dev mode's checks also record who wrote what), and the
// host hears what happens through its hooks.
export const schedulerFor = (host) =>
	new Scheduler({
		handlers: componentHandlers,
		store: { get: () => host.root, set: (root) => (host.root = root) },
		transact: (root, keyPath, fn) =>
			host.checks !== null
				? host.checks.transact(root, keyPath, fn)
				: leafProduce(root, keyPath, fn),
		hooks: {
			context: (task, instance, nextId) =>
				new HandlerContext(task, nextId, host.env, scopeOf(instance)),
			beforeCommit: (prev, next, task) => host.engines.prepare(prev, next, task),
			transition: (record, ctx) => host.transitioned(record, ctx),
			wake: () => host.wake(),
			watchOpened: (watch) => host.watchOpened(watch),
			watchSettled: (watch) => host.watchSettled(watch),
		},
	});

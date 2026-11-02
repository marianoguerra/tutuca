// What tutuca adds to the tree's messages: the context its handlers get (the world, the scope and
// the DOM event), messages from the host (DOM events among them), and how a component's spec
// gives the tree its handlers.
import { scopeOf, specOf } from "./schema.js";
import { HOST, MessageContext, Task } from "./tree/index.js";

// The handlers of a component: its spec's on (sends and notifications) and answers, and its
// scope's ask handlers.
export const componentKinds = {
	handler(instance, { mode, name, outcome }) {
		const spec = specOf(instance);
		return mode === "answer" ? spec.answers[name]?.[outcome] : spec.on[name];
	},
	askHandler: (instance, name) => scopeOf(instance)?.lookupAskHandler(name) ?? null,
};
export class TutucaContext extends MessageContext {
	/** @param {import("./scope.js").Scope | null} scope */
	constructor(task, nextRequest, env, scope) {
		super(task, nextRequest);
		this.env = env;
		this.scope = scope; // The handling component's scope, to make components from.
		this.event = task.event ?? null; // The DOM event, in event tasks.
		this.node = task.node ?? null; // The element whose handler an event task runs.
		this.drag = task.drag ?? null; // What is being dragged, in drag events.
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
		this.event = event;
		this.node = node;
		this.drag = drag;
	}
	get runsBeforeEnv() {
		return this.now;
	}
}

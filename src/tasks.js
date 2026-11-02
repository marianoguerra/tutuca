// What tutuca adds to the tree's messages: the context its handlers get (the world, the scope and
// the DOM event), DOM events as tasks, and how a component's spec gives the tree its handlers.
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
	constructor(task, nextRequest, env, scope) {
		super(task, nextRequest);
		this.env = env;
		this.scope = scope; // The handling component's scope, to make components from.
		this.event = task.event;
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
export class EventTask extends Task {
	// An event comes from the host, to the component it reached when it happened.
	constructor(e, { handler, to, node = null }, drag = null) {
		super(handler.action.name, [], HOST, null, null);
		this.event = e;
		this.node = node;
		this.drag = drag;
		this.handler = handler;
		this.to = to;
	}
	get runsBeforeEnv() {
		return true;
	}
	// A message the component doesn't handle keeps it as it was and is reported, as any other
	// (components compose dynamically, so a view can send one its component lacks).
	run(handler, instance, next, ctx) {
		this.args = this.handler.action.args.map((arg) => arg.eval(ctx));
		return super.run(handler, instance, next, ctx);
	}
}

// Tasks: the messages, notifications, asks and events the host runs, and their MessageContext.
import { routeFor, selectorFrom, Target } from "./paths.js";
import { scopeOf, specOf } from "./schema.js";

// A handler returns a replacement for the component, or undefined to keep next.
// The handler's contract counts what it emits, not what ran before it in the task (an ask
// handler, before the reply's).
const call = (message, instance, next, args, ctx) => {
	ctx.handled = { message, args };
	ctx.emitted = [];
	const result = message.run.call(instance, next, args, ctx);
	return result === undefined ? next : result;
};
const run = (instance, next, handlerName, args, ctx) => {
	const handler = specOf(instance).on[handlerName];
	if (handler !== undefined) return call(handler, instance, next, args, ctx);
	console.warn("handler", handlerName, "not found on", instance, { args, ctx });
	return next;
};
export class MessageContext {
	constructor(task, path, pushTask, env, scope) {
		this.task = task;
		this.env = env;
		this.scope = scope; // The handling component's scope, to make components from.
		this.path = path.toComponentPath();
		this.pushTask = pushTask;
		this.event = task.event;
		this.node = task.node ?? null; // The element whose handler an event task runs.
		this.drag = task.drag ?? null; // What is being dragged, in drag events.
		this.sourceKey = task.sourcePath.sourceKeyIn(this.path);
		this.isStopNextSet = false;
		this.handled = null; // { message, args } once a handler runs.
		this.emitted = []; // { kind, name, args } the handler sent, for the message's emits.
		this.later = []; // Promises of the replies of asks answered later, queued on commit.
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
	notify(name, args = []) {
		this.emitted.push({ kind: "notify", name, args });
		if (this.path.isRootPath) return;
		this.push(NotifyTask, name, args, new Target(this.path.toParentPath()));
	}
	ask(name, args = []) {
		this.emitted.push({ kind: "ask", name, args });
		this.push(AskTask, name, args, new Target(this.path));
	}
	stopNext() {
		this.isStopNextSet = true;
	}
	sendAt(name, args, pathBuilderFn) {
		this.emitted.push({ kind: "sendAt", name, args });
		this.push(Task, name, args, new Target(this.path, selectorFrom(pathBuilderFn)));
	}
	forwardAt(pathBuilderFn) {
		this.sendAt(this.task.name, this.task.args, pathBuilderFn);
	}
	push(TaskClass, name, args, target) {
		this.pushTask(new TaskClass(name, args, this.path, target, this.task));
	}
}
export class Task {
	constructor(name, args, sourcePath, target, parent) {
		this.name = name;
		this.args = args;
		this.sourcePath = sourcePath;
		this.target = target;
		this.parent = parent;
		this.event = null;
		this.route = null;
	}
	run(instance, next, ctx) {
		return run(instance, next, this.name, this.args, ctx);
	}
}
export class NotifyTask extends Task {
	run(instance, next, ctx) {
		const result = super.run(instance, next, ctx);
		if (ctx.path.isRootPath || ctx.isStopNextSet) return result;
		const { name, args, sourcePath } = this;
		ctx.pushTask(new NotifyTask(name, args, sourcePath, new Target(ctx.path.toParentPath()), this));
		return result;
	}
}
export class AskTask extends Task {
	run(instance, next, ctx) {
		const handler = scopeOf(instance)?.lookupAskHandler(this.name);
		if (!handler) {
			return run(instance, next, `${this.name}HandlerNotFound`, [], ctx);
		}
		const okName = `${this.name}ReplyOk`;
		const errName = `${this.name}ReplyError`;
		// An ask handler only answers, from the ask's arguments: it gets no context to send from.
		let result;
		try {
			result = handler(this.args);
		} catch (err) {
			return run(instance, next, errName, [err], ctx);
		}
		if (result instanceof Promise) {
			ctx.later.push(
				result.then(
					(r) => this.makeReply(okName, [r]),
					(error) => this.makeReply(errName, [error]),
				),
			);
			return next;
		}
		// Outside the try: a throwing ReplyOk fails the task instead of running ReplyError.
		return run(instance, next, okName, [result], ctx);
	}
	makeReply(name, args) {
		const reply = new Task(name, args, this.sourcePath, new Target(this.sourcePath), this);
		reply.route = routeFor(this.sourcePath);
		return reply;
	}
}
export class EventTask extends Task {
	constructor(e, { handler, route, node = null }, drag = null) {
		super(handler.action.name, [], route.path, new Target(route.path), null);
		this.event = e;
		this.node = node;
		this.drag = drag;
		this.handler = handler;
		this.route = route;
	}
	run(instance, next, ctx) {
		this.args = this.handler.action.args.map((arg) => arg.eval(ctx));
		return call(specOf(instance).on[this.name], instance, next, this.args, ctx);
	}
}

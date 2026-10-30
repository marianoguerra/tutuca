// Tasks: the messages, notifications, asks and events the host runs, and their MessageContext.
import { Address, HOST, selectorFrom, Target } from "./paths.js";
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
// A message nobody handled: warned about and reported after the commit.
const unhandled = (ctx, name, instance) => {
	const on = instance === null ? "" : ` on ${specOf(instance)?.name ?? "?"}`;
	console.warn(`handler ${name} not found${on} at ${ctx.path}`);
	ctx.unhandled.push(name);
};
// A message the component has no handler for keeps it as it was, and is reported (unhandled).
const run = (instance, next, handlerName, args, ctx) => {
	const handler = specOf(instance).on[handlerName];
	if (handler !== undefined) return call(handler, instance, next, args, ctx);
	unhandled(ctx, handlerName, instance);
	return next;
};
let requests = 0;
const defaultNextRequest = () => ++requests;
export class MessageContext {
	// nextRequest gives the id of an ask made from here; the host's counts per host, so runs
	// repeat.
	constructor(task, env, scope, nextRequest = defaultNextRequest) {
		this.task = task;
		this.env = env;
		this.nextRequest = nextRequest;
		// In a reply handler, the id of the ask it answers (what ctx.ask returned); null
		// elsewhere.
		this.request = task.request ?? null;
		this.scope = scope; // The handling component's scope, to make components from.
		this.path = task.to.path.toComponentPath();
		// The component the message reached: what the handler sends comes from here.
		this.address = new Address(this.path, task.to.id);
		// What the handler sends, staged: the host queues it once the task commits, so a task that
		// fails sends nothing.
		this.tasks = [];
		this.event = task.event;
		this.node = task.node ?? null; // The element whose handler an event task runs.
		this.drag = task.drag ?? null; // What is being dragged, in drag events.
		// The child the message came through; for one from the host, such as an event, the loop
		// item it reached, below the component.
		const through = task.from.isHost ? task.to : task.from;
		this.sourceKey = through.path.sourceKeyIn(this.path);
		this.isStopNextSet = false;
		this.handled = null; // { message, args } once a handler runs.
		this.emitted = []; // { kind, name, args } the handler sent, for the message's emits.
		this.unhandled = []; // The messages it had no handler for.
		this.nextHop = null; // For a notification going on up: its next hop.
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
	// A notification bubbles to the ancestors. The root has none, so one from the root goes
	// nowhere: nobody can handle it, and it's reported unhandled.
	notify(name, args = []) {
		this.emitted.push({ kind: "notify", name, args });
		if (this.path.isRootPath) unhandled(this, name, null);
		else this.push(NotifyTask, name, args, null);
	}
	// Asks the scope's ask handler; returns the request's id, which its reply's handler reads
	// as ctx.request. The answer comes back to a handler in the component's answers.
	ask(name, args = []) {
		this.emitted.push({ kind: "ask", name, args });
		const request = this.nextRequest();
		const task = new AskTask(name, args, this.address, null, this.task);
		task.to = this.address;
		task.request = request;
		this.tasks.push(task);
		return request;
	}
	// Stops the notification being handled from bubbling further. Anything else doesn't
	// bubble, so there it does nothing: a handler can serve a notify and a send alike.
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
	// A message to the sender of the one being handled, where and as it was when it sent it: a
	// sender another component replaced since is stale. A notification keeps its sender at every
	// hop, so a reply from any hop reaches the component that notified. One to the host (from a
	// DOM event's or an answer's handler) is unhandled: the host has no handlers.
	reply(name, args = []) {
		this.emitted.push({ kind: "reply", name, args });
		if (this.task.from.isHost) return unhandled(this, name, null);
		const task = new Task(name, args, this.address, null, this.task);
		task.to = this.task.from;
		this.tasks.push(task);
	}
	// What an ask handler gets: the asker's scope (to list or make the components it can),
	// path, source key and the world, and nothing to send with, so nothing it does outlives
	// the ask's task.
	readOnly() {
		return Object.freeze({
			scope: this.scope,
			path: this.path,
			sourceKey: this.sourceKey,
			now: () => this.now(),
			random: () => this.random(),
			uuid: () => this.uuid(),
		});
	}
	push(TaskClass, name, args, target) {
		this.tasks.push(new TaskClass(name, args, this.address, target, this.task));
	}
}
export class Task {
	// from is the sender's Address; to, where it goes, is fixed from target once the sender
	// commits, against the tree it committed.
	constructor(name, args, from, target, parent) {
		this.name = name;
		this.args = args;
		this.from = from;
		this.target = target;
		this.parent = parent;
		this.event = null;
		this.to = null;
	}
	prepare(root) {
		this.to ??= this.target.address(root);
	}
	run(instance, next, ctx) {
		return run(instance, next, this.name, this.args, ctx);
	}
}
// A notification on its way up. An ancestor without a handler for it passes it on, silently;
// handled says whether any hop so far had one. It stops at a handler that calls stopNext, or at
// the root, where it's reported unhandled, once, if no hop handled it. The hops are its sender's
// ancestors when it starts: a bubble is one turn, so they can't move while it runs.
export class NotifyTask extends Task {
	constructor(name, args, from, target, parent, handled = false, hops = null) {
		super(name, args, from, target, parent);
		this.handled = handled;
		this.hops = hops;
		this.to = hops?.[0] ?? null;
	}
	// Its hops are fixed when it starts, not when it's sent.
	prepare() {}
	start(root) {
		this.hops = this.from.ancestors(root);
		this.to = this.hops[0];
	}
	run(instance, next, ctx) {
		const message = specOf(instance).on[this.name];
		const handled = this.handled || message !== undefined;
		const result = message === undefined ? next : call(message, instance, next, this.args, ctx);
		if (ctx.isStopNextSet) return result;
		if (ctx.path.isRootPath) {
			if (!handled) unhandled(ctx, this.name, instance);
			return result;
		}
		// The next hop runs right after this one, before anything else queued.
		const { name, args, from, hops } = this;
		ctx.nextHop = new NotifyTask(name, args, from, null, this, handled, hops.slice(1));
		return result;
	}
}
// An ask runs no transaction of its own: once what asked has committed, the host starts it,
// and its answer comes back to the asker as a reply task, now or when it settles. A reply
// that fails fails only itself, whether it came now or later.
export class AskTask extends Task {
	// The scope's handler, run with the asker's context to read: { now } a reply to run next,
	// or { later } the promise of one.
	start(instance, ctx) {
		const handler = scopeOf(instance)?.lookupAskHandler(this.name);
		if (!handler) return { now: this.makeAnswer("unhandled", []) };
		// An ask handler only answers: it reads the asker's context, but can't send from it.
		let result;
		try {
			result = handler(this.args, ctx.readOnly());
		} catch (err) {
			return { now: this.makeAnswer("error", [err]) };
		}
		if (result instanceof Promise) {
			const later = result.then(
				(r) => this.makeAnswer("ok", [r]),
				(error) => this.makeAnswer("error", [error]),
			);
			return { later };
		}
		return { now: this.makeAnswer("ok", [result]) };
	}
	makeAnswer(outcome, args) {
		// The host answers, back to the asker as it was when it asked.
		const answer = new AnswerTask(this.name, outcome, args, this.request, HOST, this);
		answer.to = this.from;
		return answer;
	}
}
// The answer to an ask, for the asker's answers[ask][outcome]: ok with the value, error with
// the error, unhandled (no scope has a handler for the ask) with none. Answers aren't
// messages: nothing but an ask's answer reaches these handlers.
export const ANSWER_OUTCOMES = ["ok", "error", "unhandled"];
export class AnswerTask extends Task {
	constructor(ask, outcome, args, request, from, parent) {
		super(`${ask}.${outcome}`, args, from, null, parent);
		this.ask = ask;
		this.outcome = outcome;
		this.request = request;
	}
	run(instance, next, ctx) {
		const handler = specOf(instance).answers[this.ask]?.[this.outcome];
		if (handler !== undefined) return call(handler, instance, next, this.args, ctx);
		unhandled(ctx, this.name, instance);
		return next;
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
	// A message the component doesn't handle keeps it as it was and is reported, as any other
	// (components compose dynamically, so a view can send one its component lacks).
	run(instance, next, ctx) {
		this.args = this.handler.action.args.map((arg) => arg.eval(ctx));
		return run(instance, next, this.name, this.args, ctx);
	}
}

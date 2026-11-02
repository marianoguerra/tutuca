// The envelope (spec/tree's (msg mode m from to)): a message's name and args, its sender's address
// (from) and where it goes (to). Each kind says which handler key it is for (hkey, spec/tree's
// (send n), (notify n), (ok n), ...) and what it does with the handler the scheduler found for it.
import { Address, HOST } from "./address.js";

// A handler returns a replacement for the node, or undefined to keep next.
// The handler's contract counts what it emits, not what ran before it in the task (an ask
// handler, before the reply's).
export const call = (handler, instance, next, args, ctx) => {
	ctx.handled = { message: handler, args };
	ctx.emitted = [];
	const result = handler.run.call(instance, next, args, ctx);
	return result === undefined ? next : result;
};
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
	get hkey() {
		return { mode: "send", name: this.name };
	}
	// Whether an env event that arrives waits behind it: the events that came before it, and a
	// bubble under way, which is one turn (spec/tree's env rule runs an event ahead of the rest).
	get runsBeforeEnv() {
		return false;
	}
	prepare(root) {
		this.to ??= Address.of(this.target, root);
	}
	// A message the node has no handler for keeps it as it was, and is reported (unhandled).
	run(handler, instance, next, ctx) {
		if (handler !== undefined) return call(handler, instance, next, this.args, ctx);
		ctx.reportUnhandled(this.name, instance);
		return next;
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
	get hkey() {
		return { mode: "notify", name: this.name };
	}
	// A started bubble runs its hops back to back.
	get runsBeforeEnv() {
		return this.hops !== null;
	}
	// Its hops are fixed when it starts, not when it's sent.
	prepare() {}
	start(root) {
		this.hops = this.from.ancestors(root);
		this.to = this.hops[0];
	}
	run(handler, instance, next, ctx) {
		const handled = this.handled || handler !== undefined;
		const result = handler === undefined ? next : call(handler, instance, next, this.args, ctx);
		if (ctx.isStopNextSet) return result;
		if (ctx.path.isRootPath) {
			if (!handled) ctx.reportUnhandled(this.name, instance);
			return result;
		}
		// The next hop runs right after this one, before anything else queued.
		const { name, args, from, hops } = this;
		ctx.nextHop = new NotifyTask(name, args, from, null, this, handled, hops.slice(1));
		return result;
	}
}
// An ask runs no transaction of its own: once what asked has committed, the host starts it,
// and its answer comes back to the asker as an answer task, now or when it settles. An answer
// that fails fails only itself, whether it came now or later.
export class AskTask extends Task {
	// handler, the one that answers the ask (null when none does), runs with what the asker's
	// context lets it read: { now } an answer to run next (an urgent response), or { later } the
	// promise of one (a normal response).
	start(handler, readCtx) {
		if (!handler) return { now: this.makeAnswer("unhandled", []) };
		let result;
		try {
			result = handler(this.args, readCtx);
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
// The answer to an ask, for the asker's handler for (outcome ask): ok with the value, error with
// the error, unhandled (nobody answers the ask) with none. Answers aren't messages: nothing but
// an ask's answer reaches these handlers.
export const ANSWER_OUTCOMES = ["ok", "error", "unhandled"];
export class AnswerTask extends Task {
	constructor(ask, outcome, args, request, from, parent) {
		super(`${ask}.${outcome}`, args, from, null, parent);
		this.ask = ask;
		this.outcome = outcome;
		this.request = request;
	}
	get hkey() {
		return { mode: "answer", name: this.ask, outcome: this.outcome };
	}
}

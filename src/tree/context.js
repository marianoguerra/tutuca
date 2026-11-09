// What a handler sends with: the routing half of its context. A host extends it with what its
// handlers read from the world.
import { Address } from "./address.js";
import { AskTask, NotifyTask, Task } from "./messages.js";
import { selectorFrom, Target } from "./path.js";
import { Watch } from "./watch.js";

export class MessageContext {
	// nextRequest gives the id of an ask made from here; the scheduler's counts per scheduler, so
	// runs repeat.
	/** @param {Task} task */
	constructor(task, nextRequest) {
		this.task = task;
		this.nextRequest = nextRequest;
		// In an answer handler, the id of the ask it answers (what ctx.ask returned); null
		// elsewhere.
		this.request = task.request ?? null;
		this.path = task.to.path.toNodePath();
		// The node the message reached: what the handler sends comes from here.
		this.address = new Address(this.path, task.to.id);
		// What the handler sends, staged: the scheduler queues it once the task commits, so a task
		// that fails sends nothing.
		this.tasks = [];
		// The child the message came through; for one from the host, such as an event, the loop
		// item it reached, below the node.
		const through = task.from.isHost ? task.to : task.from;
		this.sourceKey = through.path.sourceKeyIn(this.path);
		this.isStopNextSet = false;
		this.ran = null; // { message, args } once a handler runs.
		this.emitted = []; // { kind, name, args } the handler sent, for the message's emits.
		this.unhandled = []; // The messages it had no handler for.
		this.nextHop = null; // For a notification going on up: its next hop.
		this.cancels = []; // The ids of the watches it cancels, once it commits.
	}
	// A message nobody handles here (instance is null when there is no node to handle it, as for
	// a notification from the root or a reply to the host): reported after the commit.
	reportUnhandled(name, _instance) {
		this.unhandled.push(name);
	}
	// A notification bubbles to the ancestors. The root has none, so one from the root goes
	// nowhere: nobody can handle it, and it's reported unhandled.
	notify(name, args = []) {
		this.emitted.push({ kind: "notify", name, args });
		if (this.path.isRootPath) this.reportUnhandled(name, null);
		else this.push(NotifyTask, name, args, null);
	}
	// Asks the host; returns the request's id, which its answer's handler reads as ctx.request.
	// Detached, the ask and its answer are in no watch: nothing waits for them.
	ask(name, args = [], { detached = false } = {}) {
		this.emitted.push({ kind: "ask", name, args });
		const request = this.nextRequest();
		const task = new AskTask(name, args, this.address, this.task, request);
		if (detached) task.watch = null;
		this.tasks.push(task);
		return request;
	}
	// Stops the notification being handled from bubbling further. Anything else doesn't
	// bubble, so there it does nothing: a handler can serve a notify and a send alike.
	stopNext() {
		this.isStopNextSet = true;
	}
	// A message down the path the selector fn writes, relative to here (spec/tree's send-at).
	// With a watch it opens one (watch.js) and returns its id: settled, a name or
	// [name, args], is sent back here, with args and the watch's report after them, once the
	// message and everything it caused ran; progress, likewise, after what runs in it, at most
	// one queued at a time; timeout (ms) cancels it if it hasn't settled by then. Detached, it's
	// in no watch: nothing waits for it.
	sendAt(name, args, selectorFn, watch = {}) {
		this.emitted.push({ kind: "sendAt", name, args });
		const task = new Task(
			name,
			args,
			this.address,
			new Target(this.path, selectorFrom(selectorFn)),
			this.task,
		);
		this.tasks.push(task);
		if (watch.detached) task.watch = null;
		if (watch.settled == null && watch.progress == null && watch.timeout == null) return undefined;
		const id = this.nextRequest();
		const outer = watch.detached ? null : this.task.watch;
		task.watch = new Watch(id, this.address, watch, outer);
		return id;
	}
	// Cancels the watch id opened (sendAt's), once this handler commits: see watch.js.
	cancel(id) {
		this.cancels.push(id);
	}
	forwardAt(selectorFn) {
		this.sendAt(this.task.name, this.task.args, selectorFn);
	}
	// A message to the sender of the one being handled, where and as it was when it sent it: a
	// sender another node replaced since is stale. A notification keeps its sender at every
	// hop, so a reply from any hop reaches the node that notified. One to the host (from an env
	// event's or an answer's handler) is unhandled: the host has no handlers.
	reply(name, args = []) {
		this.emitted.push({ kind: "reply", name, args });
		if (this.task.from.isHost) return this.reportUnhandled(name, null);
		this.tasks.push(new Task(name, args, this.address, this.task.from, this.task));
	}
	// What an ask's handler gets: what it can read, and nothing to send with, so nothing it does
	// outlives the ask's task.
	readOnly() {
		return Object.freeze(this.readable());
	}
	readable() {
		return { path: this.path, sourceKey: this.sourceKey };
	}
	push(TaskClass, name, args, target) {
		this.tasks.push(new TaskClass(name, args, this.address, target, this.task));
	}
}

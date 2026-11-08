// The Driver: runs a component tree through a dev-mode Host with no timers, headless or
// rendered, and keeps what it reports. Tests, stress runs and the live storybook drive apps
// through it.
import { DevChecks } from "../dev/checks.js";
import {
	Address,
	AnswerTask,
	DispatchPath,
	Frame,
	Host,
	isComponent,
	Selector,
	scopeOf,
	specOf,
	Target,
	Task,
} from "../tutuca.js";

// An env whose runs repeat: a clock stopped at start until advance(ms) moves it, numbers from
// a generator seeded with seed, and uuid-shaped ids that count up.
export const testEnv = ({ seed = 1, start = Date.UTC(2026, 0, 1) } = {}) => {
	let time = start;
	let state = seed >>> 0;
	let ids = 0;
	return {
		now: () => time,
		advance(ms) {
			time += ms;
		},
		// mulberry32
		random() {
			state = (state + 0x6d2b79f5) >>> 0;
			let x = state;
			x = Math.imul(x ^ (x >>> 15), x | 1);
			x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
			return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
		},
		uuid: () => `00000000-0000-4000-8000-${(++ids).toString(16).padStart(12, "0")}`,
	};
};

// A plain copy of a state for comparing runs: components become { $: name, ...fields }.
export const snapshot = (v) => {
	if (v === null || typeof v !== "object") return v;
	if (Array.isArray(v)) return v.map(snapshot);
	const out = isComponent(v) ? { $: specOf(v).name } : {};
	for (const key of Object.keys(v)) out[key] = snapshot(v[key]);
	return out;
};

export const PROBLEMS = new Set(["taskFailed", "stateInvalid", "messageInvalid"]);

// Runs messages on a component tree through Host's task handling in dev mode, with no
// timers. With a document it renders too; otherwise it is headless. Live keeps the timers,
// for async ask replies and events from a user, and only keeps problems in reports;
// onReport gets every report as it happens.
const specsOf = (root) => Object.values(scopeOf(root)?.allSpecs() ?? {});
export class Driver {
	constructor({
		root,
		document = null,
		rootNode = null,
		live = false,
		onReport = null,
		env = testEnv(),
	}) {
		const node = rootNode ?? document?.createElement("main") ?? null;
		this.env = env; // Its clock moves with env.advance(ms).
		this.host = new Host({ document, rootNode: node, checks: DevChecks, env });
		this.reports = [];
		this.host.notify = (type, info) => {
			const report = { type, ...info };
			if (!live || PROBLEMS.has(type)) this.reports.push(report);
			onReport?.(report);
		};
		if (!live) this.host.scheduleNextTaskTick = () => {};
		for (const spec of specsOf(root)) this.host.addEventListeners(spec.eventNames);
		this.host.start(root);
	}
	get state() {
		return this.host.root;
	}
	// The specs the state's root can make, by name in its scope.
	get specs() {
		return specsOf(this.state);
	}
	get rootNode() {
		return this.host.rootNode;
	}
	// Problems reported since start: failed tasks, invalid state, broken handler specs.
	get problems() {
		return this.reports.filter((r) => PROBLEMS.has(r.type));
	}
	// The problems reported after the first before reports.
	problemsSince(before) {
		return this.reports.slice(before).filter((r) => PROBLEMS.has(r.type));
	}
	// Send name to the component at path, a DispatchPath or a Selector from the root, as the
	// host does. from is the frames (or a Selector) from it to the child the message comes
	// through, which sets ctx.sourceKey: then the child sends it, as a test can and the host
	// can't.
	send(path, name, args = [], from = []) {
		if (from.length === 0 || (from instanceof Selector && from.ops.length === 0)) {
			this.host.send(name, args, { to: path });
			return this.drain();
		}
		const base = path instanceof Selector ? new DispatchPath(path.fix(this.state)) : path;
		const fromFrames =
			from instanceof Selector ? from.fix(base.toKeyPath().getIn(this.state)) : from;
		const sender = Address.at(base.concat(fromFrames), this.state);
		const task = new Task(name, args, sender, new Target(base), null);
		task.prepare(this.state);
		this.host.pushTask(task);
		this.drain();
	}
	// The answer to an ask, as if the scope's handler gave it: for path's answers[ask][outcome]
	// (ok and error take the value or error as args[0]), with the request id ctx.request reads.
	answer(path, ask, outcome, args = [], request = null) {
		const task = new AnswerTask(ask, outcome, args, request, this.host.addressOf(path), null);
		this.host.pushTask(task);
		this.drain();
	}
	drain() {
		while (this.host.tasks.length > 0) this.host.handleTasks();
	}
	// Dispatches an event of type on target, an element or a selector in what it rendered, as a
	// browser would (bubbling, cancelable, with init: { ctrlKey, key, ... }), and runs what it
	// causes.
	fire(type, target, init = {}) {
		const el = typeof target === "string" ? this.rootNode.querySelector(target) : target;
		const view = this.rootNode.ownerDocument.defaultView;
		const Event = /^(click|dblclick|mouse)/.test(type)
			? view.MouseEvent
			: type.startsWith("key")
				? view.KeyboardEvent
				: view.Event;
		el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
		this.drain();
	}
	click(target, init = {}) {
		this.fire("click", target, init);
	}
	// Continue from root instead, dropping queued tasks: rewinds a timeline. An async ask
	// reply already in flight still arrives, against the new root.
	restart(root) {
		this.host.clearTasks();
		this.host.start(root);
	}
}

// The frame that reads keys from the previous component: the last key is the item, if
// any collection was crossed.
const frameFor = (keys) =>
	keys.length === 1
		? new Frame(keys, null, null, true)
		: new Frame(keys.slice(0, -1), keys.at(-1), null, true);
// The components in state with the path to each, parents first.
export const componentPaths = (state) => {
	const found = [];
	// keys: read since the last component, null at the root.
	const visit = (value, frames, keys) => {
		if (value === null || typeof value !== "object") return;
		if (isComponent(value)) {
			const path = keys === null ? frames : [...frames, frameFor(keys)];
			found.push({ path: new DispatchPath(path), instance: value });
			for (const name of Object.keys(specOf(value).fields)) visit(value[name], path, [name]);
			return;
		}
		for (const key of Object.keys(value)) {
			visit(value[key], frames, [...keys, Array.isArray(value) ? Number(key) : key]);
		}
	};
	visit(state, [], null);
	return found;
};

// One line per problem a Driver reported, for errors and logs.
export const describeProblems = (problems) =>
	problems.map((p) => {
		if (p.type === "taskFailed") return `taskFailed: ${p.error?.stack ?? p.error}`;
		if (p.type === "messageInvalid") return `messageInvalid ${p.message}: ${p.issues.join(", ")}`;
		const issues = p.issues.map((i) => `${i.component} ${i.path.join(".")} ${i.reason}`);
		return `stateInvalid: ${issues.join("; ")}`;
	});

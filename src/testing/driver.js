// The Driver (tutuca/testing): runs a component tree through a dev-mode Host with no timers,
// headless or rendered, and keeps what it reports. Tests, stress runs and the live storybook
// drive apps through it: it sends messages, answers asks and fires DOM events as a user would.
import { isProblem, problemLines } from "../core/host/records.js";
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

// Runs messages on a component tree through Host's task handling in dev mode, with no
// timers. With a document it renders too; otherwise it is headless. It keeps what the host
// reports (Transitions and HostEvents), as it reports them. Live keeps the timers, for async
// ask replies and events from a user, and only keeps problems in reports; onReport gets every
// report as it happens.
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
		this.reports = [];
		const publish = (record) => {
			if (!live || isProblem(record)) this.reports.push(record);
			onReport?.(record);
		};
		// Not live, nothing runs later: drain runs the tasks.
		const schedule = live ? undefined : () => () => {};
		this.host = new Host({ document, rootNode: node, checks: DevChecks, env, publish, schedule });
		for (const spec of specsOf(root)) this.host.addEventListeners(spec.eventTypes);
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
		return this.reports.filter(isProblem);
	}
	// The problems reported after the first before reports.
	problemsSince(before) {
		return this.reports.slice(before).filter(isProblem);
	}
	// What became of the tasks run (and the pure messages applied) since start.
	get transitions() {
		return this.reports.filter((r) => r.kind === "transition");
	}
	// The rest of what the host reported: started, rendered, settled, ...
	get hostEvents() {
		return this.reports.filter((r) => r.kind === "hostEvent");
	}
	// Sends name(...args) to the component at to, as host.send takes it (the root by default),
	// and runs what it causes. from is the frames (or a Selector) from it to the child the
	// message comes through, which sets ctx.sourceKey: then the child sends it, as a test can and
	// the host can't, and to is a DispatchPath or a Selector.
	send(name, args = [], { to = new DispatchPath(), from = [] } = {}) {
		if (from.length === 0 || (from instanceof Selector && from.ops.length === 0)) {
			this.host.send(name, args, { to });
			return this.drain();
		}
		const base = to instanceof Selector ? new DispatchPath(to.fix(this.state)) : to;
		const fromFrames =
			from instanceof Selector ? from.fix(base.toKeyPath().getIn(this.state)) : from;
		const sender = Address.at(base.concat(fromFrames), this.state);
		const task = new Task(name, args, sender, new Target(base), null);
		task.prepare(this.state);
		this.host.pushTask(task);
		this.drain();
	}
	// The answer to an ask, as if the scope's handler gave it: for the answers[ask][outcome] of
	// the component at to (ok and error take the value or error as args[0]), with the request
	// id ctx.request reads.
	answer(ask, outcome, args = [], { to = new DispatchPath(), request = null } = {}) {
		const task = new AnswerTask(ask, outcome, args, request, this.host.addressOf(to), null);
		this.host.pushTask(task);
		this.drain();
	}
	drain() {
		while (this.host.tasks.length > 0) this.host.handleTasks();
	}
	// Dispatches an event of type on target, an element or a selector in what it rendered, as a
	// browser would (bubbling, cancelable, with init: { ctrlKey, key, ... }), and runs what it
	// causes. With a value in init, target is a form field set to it first, as a user would.
	fire(type, target, { value, ...init } = {}) {
		const el = this.elementOf(target);
		if (value !== undefined) setValue(el, value);
		const view = this.rootNode.ownerDocument.defaultView;
		const Event = /^(click|dblclick|mouse)/.test(type)
			? view.MouseEvent
			: type.startsWith("key")
				? view.KeyboardEvent
				: view.Event;
		el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
		this.drain();
	}
	// Drags from onto to (elements or selectors), firing the events a browser does.
	drag(from, to) {
		const [source, target] = [this.elementOf(from), this.elementOf(to)];
		this.fire("dragstart", source);
		for (const type of ["dragenter", "dragover", "drop"]) this.fire(type, target);
		this.fire("dragend", source);
	}
	elementOf(target) {
		return typeof target === "string" ? this.rootNode.querySelector(target) : target;
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

// The lines that say what is wrong with the problems a Driver reported, for errors and logs.
export const describeProblems = (problems) => problems.flatMap(problemLines);
const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// Sets a form field to value: a checkbox checked or not, a select to the option value names
// (or, when none does, one picked by it, as a select only takes one of its options).
const setValue = (el, value) => {
	if (el.type === "checkbox") el.checked = Boolean(value);
	else if (el.tagName === "SELECT") {
		const options = [...el.options].map((o) => o.value);
		const text = String(value);
		if (options.includes(text)) el.value = text;
		else if (options.length > 0) el.value = options[text.length % options.length];
	} else if (FORM_FIELDS.has(el.tagName)) el.value = String(value);
};

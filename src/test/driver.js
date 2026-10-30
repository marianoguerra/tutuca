// The Driver: runs a component tree through a dev-mode Host with no timers, headless or
// rendered, and keeps what it reports. Tests, stress runs and the live storybook drive apps
// through it.
import {
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
	testEnv,
} from "../tutuca.js";

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
export class Driver {
	constructor({
		root,
		document = null,
		rootNode = null,
		live = false,
		onReport = null,
		env = testEnv(),
	}) {
		const node = rootNode ?? document?.createElement("main") ?? { addEventListener() {} };
		this.env = env; // Its clock moves with env.advance(ms).
		this.host = new Host({ document, rootNode: node, dev: true, env });
		this.reports = [];
		this.host.notify = (type, info) => {
			const report = { type, ...info };
			if (!live || PROBLEMS.has(type)) this.reports.push(report);
			onReport?.(report);
		};
		if (!live) this.host.scheduleNextTaskTick = () => {};
		if (document === null) this.host.render = () => {};
		else
			for (const spec of Object.values(scopeOf(root)?.allSpecs() ?? {})) {
				this.host.addEventListeners(spec.eventNames);
			}
		this.host.start(root);
	}
	get state() {
		return this.host.rootComponent;
	}
	get rootNode() {
		return this.host.rootNode;
	}
	// Problems reported since start: failed tasks, invalid state, broken message specs.
	get problems() {
		return this.reports.filter((r) => PROBLEMS.has(r.type));
	}
	// The problems reported after the first before reports.
	problemsSince(before) {
		return this.reports.slice(before).filter((r) => PROBLEMS.has(r.type));
	}
	// Send name to the component at path, a DispatchPath or a Selector from the root; from is
	// the frames (or a Selector) from it to the child the message comes through, which sets
	// ctx.sourceKey.
	send(path, name, args = [], from = []) {
		const base = path instanceof Selector ? new DispatchPath(path.freeze(this.state)) : path;
		const fromFrames =
			from instanceof Selector ? from.freeze(base.resolve().getIn(this.state)) : from;
		const task = new Task(name, args, base.concat(fromFrames), new Target(base), null);
		this.host.prepareTask(task, this.state);
		this.host.pushTask(task);
		this.drain();
	}
	// The answer to an ask, as if the scope's handler gave it: for path's answers[ask][outcome]
	// (ok and error take the value or error as args[0]), with the request id ctx.request reads.
	answer(path, ask, outcome, args = [], request = null) {
		const base = path instanceof Selector ? new DispatchPath(path.freeze(this.state)) : path;
		const task = new AnswerTask(ask, outcome, args, request, base, null);
		this.host.prepareTask(task, this.state);
		this.host.pushTask(task);
		this.drain();
	}
	drain() {
		while (this.host.tasks.length > 0) this.host.handleTasks();
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

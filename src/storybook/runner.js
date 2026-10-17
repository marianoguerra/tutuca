// Runs stories live in <tutuca-app>s for the UI: a StoryRunner per mounted app, with a timeline
// of states, and the StoryRegistry that answers the UI's "story" asks.

import { ClassCompiler } from "../dev/classes.js";
import { lint } from "../lint/index.js";
import {
	componentPaths,
	Driver,
	describeProblems,
	drivableMessages,
	messageCommand,
	PROBLEMS,
	resolveRefs,
	snapshot,
} from "../test/pbt.js";
import { EventTask, Frame, specOf } from "../tutuca.js";
import {
	argsLabel,
	json,
	prepareStory,
	runStep,
	step,
	stepText,
	stressProperty,
} from "./stories.js";

export const rootTask = (task) => {
	while (task.parent !== null) task = task.parent;
	return task;
};
export const taskLabel = (task) => {
	const call = `${task.name}(${argsLabel(task.args)})`;
	return task instanceof EventTask ? `${task.event.type} → ${call}` : call;
};
export const STRESS_IDLE = { status: "idle", done: 0, total: 0, error: "", commands: [] };

// Runs a story live in a <tutuca-app>: the controller passed to mount. Keeps a timeline of
// states, one entry per step and per user interaction, to go back and forth through.
export class StoryRunner {
	constructor(story, { fc, seed = 0, css = "", links = [], classes = null }) {
		Object.assign(this, { story, fc, seed, css, links, classes });
		this.detail = null;
		this.driver = null;
		this.busy = false; // Reports during our own steps are recorded by the step.
		this.pending = []; // Problems of user tasks, until their taskHandled.
		this.publishQueued = false;
		this.stressToken = null;
		this.lastStress = null; // { root, commands } of the last failed stress run.
		this.messagesBySpec = new Map();
	}
	mount(detail) {
		this.detail = detail;
		for (const href of this.links) detail.adoptLink(href);
		if (this.css !== "") detail.adoptCss(this.css);
		this.classes?.watch(detail.rootNode, detail.adoptCss(""));
		const { A, root, scope } = prepareStory(this.story, { fc: this.fc, seed: this.seed });
		this.A = A;
		const specs = scope.allSpecs();
		this.specs = Object.values(specs);
		this.issues = lint(this.specs, Object.keys(specs));
		const { document, rootNode } = detail;
		const onReport = (report) => this.onReport(report);
		this.driver = new Driver({ root, document, rootNode, live: true, onReport });
		const [first = ""] = Object.keys(this.story.sequences);
		this.sequence = first;
		this.steps = this.story.sequences[first] ?? [];
		this.begin(root, describeProblems(this.driver.problems));
		detail.mount(this);
	}
	dispose() {
		this.stressToken = null;
		this.detail = null;
		this.driver.host.stop();
	}
	get current() {
		return this.timeline[this.cursor];
	}
	get nextStep() {
		return this.current.nextStep;
	}
	act(fn) {
		this.busy = true;
		try {
			return fn();
		} finally {
			this.busy = false;
		}
	}
	// A new timeline from root.
	begin(root, problems = null) {
		const before = this.driver.reports.length;
		if (problems === null) this.act(() => this.driver.restart(root));
		const initial = problems ?? describeProblems(this.driver.problemsSince(before));
		this.timeline = [
			{
				label: "initial",
				origin: "initial",
				state: root,
				problems: initial,
				nextStep: 0,
				tasks: [],
			},
		];
		this.cursor = 0;
		this.publish();
	}
	record(entry) {
		this.timeline.length = this.cursor + 1;
		this.timeline.push(entry);
		this.cursor = this.timeline.length - 1;
	}
	runAt(s, stepIndex, nextStep) {
		this.tasks = [];
		const result = this.act(() => runStep(this.driver, s));
		const { status, error, problems } = result;
		const label = stepText(s);
		const { state } = this.driver;
		const { tasks } = this;
		this.record({
			label,
			origin: "step",
			state,
			problems,
			error,
			status,
			stepIndex,
			nextStep,
			tasks,
		});
		this.publish();
		return result;
	}
	// Operations, called by the storybook's "story" ask handler.
	load(name) {
		if (name === "counterexample") return this.loadCounterexample();
		this.sequence = name;
		this.steps = this.story.sequences[name] ?? [];
		this.begin(this.timeline[0].state);
	}
	goto(i) {
		this.cursor = Math.max(0, Math.min(Number(i), this.timeline.length - 1));
		this.act(() => this.driver.restart(this.current.state));
		this.publish();
	}
	reset() {
		this.goto(0);
	}
	back() {
		this.goto(this.cursor - 1);
	}
	// Redo, else run the next step of the sequence; false when there is none.
	forward() {
		if (this.cursor < this.timeline.length - 1) {
			this.goto(this.cursor + 1);
			return true;
		}
		const i = this.nextStep;
		if (i >= this.steps.length) return false;
		return this.runAt(this.steps[i], i, i + 1).status === "ok";
	}
	toEnd() {
		if (this.cursor < this.timeline.length - 1) this.goto(this.timeline.length - 1);
		while (this.nextStep < this.steps.length && this.forward()) {}
	}
	// A step outside the sequence, at the current position.
	runSingle(s) {
		return this.runAt(s, null, this.nextStep);
	}
	targets() {
		return componentPaths(this.driver.state).map(({ path, instance }) => {
			const spec = specOf(instance);
			const messages = this.messagesOf(spec).map((m) => ({
				...m,
				keys: m.index === null ? [] : m.index.keysIn(instance),
			}));
			return { path, instance, label: `${spec.name} at ${path}`, messages };
		});
	}
	messagesOf(spec) {
		if (!this.messagesBySpec.has(spec)) {
			const { drivable, untyped } = drivableMessages(this.A, spec);
			const typed = drivable.map(({ message, index, args }) => ({ message, index, args }));
			const rest = untyped.map((name) => ({ message: spec.on[name], index: null, args: null }));
			this.messagesBySpec.set(spec, [...typed, ...rest]);
		}
		return this.messagesBySpec.get(spec);
	}
	findMessage(targetIndex, name) {
		const target = this.targets()[Number(targetIndex)];
		if (target === undefined) throw new Error(`no target #${targetIndex}`);
		const message = target.messages.find((m) => m.message.name === name);
		if (message === undefined) throw new Error(`${target.label} has no message ${name}`);
		return { target, message };
	}
	sendTo(targetIndex, name, argsJson, key) {
		const { target, message } = this.findMessage(targetIndex, name);
		const args = JSON.parse(argsJson.trim() || "[]");
		if (!Array.isArray(args)) throw new Error("args must be a JSON array");
		let fromFrames = [];
		if (message.index !== null) {
			const sourceKey = message.keys.find((k) => String(k) === key);
			if (sourceKey === undefined) throw new Error(`no ${message.index.fieldName} key ${key}`);
			fromFrames = [new Frame([message.index.fieldName], sourceKey, null, true)];
		}
		const label = `${target.label}.${name}(${argsLabel(args)})`;
		this.runSingle({ kind: "send", name, args, path: target.path, fromFrames, label });
	}
	// Generated args for a message, as JSON for the step form.
	sampleArgs(targetIndex, name, seed) {
		const { target, message } = this.findMessage(targetIndex, name);
		if (message.args === null) throw new Error(`${name} has no typed args to generate`);
		const [args] = this.fc.sample(message.args, { seed: Number(seed), numRuns: 1 });
		const types = message.message.args;
		const resolved = args.map((arg, i) => resolveRefs(arg, types?.[i], target.instance));
		return { argsJson: json(resolved) };
	}
	// A generated message that applies to the current state, run as a single step.
	randomStep(seed) {
		const arb = messageCommand(this.A, this.story.pbt ?? {});
		const cmds = this.fc.sample(arb, { seed: Number(seed), numRuns: 30 });
		const cmd = cmds.find((c) => c.check({ state: this.driver.state }));
		if (cmd === undefined) throw new Error("no generated message applies to the current state");
		this.runSingle(step.command(cmd));
	}
	// Runs the stress test in batches, yielding between them; resolves with the result for
	// the stress panel and reports progress meanwhile.
	async stress({ numRuns = 100, maxCommands = 20, seed = 1, from = "story", events = false }) {
		const token = {};
		this.stressToken = token;
		const { fc, A } = this;
		const root = from === "current" ? this.driver.state : this.timeline[0].state;
		const total = numRuns;
		const result = (r) => ({ ...STRESS_IDLE, total, ...r });
		let property;
		try {
			const document = events ? this.detail.document.implementation.createHTMLDocument("") : null;
			property = stressProperty(this.story, { fc, A, root, from, events, maxCommands, document });
		} catch (error) {
			return result({ status: "unavailable", error: error.message });
		}
		const batch = Math.max(1, Math.min(10, numRuns));
		let done = 0;
		while (done < numRuns) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			if (this.stressToken !== token) return result({ status: "cancelled", done });
			const runSeed = seed + done;
			const details = fc.check(property, {
				numRuns: Math.min(batch, numRuns - done),
				seed: runSeed,
			});
			done += details.numRuns;
			if (details.failed) {
				const [failedRoot, cmds] = details.counterexample;
				const commands = [...cmds];
				this.lastStress = { root: failedRoot, commands };
				const message = String(details.errorInstance?.message ?? details.errorInstance);
				const error = `${message}\n(seed ${runSeed}, path "${details.counterexamplePath}")`;
				this.publish(); // The counterexample sequence is now loadable.
				return result({ status: "failed", done, error, commands: commands.map(String) });
			}
			this.detail?.emit("stress", { status: "running", done, total });
		}
		return result({ status: "passed", done });
	}
	cancelStress() {
		this.stressToken = null;
	}
	loadCounterexample() {
		if (this.lastStress === null) throw new Error("no failed stress run to load");
		const { root, commands } = this.lastStress;
		this.sequence = "counterexample";
		this.steps = commands.map((c) => step.command(c.clone(), String(c)));
		this.begin(root);
	}
	// Tasks from the user or from async replies; problems precede their taskHandled.
	onReport(report) {
		const { type } = report;
		if (type === "taskHandled") this.tasks?.push(report.task); // For the entry that records them.
		if (type === "render" && this.detail !== null) this.classes?.scan(this.detail.rootNode);
		if (this.driver === null || this.busy) return;
		if (PROBLEMS.has(type)) {
			this.pending.push(report);
			if (type === "taskFailed" || report.settled) this.addProblems(this.current);
			return;
		}
		if (type !== "taskHandled") return;
		const root = rootTask(report.task);
		let entry = this.current;
		if (entry.rootTask === root) {
			entry.state = report.newRoot;
			entry.tasks = [...entry.tasks, report.task];
		} else {
			entry = { label: taskLabel(root), origin: "user", state: report.newRoot, problems: [] };
			Object.assign(entry, { status: "ok", nextStep: this.nextStep, rootTask: root });
			entry.tasks = [report.task];
			this.record(entry);
		}
		this.tasks = [];
		this.addProblems(entry);
	}
	addProblems(entry) {
		if (this.pending.length > 0) {
			entry.problems = [...entry.problems, ...describeProblems(this.pending)];
			entry.status = "failed";
			this.pending = [];
		}
		if (this.publishQueued) return;
		this.publishQueued = true;
		queueMicrotask(() => {
			this.publishQueued = false;
			this.publish();
		});
	}
	statusOf(i) {
		const entry = this.timeline.findLast((e) => e.stepIndex === i);
		return entry === undefined ? "pending" : entry.status;
	}
	summary() {
		const { current } = this;
		const names = Object.keys(this.story.sequences);
		if (this.lastStress !== null) names.push("counterexample");
		return {
			sequences: names,
			sequence: this.sequence,
			steps: this.steps.map((s, i) => ({
				label: stepText(s),
				status: this.statusOf(i),
				isNext: i === this.nextStep,
			})),
			timeline: this.timeline.map((e, i) => ({
				label: e.label,
				origin: e.origin,
				problemCount: e.problems.length,
				isCurrent: i === this.cursor,
			})),
			cursor: this.cursor,
			problems: current.error && current.status !== "failed" ? [current.error] : current.problems,
			error: current.status === "ok" ? "" : (current.error ?? ""),
			stateJson: JSON.stringify(snapshot(current.state), null, 2) ?? "",
			// Live values for the dev panel, which keeps refs to them, not the values.
			dev: {
				state: current.state,
				tasks: current.tasks.map((task) => ({ label: "", value: task })),
				specs: this.specs,
				issues: this.issues,
			},
			targets: this.targets().map((t) => ({
				label: t.label,
				messages: t.messages.map((m) => ({
					name: m.message.name,
					sourceKeys: m.keys.map(String),
				})),
			})),
		};
	}
	publish() {
		this.detail?.emit("state", this.summary());
	}
}

// The live runners by app key, `${storyId}@${seed}`; answers <tutuca-app> requests.
export class StoryRegistry {
	constructor({ fc, books, css = "", links = [], compile = null, known = [] }) {
		Object.assign(this, { fc, css, links });
		this.classes = compile === null ? null : new ClassCompiler(compile, known);
		this.stories = new Map(books.flatMap((book) => book.stories.map((s) => [s.id, s])));
		this.runners = new Map();
	}
	mount(detail) {
		const at = detail.key?.lastIndexOf("@") ?? -1;
		const story = this.stories.get(at < 0 ? detail.key : detail.key.slice(0, at));
		if (story === undefined) return;
		const seed = at < 0 ? 0 : Number(detail.key.slice(at + 1)) || 0;
		const { fc, css, links, classes } = this;
		const runner = new StoryRunner(story, { fc, seed, css, links, classes });
		const { dispose } = runner;
		runner.dispose = () => {
			this.runners.delete(detail.key);
			dispose.call(runner);
		};
		runner.mount(detail);
		this.runners.set(detail.key, runner);
	}
	call(key, op, args) {
		const runner = this.runners.get(key);
		if (runner === undefined) throw new Error(`story ${key} is not mounted`);
		if (!OPS.has(op)) throw new Error(`unknown story operation ${op}`);
		return runner[op](...args);
	}
}
export const OPS = new Set([
	"load",
	"goto",
	"reset",
	"back",
	"forward",
	"toEnd",
	"sendTo",
	"sampleArgs",
	"randomStep",
	"stress",
	"cancelStress",
	"loadCounterexample",
]);

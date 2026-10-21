// Runs stories live in <tutuca-app>s for the UI: a StoryRunner per mounted app, with a timeline
// of states, and the StoryRegistry that answers the UI's "story" asks.

import { ClassCompiler } from "../css/classes.js";
import { argsLabel, rootTask, Timeline, taskLabel } from "../history/index.js";
import { lint } from "../lint/index.js";
import { jsonText } from "../paths.js";
import { diff } from "../sync/diff.js";
import { carry, specChanges } from "../sync/migrate.js";
import { opText } from "../sync/ops.js";
import { componentPaths, Driver, describeProblems, PROBLEMS, snapshot } from "../test/driver.js";
import { drivableMessages, messageCommand, resolveRefs, sourceFrames } from "../test/pbt.js";
import { specOf } from "../tutuca.js";
import { prepareStory, runStep, step, stepText } from "./stories.js";
import { runStress } from "./stress.js";

// Runs a story live in a <tutuca-app>: the controller passed to mount. Keeps a timeline of
// states, one entry per step and per user interaction, to go back and forth through.
export class StoryRunner {
	constructor(story, { fc, seed = 0, css = "", links = [], classes = null, carried = null }) {
		Object.assign(this, { story, fc, seed, css, links, classes, carried });
		this.reload = []; // What carrying the last run's state did, when there was one.
		this.detail = null;
		this.driver = null;
		this.busy = false; // Reports during our own steps are recorded by the step.
		this.pending = []; // Problems of user tasks, until their taskHandled.
		this.publishQueued = false;
		this.stressToken = null;
		this.lastStress = null; // { root, commands } of the last failed stress run.
		this.messagesBySpec = new Map();
		this.timeline = new Timeline();
	}
	mount(detail) {
		this.detail = detail;
		for (const href of this.links) detail.adoptLink(href);
		if (this.css !== "") detail.adoptCss(this.css);
		this.classes?.watch(detail.rootNode, detail.adoptCss(""));
		const prepared = prepareStory(this.story, { fc: this.fc, seed: this.seed });
		const { A, scope } = prepared;
		this.A = A;
		this.scope = scope;
		const specs = scope.allSpecs();
		this.specs = Object.values(specs);
		this.issues = lint(this.specs, Object.keys(specs));
		const { root, lost } = this.carryOver(prepared.root);
		const { document, rootNode } = detail;
		const onReport = (report) => this.onReport(report);
		this.driver = new Driver({ root, document, rootNode, live: true, onReport });
		const [first = ""] = Object.keys(this.story.sequences);
		const sequence = this.carried?.sequence;
		this.sequence = Object.hasOwn(this.story.sequences, sequence ?? "") ? sequence : first;
		this.steps = this.story.sequences[this.sequence] ?? [];
		const problems = [...lost, ...describeProblems(this.driver.problems)];
		if (this.carried === null) this.begin(root, problems);
		else {
			const nextStep = this.sequence === sequence ? this.carried.nextStep : 0;
			this.begin(root, problems, { label: "hot reload", origin: "reload", nextStep });
		}
		this.carried = null;
		detail.mount(this);
	}
	dispose() {
		this.stressToken = null;
		this.detail = null;
		this.driver.host.stop();
	}
	get current() {
		return this.timeline.current;
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
	// The last run's state made again with this run's components, else made: { root, lost }, lost
	// the problem lines for what didn't carry. The Host reports the invariants root breaks.
	carryOver(made) {
		if (this.carried === null) return { root: made, lost: [] };
		const { state, scope } = this.carried;
		const pathText = (path) => `/${path.join("/")}`;
		this.reload = specChanges(scope, this.scope).map(({ ref, field, change, before, after }) => {
			if (field === null) return `${ref} ${change}`;
			if (change === "changed") return `${ref}.${field} changed: ${before} → ${after}`;
			return `${ref}.${field} ${change}: ${before ?? after}`;
		});
		try {
			const { root, added, reset, dropped } = carry(state, this.scope);
			this.reload.push(
				...added.map((path) => `${pathText(path)} added, at its default`),
				...dropped.map((path) => `${pathText(path)} dropped`),
			);
			const lost = reset.map(
				({ path, before, after }) =>
					`${pathText(path)} reset: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
			);
			return { root, lost };
		} catch (error) {
			this.carried = null;
			return { root: made, lost: [`state not carried, started fresh: ${error.message}`] };
		}
	}
	// A new timeline from root.
	begin(root, problems = null, { label = "initial", origin = "initial", nextStep = 0 } = {}) {
		const before = this.driver.reports.length;
		if (problems === null) this.act(() => this.driver.restart(root));
		const initial = problems ?? describeProblems(this.driver.problemsSince(before));
		this.timeline.begin({ label, origin, state: root, problems: initial, nextStep, tasks: [] });
		this.publish();
	}
	runAt(s, stepIndex, nextStep) {
		this.tasks = [];
		const result = this.act(() => runStep(this.driver, s));
		const { status, error, problems } = result;
		const label = stepText(s);
		const { state } = this.driver;
		const { tasks } = this;
		this.timeline.record({
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
		this.begin(this.timeline.entries[0].state);
	}
	goto(i) {
		this.timeline.goto(i);
		this.act(() => this.driver.restart(this.current.state));
		this.publish();
	}
	reset() {
		this.goto(0);
	}
	back() {
		this.goto(this.timeline.cursor - 1);
	}
	// Redo, else run the next step of the sequence; false when there is none.
	forward() {
		if (!this.timeline.atEnd) {
			this.goto(this.timeline.cursor + 1);
			return true;
		}
		const i = this.nextStep;
		if (i >= this.steps.length) return false;
		return this.runAt(this.steps[i], i, i + 1).status === "ok";
	}
	toEnd() {
		if (!this.timeline.atEnd) this.goto(this.timeline.size - 1);
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
			const rest = untyped.map((name) => ({ message: spec.on[name], index: null, args: null }));
			this.messagesBySpec.set(spec, [...drivable, ...rest]);
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
			fromFrames = sourceFrames(message.index, sourceKey);
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
		return { argsJson: jsonText(resolved) };
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
		const root = from === "current" ? this.driver.state : this.timeline.entries[0].state;
		return await runStress({
			story: this.story,
			fc,
			A,
			root,
			from,
			events,
			maxCommands,
			numRuns,
			seed,
			createDocument: () =>
				events ? this.detail.document.implementation.createHTMLDocument("") : null,
			isCancelled: () => this.stressToken !== token,
			onProgress: (progress) => this.detail?.emit("stress", progress),
			onFailure: (failure) => {
				this.lastStress = failure;
				this.publish();
			},
		});
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
		const { task, newRoot } = report;
		let entry = this.current;
		if (!this.timeline.merge(task, newRoot)) {
			const root = rootTask(task);
			entry = { label: taskLabel(root), origin: "user", state: newRoot, problems: [] };
			Object.assign(entry, { status: "ok", nextStep: this.nextStep, rootTask: root });
			entry.tasks = [task];
			entry = this.timeline.record(entry);
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
	// What the current entry changed since the one before it, as the ops a sync engine sees
	// (every field, whatever its sync level).
	changes() {
		const prev = this.timeline.entries[this.timeline.cursor - 1];
		if (prev === undefined) return [];
		try {
			return diff(prev.state, this.current.state, { scope: this.scope, level: "none" }).map(opText);
		} catch (error) {
			return [`can't diff: ${error.message}`];
		}
	}
	statusOf(i) {
		const entry = this.timeline.entries.findLast((e) => e.stepIndex === i);
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
			timeline: this.timeline.entries.map((e, i) => ({
				label: e.label,
				origin: e.origin,
				problemCount: e.problems.length,
				isCurrent: i === this.timeline.cursor,
			})),
			cursor: this.timeline.cursor,
			problems: current.error && current.status !== "failed" ? [current.error] : current.problems,
			error: current.status === "ok" ? "" : (current.error ?? ""),
			stateJson: JSON.stringify(snapshot(current.state), null, 2) ?? "",
			changes: this.changes(),
			reload: this.reload,
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

// The live runners by app key, `${prefix}${storyId}@${seed}`; answers <tutuca-app> requests.
// A new prefix gives the same stories new keys, so their apps mount again.
// The asks of the panels: "story" runs an op on the StoryRunner of an app of registryOf(),
// "delay" waits.
export const storyAskHandlers = (registryOf) => ({
	story: ([key, op, ...args]) => {
		const registry = registryOf();
		if (registry === null) throw new Error("no stories loaded");
		return registry.call(key, op, args);
	},
	delay: ([ms]) => new Promise((resolve) => setTimeout(resolve, ms)),
	// The TimeTravel bar's ops, on the timeline of the StoryRunner of app key.
	history: ([key, op, arg]) => {
		const registry = registryOf();
		if (registry === null) throw new Error("no stories loaded");
		return registry.call(key, HISTORY_OPS[op], op === "goto" ? [arg] : []);
	},
});
const HISTORY_OPS = {
	goto: "goto",
	back: "back",
	forward: "forward",
	toStart: "reset",
	toEnd: "toEnd",
};

export class StoryRegistry {
	constructor({
		fc,
		books,
		css = "",
		links = [],
		compile = null,
		known = [],
		prefix = "",
		carried = new Map(),
	}) {
		Object.assign(this, { fc, css, links, prefix, carried });
		this.classes = compile === null ? null : new ClassCompiler(compile, known);
		this.stories = new Map(books.flatMap((book) => book.stories.map((s) => [s.id, s])));
		this.runners = new Map();
	}
	mount(detail) {
		if (!detail.key?.startsWith(this.prefix)) return;
		const key = detail.key.slice(this.prefix.length);
		const at = key.lastIndexOf("@");
		const story = this.stories.get(at < 0 ? key : key.slice(0, at));
		if (story === undefined) return;
		const seed = at < 0 ? 0 : Number(key.slice(at + 1)) || 0;
		const { fc, css, links, classes } = this;
		const carried = this.carried.get(story.id) ?? null;
		this.carried.delete(story.id); // Once: mounting the story again starts it fresh.
		const runner = new StoryRunner(story, { fc, seed, css, links, classes, carried });
		const { dispose } = runner;
		runner.dispose = () => {
			this.runners.delete(detail.key);
			dispose.call(runner);
		};
		runner.mount(detail);
		this.runners.set(detail.key, runner);
	}
	// The state each mounted story is at, by story id, for the next registry to carry over.
	carriable() {
		const carried = new Map();
		for (const runner of this.runners.values()) {
			const { story, current, scope, sequence, nextStep } = runner;
			carried.set(story.id, { state: current.state, scope, sequence, nextStep });
		}
		return carried;
	}
	call(key, op, args) {
		const runner = this.runners.get(key);
		if (runner === undefined) throw new Error(`story ${key} is not mounted`);
		if (!OPS.has(op)) throw new Error(`unknown story operation ${op}`);
		return runner[op](...args);
	}
}
const OPS = new Set([
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

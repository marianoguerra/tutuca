// A storybook for tutuca components. Projects register books of stories: an initial state,
// named sequences of steps and a property based testing config. The UI, made with tutuca,
// shows each story as an isolated app in <tutuca-app>, steps through its sequences, sends
// single messages and stress tests it with generated message or event sequences.
// fast-check is passed in, as in pbt.js.

import { ClassCompiler, classNamesOf } from "../dev/classes.js";
import { devClasses, devComponents, makeDevPanel, updateDevPanel } from "../dev/panel.js";
import { lint } from "../lint/index.js";
import {
	arbitraries,
	componentPaths,
	Driver,
	describeProblems,
	dispatchOn,
	drivableMessages,
	eventCommands,
	messageCommand,
	messageCommands,
	registeredSpecs,
	resolveRefs,
	runCommands,
	snapshot,
} from "../test/pbt.js";
import {
	$if,
	component,
	DispatchPath,
	EventTask,
	each,
	Frame,
	field,
	Host,
	lookupBind,
	render,
	renderEach,
	Scope,
	scopeOf,
	selectorFrom,
	send,
	sourceKey,
	specOf,
	t,
	tag,
	targetValue,
} from "../tutuca.js";
import { defineTutucaApp, REQUEST } from "./element.js";

const json = (v) => {
	try {
		return JSON.stringify(v) ?? String(v);
	} catch {
		return String(v);
	}
};
const clip = (text, max = 80) => (text.length > max ? `${text.slice(0, max)}…` : text);
const keyLabel = (key) => (typeof key === "string" ? `.${key}` : `[${json(key)}]`);
const frameLabel = (frame) =>
	`${frame.keys.map(keyLabel).join("")}${frame.item === null ? "" : `[${json(frame.item)}]`}`;
export const pathLabel = (path) => path.frames.map(frameLabel).join("") || "·";
const opLabel = (op) =>
	`.${op.name}${op.t === "item" ? `[${json(op.key)}]` : op.t === "seqItem" ? `[${op.keyName}]` : ""}`;
const selectorLabel = (selector) => selector.ops.map(opLabel).join("") || "·";
const argsLabel = (args) => clip(args.map(json).join(", "));

// Steps of a sequence, as plain data. at and from are PathBuilder functions relative to
// the story root, as in ctx.sendAt; from is the child the message comes through.
export const step = {
	send: (name, args = [], { at, from, label } = {}) => ({
		kind: "send",
		name,
		args,
		at,
		from,
		label: label ?? `${at ? selectorLabel(selectorFrom(at)) : "·"}.${name}(${argsLabel(args)})`,
	}),
	// value, when given, is set on the form field first, as targetValue() reads it.
	event: (type, selector, { value, label } = {}) => ({
		kind: "event",
		type,
		selector,
		value,
		label: label ?? `${type} on ${selector}`,
	}),
	check: (label, pred) => ({ kind: "check", label, pred }),
	// A MessageCommand or EventCommand from pbt.js.
	command: (cmd, label) => ({ kind: "command", cmd, label }),
};
const stepText = (s) => s.label ?? (s.kind === "command" ? String(s.cmd) : s.kind);

// A book of stories. Each story has make(C) or arbitrary(A) for its initial state, and
// optionally sequences ({ name: steps }) and pbt ({ include, exclude, afterEach,
// maxCommands, numRuns, events }) for stress tests. components and askHandlers are
// registered in each story's scope; overrides go to arbitraries.
export const stories = ({ title, components, askHandlers = {}, overrides = {}, stories }) => {
	const book = { title, components, askHandlers, overrides, stories: [] };
	for (const [name, story] of Object.entries(stories)) {
		const id = `${title}/${name}`;
		if ((story.make === undefined) === (story.arbitrary === undefined)) {
			throw new Error(`story ${id} needs one of make or arbitrary`);
		}
		book.stories.push({ sequences: {}, pbt: null, ...story, id, name, book });
	}
	return book;
};

// A story's scope, arbitraries and initial state; seed picks the state of arbitrary stories.
export const prepareStory = (story, { fc, seed = 0 }) => {
	const { components, askHandlers, overrides } = story.book;
	const scope = new Scope(() => {});
	scope.register(components);
	scope.registerAskHandlers(askHandlers);
	const A = arbitraries({ fc, scope, overrides });
	const root =
		story.make !== undefined
			? story.make(scope.components, A)
			: fc.sample(story.arbitrary(A), { seed, numRuns: 1 })[0];
	return { scope, A, root };
};

const PROBLEMS = new Set(["taskFailed", "stateInvalid", "messageInvalid"]);
// The problems driver reported since it had before reports, described.
const problemsSince = (driver, before) =>
	describeProblems(driver.reports.slice(before).filter((r) => PROBLEMS.has(r.type)));

// Runs one step on driver: { status: "ok" | "failed" | "skipped", error, problems }.
export const runStep = (driver, s) => {
	const before = driver.reports.length;
	const done = (status, error = "") => {
		const problems = problemsSince(driver, before);
		const failed = status === "ok" && problems.length > 0 ? "failed" : status;
		return { status: failed, error: error || problems.join("\n"), problems };
	};
	try {
		switch (s.kind) {
			case "send": {
				const path = s.path ?? (s.at ? selectorFrom(s.at) : new DispatchPath());
				const from = s.fromFrames ?? (s.from ? selectorFrom(s.from) : []);
				driver.send(path, s.name, s.args, from);
				break;
			}
			case "event": {
				if (typeof driver.rootNode.querySelector !== "function") {
					return done("failed", "event steps need a document");
				}
				const el = driver.rootNode.querySelector(s.selector);
				if (el === null) return done("skipped", `nothing matches ${s.selector}`);
				dispatchOn(el, s.type, s.value);
				driver.drain();
				break;
			}
			case "check":
				if (!s.pred(driver.state)) return done("failed", `check failed: ${s.label}`);
				break;
			case "command":
				if (!s.cmd.check({ state: driver.state })) {
					return done("skipped", "no target or its precondition fails");
				}
				s.cmd.run({ state: driver.state }, driver);
				break;
			default:
				return done("failed", `unknown step kind ${s.kind}`);
		}
	} catch (error) {
		return done("failed", String(error?.message ?? error));
	}
	return done("ok");
};

// Runs every sequence of story on a new Driver and throws at the first step that isn't ok.
export const checkStory = (story, { fc, document = null }) => {
	for (const [name, steps] of Object.entries(story.sequences)) {
		const { root } = prepareStory(story, { fc });
		const driver = new Driver({ root, document });
		const initial = describeProblems(driver.problems);
		if (initial.length > 0) throw new Error(`${story.id}: initial state: ${initial.join("; ")}`);
		steps.forEach((s, i) => {
			const { status, error } = runStep(driver, s);
			if (status !== "ok") {
				throw new Error(`${story.id} › ${name} › ${i + 1}. ${stepText(s)}: ${status} ${error}`);
			}
		});
	}
};

// The fc property of story's stress test: sequences of messages, or of events with a
// document, from root or, with from "generated", from instances of the root's spec.
export const stressProperty = (
	story,
	{
		fc,
		A,
		root,
		from = "story",
		events = story.pbt?.events ?? false,
		maxCommands = story.pbt?.maxCommands ?? 20,
		document = null,
	},
) => {
	if (events && document === null) throw new Error("event stress tests need a document");
	const roots = from === "generated" ? A.instance(specOf(root)) : fc.constant(root);
	const cmds = events
		? eventCommands(A, { maxCommands })
		: messageCommands(A, { ...story.pbt, maxCommands });
	const options = events ? { document } : {};
	return fc.property(roots, cmds, (r, c) => runCommands(A, r, c, options));
};

// fc.assert of story's stress test, with its pbt config.
export const stressStory = (story, { fc, document = null, numRuns, seed, ...options } = {}) => {
	const { A, root } = prepareStory(story, { fc });
	const property = stressProperty(story, { fc, A, root, document, ...options });
	fc.assert(property, { numRuns: numRuns ?? story.pbt?.numRuns ?? 50, seed });
};

const rootTask = (task) => {
	while (task.parent !== null) task = task.parent;
	return task;
};
const taskLabel = (task) => {
	const call = `${task.name}(${argsLabel(task.args)})`;
	return task instanceof EventTask ? `${task.event.type} → ${call}` : call;
};
const STRESS_IDLE = { status: "idle", done: 0, total: 0, error: "", commands: [] };

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
		const specs = registeredSpecs(scope);
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
		const { host } = this.driver;
		host.tasks.length = 0;
		clearTimeout(host._taskTickTimeoutId);
		host.rootComponent = null;
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
		const initial = problems ?? problemsSince(this.driver, before);
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
			return { path, instance, label: `${spec.name} at ${pathLabel(path)}`, messages };
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

// The UI.

const { aside, button, div, h1, h2, h3, input, label, li, main, ol, option, p, pre, section } = tag;
const { select, span, ul } = tag;
const tutucaApp = tag["tutuca-app"];

const card = "card border border-base-300 bg-base-100 p-4 shadow-sm flex flex-col gap-3";
const title = "text-sm font-semibold uppercase tracking-wider text-base-content/60";
const BADGES = {
	pending: "badge badge-sm badge-ghost",
	ok: "badge badge-sm badge-success",
	failed: "badge badge-sm badge-error",
	skipped: "badge badge-sm badge-warning",
};
const ORIGINS = { initial: "◆", step: "▸", user: "☝" };

export const StoryLink = component({
	name: "StoryLink",
	fields: (t) => ({
		id: t.string(),
		group: t.string(),
		name: t.string(),
		showGroup: t.boolean(), // The first of its group shows the group's header.
		groupSize: t.number().int().min(0),
		isGenerated: t.boolean(),
		isSelected: t.boolean(),
		isCollapsed: t.boolean(), // Its group is, and no filter shows it anyway.
	}),
	methods: {
		matches(text) {
			return this.id.toLowerCase().includes(text.toLowerCase());
		},
		// Characters, not a rotated one: no class to compile.
		get chevron() {
			return this.isCollapsed ? "▸" : "▾";
		},
	},
	view: li(
		{ class: "flex flex-col" },
		$if(
			field("showGroup"),
			button(
				{
					type: "button",
					class: `${title} mt-3 mb-1 flex items-center gap-1 text-left`,
					"aria-expanded": $if(field("isCollapsed"), "false", "true"),
					"@on.click": send("toggleGroup"),
				},
				span({ class: "w-3" }, field("chevron")),
				span({ class: "flex-1" }, field("group")),
				span({ class: "font-normal opacity-60" }, field("groupSize")),
			),
			"",
		),
		$if(
			field("isCollapsed"),
			"",
			button(
				{
					type: "button",
					class: $if(
						field("isSelected"),
						"btn btn-sm btn-primary justify-start font-normal",
						"btn btn-sm btn-ghost justify-start font-normal",
					),
					title: field("id"),
					"@on.click": send("select"),
				},
				field("name"),
			),
		),
	),
	on: {
		toggleGroup: {
			args: [],
			emits: { notify: ["groupToggled"] },
			run(_draft, _args, ctx) {
				ctx.notify("groupToggled", [this.group]);
			},
		},
		select: {
			args: [],
			emits: { notify: ["storySelected"] },
			run(_draft, _args, ctx) {
				ctx.notify("storySelected", [this.id]);
			},
		},
	},
});

const stepFields = (t) => ({
	label: t.string(),
	status: t.enum("pending", "ok", "failed", "skipped"),
	isNext: t.boolean(),
});
const entryFields = (t) => ({
	label: t.string(),
	origin: t.enum("initial", "step", "user"),
	problemCount: t.number().int().min(0),
	isCurrent: t.boolean(),
});
const SUMMARY_KEYS = [
	"sequences",
	"sequence",
	"steps",
	"timeline",
	"cursor",
	"problems",
	"error",
	"stateJson",
	"targets",
];
// Keeps the step form's choices among the current targets and their messages.
const syncForm = (draft) => {
	if (draft.target >= draft.targets.length) draft.target = 0;
	const messages = draft.targets[draft.target]?.messages ?? [];
	draft.messages = messages.map((m) => m.name);
	if (!draft.messages.includes(draft.message)) draft.message = draft.messages[0] ?? "";
	draft.sourceKeys = [...(messages.find((m) => m.name === draft.message)?.sourceKeys ?? [])];
	if (!draft.sourceKeys.includes(draft.sourceKey)) draft.sourceKey = draft.sourceKeys[0] ?? "";
};
const button$ = (attrs, ...childs) =>
	button({ type: "button", class: "btn btn-sm", ...attrs }, ...childs);

export const StoryPanel = component({
	name: "StoryPanel",
	fields: (t) => ({
		appKey: t.string(),
		sequences: t.array(t.string()),
		sequence: t.string(),
		steps: t.array(t.record(stepFields(t))),
		timeline: t.array(t.record(entryFields(t))),
		cursor: t.number().int().min(0),
		problems: t.array(t.string()),
		error: t.string(),
		stateJson: t.string(),
		targets: t.array(
			t.record({
				label: t.string(),
				messages: t.array(t.record({ name: t.string(), sourceKeys: t.array(t.string()) })),
			}),
		),
		target: t.number().int().min(0),
		messages: t.array(t.string()),
		message: t.string(),
		sourceKeys: t.array(t.string()),
		sourceKey: t.string(),
		argsJson: t.string("[]"),
		argSeed: t.number(1).int(),
		isPlaying: t.boolean(),
	}),
	methods: {
		get hasSourceKeys() {
			return this.sourceKeys.length > 0;
		},
		get hasProblems() {
			return this.problems.length > 0;
		},
		get atEnd() {
			return this.cursor >= this.timeline.length - 1 && !this.steps.some((s) => s.isNext);
		},
	},
	loops: {
		steps: {
			enrich({ value }) {
				return { badge: BADGES[value.status] };
			},
		},
		timeline: {
			enrich({ value }) {
				return { icon: ORIGINS[value.origin] };
			},
		},
	},
	view: div(
		{ class: "grid gap-4 xl:grid-cols-2" },
		section(
			{ class: card },
			div(
				{ class: "flex flex-wrap items-center gap-2" },
				select(
					{
						class: "select select-sm select-bordered",
						"aria-label": "Sequence",
						value: field("sequence"),
						"@on.change": send("selectSequence", targetValue()),
					},
					option({ value: "" }, "(no sequence)"),
					each(field("sequences"), option({ value: lookupBind("value") }, lookupBind("value"))),
				),
				div(
					{ class: "join" },
					button$(
						{ class: "btn btn-sm join-item", title: "Reset", "@on.click": send("op", "reset") },
						"⏮",
					),
					button$(
						{ class: "btn btn-sm join-item", title: "Back", "@on.click": send("op", "back") },
						"◀",
					),
					button$(
						{ class: "btn btn-sm join-item", title: "Step", "@on.click": send("op", "forward") },
						"▶",
					),
					button$(
						{
							class: "btn btn-sm join-item",
							title: "Run to end",
							"@on.click": send("op", "toEnd"),
						},
						"⏭",
					),
				),
				button$(
					{
						class: $if(field("isPlaying"), "btn btn-sm btn-warning", "btn btn-sm btn-primary"),
						"@on.click": send("togglePlay"),
					},
					$if(field("isPlaying"), "Pause", "Play"),
				),
			),
			h3({ class: title }, "Steps"),
			ol(
				{ class: "flex flex-col gap-1 text-sm" },
				each(
					field("steps"),
					li(
						{
							class: $if(
								field("isNext"),
								"flex items-center gap-2 rounded bg-base-200 px-2 py-1 font-semibold",
								"flex items-center gap-2 px-2 py-1",
							),
						},
						span({ class: lookupBind("badge") }, field("status")),
						span({ class: "min-w-0 break-all font-mono text-xs" }, field("label")),
					),
					"steps",
				),
			),
			$if(
				field("hasProblems"),
				ul(
					{ class: "flex flex-col gap-1 rounded bg-error/10 p-2", role: "alert" },
					each(
						field("problems"),
						li({ class: "whitespace-pre-wrap font-mono text-xs text-error" }, lookupBind("value")),
					),
				),
				"",
			),
			h3({ class: title }, "Send a message"),
			div(
				{ class: "flex flex-wrap items-end gap-2" },
				select(
					{
						class: "select select-sm select-bordered max-w-full",
						"aria-label": "Target component",
						value: field("target"),
						"@on.change": send("setTarget", targetValue()),
					},
					each(field("targets"), option({ value: lookupBind("key") }, field("label"))),
				),
				select(
					{
						class: "select select-sm select-bordered",
						"aria-label": "Message",
						value: field("message"),
						"@on.change": send("setMessage", targetValue()),
					},
					each(field("messages"), option({ value: lookupBind("value") }, lookupBind("value"))),
				),
				$if(
					field("hasSourceKeys"),
					select(
						{
							class: "select select-sm select-bordered",
							"aria-label": "Source key",
							value: field("sourceKey"),
							"@on.change": send("setSourceKey", targetValue()),
						},
						each(field("sourceKeys"), option({ value: lookupBind("value") }, lookupBind("value"))),
					),
					"",
				),
				input({
					class: "input input-sm input-bordered min-w-40 flex-1 font-mono",
					"aria-label": "Arguments as a JSON array",
					value: field("argsJson"),
					"@on.input": send("setArgs", targetValue()),
				}),
			),
			div(
				{ class: "flex flex-wrap gap-2" },
				button$({ "@on.click": send("generateArgs") }, "Generate args"),
				button$({ class: "btn btn-sm btn-primary", "@on.click": send("sendMessage") }, "Send"),
				button$(
					{ class: "btn btn-sm btn-secondary", "@on.click": send("randomStep") },
					"Random step",
				),
			),
		),
		div(
			{ class: "flex min-w-0 flex-col gap-4" },
			section(
				{ class: card },
				h3({ class: title }, "Timeline"),
				ol(
					{ class: "flex max-h-64 flex-col gap-1 overflow-auto" },
					each(
						field("timeline"),
						li(
							{},
							button(
								{
									type: "button",
									class: $if(
										field("isCurrent"),
										"btn btn-xs btn-primary w-full justify-start font-normal",
										"btn btn-xs btn-ghost w-full justify-start font-normal",
									),
									"@on.click": send("gotoEntry", sourceKey()),
								},
								lookupBind("icon"),
								span({ class: "min-w-0 flex-1 truncate text-left font-mono" }, field("label")),
								$if(
									field("problemCount"),
									span({ class: "badge badge-xs badge-error" }, field("problemCount")),
									"",
								),
							),
						),
						"timeline",
					),
				),
			),
			section(
				{ class: card },
				h3({ class: title }, "State"),
				pre(
					{ class: "max-h-96 overflow-auto rounded bg-base-200 p-3 text-xs" },
					field("stateJson"),
				),
			),
		),
	),
	on: {
		op: {
			args: [t.enum("reset", "back", "forward", "toEnd")],
			emits: { ask: ["story"] },
			run(_draft, [op], ctx) {
				ctx.ask("story", [this.appKey, op]);
			},
		},
		gotoEntry: {
			args: [t.index("timeline")],
			emits: { ask: ["story"] },
			run(_draft, [i], ctx) {
				ctx.ask("story", [this.appKey, "goto", i]);
			},
		},
		selectSequence: {
			args: [t.string()],
			emits: { ask: ["story"] },
			run(_draft, [name], ctx) {
				ctx.ask("story", [this.appKey, "load", name]);
			},
		},
		setTarget: {
			args: [t.string()],
			run(draft, [value]) {
				draft.target = Math.max(0, Number.parseInt(value, 10) || 0);
				syncForm(draft);
			},
		},
		setMessage: {
			args: [t.string()],
			run(draft, [value]) {
				draft.message = value;
				syncForm(draft);
			},
		},
		setSourceKey: {
			args: [t.string()],
			run(draft, [value]) {
				draft.sourceKey = value;
			},
		},
		setArgs: {
			args: [t.string()],
			run(draft, [value]) {
				draft.argsJson = value;
			},
		},
		generateArgs: {
			args: [],
			emits: { ask: ["story"] },
			run(draft, _args, ctx) {
				draft.argSeed = this.argSeed + 1;
				ctx.ask("story", [this.appKey, "sampleArgs", this.target, this.message, this.argSeed]);
			},
		},
		sendMessage: {
			args: [],
			emits: { ask: ["story"] },
			run(_draft, _args, ctx) {
				const { appKey, target, message, argsJson, sourceKey } = this;
				ctx.ask("story", [appKey, "sendTo", target, message, argsJson, sourceKey]);
			},
		},
		randomStep: {
			args: [],
			emits: { ask: ["story"] },
			run(draft, _args, ctx) {
				draft.argSeed = this.argSeed + 1;
				ctx.ask("story", [this.appKey, "randomStep", this.argSeed]);
			},
		},
		togglePlay: {
			args: [],
			emits: { ask: ["delay"] },
			run(draft, _args, ctx) {
				draft.isPlaying = !this.isPlaying;
				if (draft.isPlaying) ctx.ask("delay", [400]);
			},
		},
		delayReplyOk(draft, _args, ctx) {
			if (!this.isPlaying) return;
			if (this.atEnd) {
				draft.isPlaying = false;
				return;
			}
			ctx.ask("story", [this.appKey, "forward"]);
			ctx.ask("delay", [400]);
		},
		delayReplyError(draft) {
			draft.isPlaying = false;
		},
		delayHandlerNotFound(draft) {
			draft.isPlaying = false;
		},
		storyReplyOk(draft, [result]) {
			draft.error = "";
			if (typeof result?.argsJson === "string") draft.argsJson = result.argsJson;
			// forward returns false at a failing or missing step: stop playing there.
			if (result === false) draft.isPlaying = false;
		},
		storyReplyError(draft, [error]) {
			draft.error = String(error?.message ?? error);
			draft.problems = [draft.error];
			draft.isPlaying = false;
		},
		storyHandlerNotFound(draft) {
			draft.problems = ["no story ask handler is registered"];
		},
	},
});

export const StressPanel = component({
	name: "StressPanel",
	fields: (t) => ({
		appKey: t.string(),
		numRuns: t.number(100).int().min(1).max(100000),
		maxCommands: t.number(20).int().min(1).max(1000),
		seed: t.number(1).int(),
		from: t.enum("story", "generated", "current"),
		events: t.boolean(),
		status: t.enum("idle", "running", "passed", "failed", "cancelled", "unavailable"),
		done: t.number().int().min(0),
		total: t.number().int().min(0),
		error: t.string(),
		commands: t.array(t.string()),
	}),
	methods: {
		get isRunning() {
			return this.status === "running";
		},
		get isFailed() {
			return this.status === "failed";
		},
		get progressMax() {
			return Math.max(1, this.total);
		},
	},
	view: section(
		{ class: card },
		div(
			{ class: "grid grid-cols-2 gap-3 sm:grid-cols-5" },
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Runs",
				input({
					type: "number",
					class: "input input-sm input-bordered",
					value: field("numRuns"),
					"@on.input": send("setNumber", "numRuns", targetValue()),
				}),
			),
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Max steps per run",
				input({
					type: "number",
					class: "input input-sm input-bordered",
					value: field("maxCommands"),
					"@on.input": send("setNumber", "maxCommands", targetValue()),
				}),
			),
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Seed",
				input({
					type: "number",
					class: "input input-sm input-bordered",
					value: field("seed"),
					"@on.input": send("setNumber", "seed", targetValue()),
				}),
			),
			label(
				{ class: "flex flex-col gap-1 text-xs" },
				"Start from",
				select(
					{
						class: "select select-sm select-bordered",
						value: field("from"),
						"@on.change": send("setFrom", targetValue()),
					},
					option({ value: "story" }, "story state"),
					option({ value: "generated" }, "generated states"),
					option({ value: "current" }, "current state"),
				),
			),
			label(
				{ class: "flex items-center gap-2 self-end pb-2 text-xs" },
				input({
					type: "checkbox",
					class: "checkbox checkbox-sm",
					checked: field("events"),
					"@on.change": send("setEvents", targetValue()),
				}),
				"DOM events",
			),
		),
		div(
			{ class: "flex flex-wrap items-center gap-3" },
			button$(
				{ class: "btn btn-sm btn-primary", disabled: field("isRunning"), "@on.click": send("run") },
				"Run stress test",
			),
			$if(field("isRunning"), button$({ "@on.click": send("cancel") }, "Cancel"), ""),
			span({ class: "badge" }, field("status")),
			span(
				{ class: "text-xs text-base-content/60" },
				field("done"),
				" / ",
				field("total"),
				" runs",
			),
		),
		tag.progress({
			class: "progress progress-primary w-full",
			value: field("done"),
			max: field("progressMax"),
		}),
		$if(
			field("error"),
			pre(
				{ class: "whitespace-pre-wrap rounded bg-error/10 p-3 text-xs text-error" },
				field("error"),
			),
			"",
		),
		$if(
			field("isFailed"),
			div(
				{ class: "flex flex-col gap-2" },
				h3({ class: title }, "Shrunk counterexample"),
				ol(
					{ class: "list-decimal pl-6 font-mono text-xs" },
					each(field("commands"), li(lookupBind("value"))),
				),
				button$(
					{ class: "btn btn-sm btn-secondary self-start", "@on.click": send("load") },
					"Load into stepper",
				),
			),
			"",
		),
	),
	on: {
		setNumber: {
			args: [t.enum("numRuns", "maxCommands", "seed"), t.string()],
			run(draft, [name, value]) {
				const n = Number.parseInt(value, 10);
				if (!Number.isFinite(n)) return;
				const type = StressPanel.fields[name];
				if (type.isValid(n)) draft[name] = n;
			},
		},
		setFrom: {
			args: [t.enum("story", "generated", "current")],
			run(draft, [from]) {
				draft.from = from;
			},
		},
		setEvents: {
			args: [t.boolean()],
			run(draft, [events]) {
				draft.events = events;
			},
		},
		run: {
			args: [],
			emits: { ask: ["story"] },
			run(draft, _args, ctx) {
				if (this.isRunning) return;
				Object.assign(draft, { ...STRESS_IDLE, status: "running", total: this.numRuns });
				const { numRuns, maxCommands, seed, from, events } = this;
				ctx.ask("story", [this.appKey, "stress", { numRuns, maxCommands, seed, from, events }]);
			},
		},
		cancel: {
			args: [],
			emits: { ask: ["story"] },
			run(_draft, _args, ctx) {
				ctx.ask("story", [this.appKey, "cancelStress"]);
			},
		},
		load: {
			args: [],
			emits: { ask: ["story"], notify: ["showSteps"] },
			run(_draft, _args, ctx) {
				ctx.ask("story", [this.appKey, "loadCounterexample"]);
				ctx.notify("showSteps");
			},
		},
		storyReplyOk(draft, [result]) {
			if (typeof result?.status === "string") applyStress(draft, result);
		},
		storyReplyError(draft, [error]) {
			Object.assign(draft, { ...STRESS_IDLE, status: "unavailable" });
			draft.error = String(error?.message ?? error);
		},
		storyHandlerNotFound(draft) {
			draft.status = "unavailable";
		},
	},
});
const applyStress = (draft, { status, done = 0, total = 0, error = "", commands = [] }) =>
	Object.assign(draft, { status, done, total, error, commands: [...commands] });

export const Storybook = component({
	name: "Storybook",
	fields: (t) => ({
		links: t.array(t.component("StoryLink")),
		filterText: t.string(),
		collapsed: t.array(t.string()), // Groups whose stories are hidden.
		selectedId: t.string(),
		isGenerated: t.boolean(),
		seed: t.number().int().min(0),
		panel: t.enum("steps", "stress", "dev"),
		story: t.component("StoryPanel"),
		stress: t.component("StressPanel"),
		dev: t.component("DevPanel"),
	}),
	methods: {
		get appKey() {
			return `${this.selectedId}@${this.seed}`;
		},
		get hasStory() {
			return this.selectedId !== "";
		},
		get isSteps() {
			return this.panel === "steps";
		},
		get isStress() {
			return this.panel === "stress";
		},
		get isDev() {
			return this.panel === "dev";
		},
	},
	loops: {
		// Collapsed groups keep their header, on their first link.
		links: {
			filter(_index, link) {
				return link.matches(this.filterText) && (link.showGroup || !link.isCollapsed);
			},
		},
	},
	// The sidebar and the story scroll on their own, so a long list keeps the story in view.
	view: div(
		{
			class:
				"grid min-h-screen grid-cols-1 bg-base-200 text-base-content md:h-screen md:grid-cols-[16rem_1fr] md:overflow-hidden",
		},
		aside(
			{ class: "flex flex-col gap-3 border-r border-base-300 bg-base-100 p-4 md:overflow-y-auto" },
			h1({ class: "text-lg font-bold" }, "Tutuca Storybook"),
			input({
				class: "input input-sm input-bordered w-full",
				placeholder: "Filter stories…",
				"aria-label": "Filter stories",
				value: field("filterText"),
				"@on.input": send("setFilterText", targetValue()),
			}),
			ul({ class: "flex flex-col gap-1" }, renderEach(field("links"), "links")),
		),
		main(
			{ class: "flex min-w-0 flex-col gap-4 p-4 md:overflow-y-auto", "data-story-main": "" },
			$if(
				field("hasStory"),
				div(
					{ class: "flex flex-col gap-4" },
					div(
						{ class: "flex flex-wrap items-center gap-3" },
						h2({ class: "text-xl font-bold" }, field("selectedId")),
						$if(
							field("isGenerated"),
							div(
								{ class: "flex items-center gap-2" },
								span({ class: "badge badge-outline" }, "seed ", field("seed")),
								button$({ "@on.click": send("reroll") }, "Reroll"),
							),
							"",
						),
					),
					section(
						{ class: "card border border-base-300 bg-base-100 p-4 shadow-sm" },
						tutucaApp({
							class: "block",
							"app-key": field("appKey"),
							"@on.tutucareport": send("appReport"),
						}),
					),
					div(
						{ role: "tablist", class: "tabs tabs-box self-start" },
						button(
							{
								type: "button",
								role: "tab",
								class: $if(field("isSteps"), "tab tab-active", "tab"),
								"@on.click": send("setPanel", "steps"),
							},
							"Steps",
						),
						button(
							{
								type: "button",
								role: "tab",
								class: $if(field("isStress"), "tab tab-active", "tab"),
								"@on.click": send("setPanel", "stress"),
							},
							"Stress test",
						),
						button(
							{
								type: "button",
								role: "tab",
								class: $if(field("isDev"), "tab tab-active", "tab"),
								"@on.click": send("setPanel", "dev"),
							},
							"Dev",
						),
					),
					$if(
						field("isSteps"),
						render(field("story")),
						$if(field("isStress"), render(field("stress")), render(field("dev"))),
					),
				),
				p({ class: "text-base-content/60" }, "Pick a story."),
			),
		),
	),
	on: {
		setFilterText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.filterText = text;
				syncCollapsed(draft);
			},
		},
		groupToggled: {
			args: [t.string()],
			run(draft, [group], ctx) {
				ctx.stopNext();
				const { collapsed } = this;
				draft.collapsed = collapsed.includes(group)
					? collapsed.filter((g) => g !== group)
					: [...collapsed, group];
				syncCollapsed(draft);
			},
		},
		// Shows the new story from its top, wherever the list was scrolled to.
		storySelected: {
			args: [t.string()],
			emits: { ask: ["scrollToTop"] },
			run(draft, [id], ctx) {
				selectStory(this, draft, id);
				ctx.stopNext();
				ctx.ask("scrollToTop");
			},
		},
		scrollToTopReplyOk() {},
		scrollToTopReplyError() {},
		scrollToTopHandlerNotFound() {},
		setPanel: {
			args: [t.enum("steps", "stress", "dev")],
			run(draft, [panel]) {
				draft.panel = panel;
			},
		},
		showSteps(draft, _args, ctx) {
			draft.panel = "steps";
			ctx.stopNext();
		},
		reroll(draft) {
			draft.seed = this.seed + 1;
			resetPanels(this, draft, `${this.selectedId}@${this.seed + 1}`);
		},
		// Reports from the story's <tutuca-app>; only events carry them.
		appReport(draft, _args, ctx) {
			const detail = ctx.event?.detail;
			if (detail?.key !== this.appKey) return;
			if (detail.type === "state" && draft.story.appKey === detail.key) {
				for (const key of SUMMARY_KEYS) draft.story[key] = detail.data[key];
				syncForm(draft.story);
				if (detail.data.dev) updateDevPanel(scopeOf(this).components, draft.dev, detail.data.dev);
			} else if (detail.type === "stress" && draft.stress.status === "running") {
				applyStress(draft.stress, detail.data);
			}
		},
	},
});
const resetPanels = (self, draft, appKey) => {
	const C = scopeOf(self).components;
	draft.story = C.StoryPanel({ appKey });
	draft.stress = C.StressPanel({ appKey });
	draft.dev = makeDevPanel(C);
};
// A filter shows every match, collapsed or not.
const syncCollapsed = (draft) => {
	const filtering = draft.filterText.trim() !== "";
	for (const link of draft.links)
		link.isCollapsed = !filtering && draft.collapsed.includes(link.group);
};
const selectStory = (self, draft, id) => {
	const link = self.links.find((l) => l.id === id);
	if (link === undefined) return;
	draft.selectedId = id;
	draft.isGenerated = link.isGenerated;
	draft.links.forEach((l, i) => {
		l.isSelected = self.links[i].id === id;
	});
	resetPanels(self, draft, `${id}@${self.seed}`);
};

export const storybookComponents = {
	Storybook,
	StoryLink,
	StoryPanel,
	StressPanel,
	...devComponents,
};

export const storybookClasses = () =>
	classNamesOf(Object.values(storybookComponents), [...Object.values(BADGES), ...devClasses]);

// The storybook root for books, with initialId selected when it names a story.
export const makeStorybook = (C, books, initialId = "") => {
	const links = books.flatMap((book) =>
		book.stories.map((story, i) =>
			C.StoryLink({
				id: story.id,
				group: book.title,
				name: story.name,
				showGroup: i === 0,
				groupSize: book.stories.length,
				isGenerated: story.arbitrary !== undefined,
				isSelected: story.id === initialId,
			}),
		),
	);
	const selected = links.find((l) => l.isSelected);
	const appKey = `${selected?.id ?? ""}@0`;
	return C.Storybook({
		links,
		selectedId: selected?.id ?? "",
		isGenerated: selected?.isGenerated ?? false,
		story: C.StoryPanel({ appKey }),
		stress: C.StressPanel({ appKey }),
		dev: makeDevPanel(C),
	});
};

// Starts the storybook UI on rootNode. css and links style the stories' shadow roots.
export const startStorybook = ({
	document,
	rootNode,
	fc,
	books,
	css = "",
	links = [],
	compile = null,
	known = [],
	initialId = "",
	dev = true,
}) => {
	defineTutucaApp(document.defaultView);
	const registry = new StoryRegistry({ fc, books, css, links, compile, known });
	rootNode.addEventListener(REQUEST, (e) => registry.mount(e.detail));
	const host = new Host({ document, rootNode, dev });
	host.scope.register(storybookComponents);
	host.scope.registerAskHandlers({
		story: ([key, op, ...args]) => registry.call(key, op, args),
		delay: ([ms]) => new Promise((resolve) => setTimeout(resolve, ms)),
		scrollToTop: () => {
			for (const node of [rootNode.querySelector("[data-story-main]"), document.scrollingElement]) {
				if (node) node.scrollTop = 0;
			}
		},
	});
	host.start(makeStorybook(host.scope.components, books, initialId));
	return { host, registry };
};

// Stories without a UI: books of stories, their sequences of steps and stress tests, run on a
// headless Driver. fast-check is passed in, as in pbt.js.

import {
	arbitraries,
	Driver,
	describeProblems,
	dispatchOn,
	eventCommands,
	messageCommands,
	runCommands,
} from "../test/pbt.js";
import { DispatchPath, Scope, selectorFrom, specOf } from "../tutuca.js";

export const json = (v) => {
	try {
		return JSON.stringify(v) ?? String(v);
	} catch {
		return String(v);
	}
};
export const clip = (text, max = 80) => (text.length > max ? `${text.slice(0, max)}…` : text);
export const argsLabel = (args) => clip(args.map(json).join(", "));

// Steps of a sequence, as plain data. at and from are PathBuilder functions relative to
// the story root, as in ctx.sendAt; from is the child the message comes through.
export const step = {
	send: (name, args = [], { at, from, label } = {}) => ({
		kind: "send",
		name,
		args,
		at,
		from,
		label: label ?? `${at ? selectorFrom(at) : "·"}.${name}(${argsLabel(args)})`,
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
export const stepText = (s) => s.label ?? (s.kind === "command" ? String(s.cmd) : s.kind);

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

// Runs one step on driver: { status: "ok" | "failed" | "skipped", error, problems }.
export const runStep = (driver, s) => {
	const before = driver.reports.length;
	const done = (status, error = "") => {
		const problems = describeProblems(driver.problemsSince(before));
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

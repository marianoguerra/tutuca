// Stories without a UI: books of stories, their sequences of steps and stress tests, run on a
// headless Driver. fast-check is passed in, as in pbt.js.

import { argsLabel } from "../core/host/text.js";
import { Driver, describeProblems } from "../testing/driver.js";
import { arbitraries, eventCommands, messageCommands, runCommands } from "../testing/pbt.js";
import { DispatchPath, errorMessage, Scope, selectorFrom, specOf } from "../tutuca.js";

// Where a step's to and from say: a selector fn is run; anything else (a DispatchPath, frames)
// is as Driver.send takes it. The root and no child, without one.
const whereOf = (where, none) =>
	where === undefined ? none : typeof where === "function" ? selectorFrom(where) : where;
const toOf = (to) => whereOf(to, new DispatchPath());
const toText = (to) => (to === undefined ? "·" : String(toOf(to)));
// Steps of a sequence, as plain data. to and from are selector functions relative to
// the story root, as in ctx.sendAt (or what they'd write, as Driver.send takes it); from is the
// child the message comes through.
export const step = {
	send: (name, args = [], { to, from, label } = {}) => ({
		kind: "send",
		name,
		args,
		to,
		from,
		label: label ?? `${toText(to)}.${name}(${argsLabel(args)})`,
	}),
	// value, when given, is set on the form field first, as targetValue() reads it.
	event: (type, selector, { value, label } = {}) => ({
		kind: "event",
		type,
		selector,
		value,
		label: label ?? `${type} on ${selector}`,
	}),
	// Drags the element from matches and drops it on the one to matches.
	drag: (from, to, { label } = {}) => ({
		kind: "drag",
		from,
		to,
		label: label ?? `drag ${from} onto ${to}`,
	}),
	// The answer to an ask, delivered to the component at to (the root without one): for its
	// answers[ask][outcome], with value as the answer's argument (none for unhandled).
	answer: (ask, outcome, value, { to, label } = {}) => {
		const args = outcome === "unhandled" ? [] : [value];
		const text = label ?? `${toText(to)} ← ${ask}.${outcome}(${argsLabel(args)})`;
		return { kind: "answer", ask, outcome, args, to, label: text };
	},
	check: (label, pred) => ({ kind: "check", label, pred }),
	// A MessageCommand or EventCommand from pbt.js.
	command: (cmd, label) => ({ kind: "command", cmd, label }),
};
export const stepText = (s) => s.label ?? (s.kind === "command" ? String(s.cmd) : s.kind);

// A book of stories. Each story has make(C) or arbitrary(A) for its initial state, and
// optionally sequences ({ name: steps }) and stress ({ include, exclude, afterEach,
// maxCommands, numRuns, events }) for its stress test. components and askHandlers are
// registered in each story's scope; overrides go to arbitraries.
export const book = ({ title, components, askHandlers = {}, overrides = {}, stories }) => {
	const made = { title, components, askHandlers, overrides, stories: [] };
	for (const [name, story] of Object.entries(stories)) {
		const id = `${title}/${name}`;
		if ((story.make === undefined) === (story.arbitrary === undefined)) {
			throw new Error(`story ${id} needs one of make or arbitrary`);
		}
		made.stories.push({ sequences: {}, stress: null, ...story, id, name, book: made });
	}
	return made;
};

// A story's scope, arbitraries and initial state; seed picks the state of arbitrary stories.
export const prepareStory = (story, { fc, seed = 0 }) => {
	const { components, askHandlers, overrides } = story.book;
	const scope = new Scope();
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
			case "send":
				driver.send(s.name, s.args, { to: toOf(s.to), from: whereOf(s.from, []) });
				break;
			case "answer":
				driver.answer(s.ask, s.outcome, s.args, { to: toOf(s.to) });
				break;
			case "event": {
				if (typeof driver.rootNode.querySelector !== "function") {
					return done("failed", "event steps need a document");
				}
				const el = driver.rootNode.querySelector(s.selector);
				if (el === null) return done("skipped", `nothing matches ${s.selector}`);
				driver.fire(s.type, el, { value: s.value });
				break;
			}
			case "drag": {
				if (typeof driver.rootNode.querySelector !== "function") {
					return done("failed", "drag steps need a document");
				}
				const [from, to] = [s.from, s.to].map((sel) => driver.rootNode.querySelector(sel));
				if (from === null || to === null) {
					return done("skipped", `nothing matches ${from === null ? s.from : s.to}`);
				}
				driver.drag(from, to);
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
		return done("failed", errorMessage(error));
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
// A stress run's settings: story.stress says numRuns, maxCommands and events, the rest and
// what it leaves out are STRESS_DEFAULTS.
export const STRESS_DEFAULTS = {
	numRuns: 50,
	maxCommands: 20,
	seed: 1,
	from: "story",
	events: false,
};
export const stressSettings = (story) => {
	const settings = { ...STRESS_DEFAULTS };
	for (const key of ["numRuns", "maxCommands", "events"]) {
		if (story.stress?.[key] !== undefined) settings[key] = story.stress[key];
	}
	return settings;
};
// onRun(ops, error), when given, is called after each run with the text of the commands
// that ran and the error that failed it, or null.
export const stressProperty = (
	story,
	{
		fc,
		A,
		root,
		from = STRESS_DEFAULTS.from,
		events = stressSettings(story).events,
		maxCommands = stressSettings(story).maxCommands,
		document = null,
		onRun = null,
	},
) => {
	if (events && document === null) throw new Error("event stress tests need a document");
	const roots = from === "generated" ? A.instance(specOf(root)) : fc.constant(root);
	const cmds = events
		? eventCommands(A, { maxCommands })
		: messageCommands(A, { ...story.stress, maxCommands });
	const options = events ? { document } : {};
	if (onRun === null) return fc.property(roots, cmds, (r, c) => runCommands(A, r, c, options));
	const ran = (c) => [...c].filter((w) => w.hasRan).map((w) => String(w.cmd));
	return fc.property(roots, cmds, (r, c) => {
		try {
			runCommands(A, r, c, options);
		} catch (error) {
			onRun(ran(c), error);
			throw error;
		}
		onRun(ran(c), null);
	});
};

// fc.assert of story's stress test, with its stress config.
export const stressStory = (story, { fc, document = null, numRuns, seed, ...options } = {}) => {
	const { A, root } = prepareStory(story, { fc });
	const property = stressProperty(story, { fc, A, root, document, ...options });
	fc.assert(property, { numRuns: numRuns ?? stressSettings(story).numRuns, seed });
};

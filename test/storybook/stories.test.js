import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import jsonBook from "../../components/json/stories.js";
import mathBook from "../../components/math/stories.js";
import { defineTutucaApp, REPORT, REQUEST } from "../../src/embed/element.js";
import {
	checkStory,
	prepareStory,
	StoryRegistry,
	step,
	stories,
	stressStory,
} from "../../src/storybook/index.js";
import { Driver, describeProblems } from "../../src/test/pbt.js";
import { component, field, h, send } from "../../src/tutuca.js";
import { books } from "../../storybook.books.js";
import { document, testLintsClean } from "../helpers.js";

const byName = (book, name) => book.stories.find((s) => s.name === name);

for (const book of books) testLintsClean(book.title, book.components, { errorsOnly: true });

for (const story of books.flatMap((book) => book.stories)) {
	test(`${story.id} starts valid and renders`, () => {
		const { root } = prepareStory(story, { fc });
		const driver = new Driver({ root, document });
		assert.deepEqual(describeProblems(driver.problems), []);
		assert.ok(driver.rootNode.childNodes.length > 0);
	});
	if (Object.keys(story.sequences).length > 0) {
		test(`${story.id} sequences pass`, () => checkStory(story, { fc, document }));
	}
	if (story.pbt !== null) {
		test(`${story.id} stress test passes`, () =>
			stressStory(story, { fc, document, numRuns: 20, seed: 1 }));
	}
}

// count turns into a string once it is positive: a schema break stress tests find.
const Counter = component({
	name: "Counter",
	fields: (t) => ({ count: t.number() }),
	view: h("button", { "@on.click": send("inc") }, field("count")),
	on: {
		inc: {
			args: [],
			run(draft) {
				draft.count = draft.count > 1 ? "many" : draft.count + 1;
			},
		},
		dec: {
			args: [],
			run(draft) {
				draft.count -= 1;
			},
		},
	},
});
const counterBook = stories({
	title: "Bugs",
	components: { Counter },
	stories: {
		Counter: {
			make: (C) => C.Counter(),
			sequences: {
				"up once": [step.send("inc"), step.check("one", (s) => s.count === 1)],
				"wrong check": [step.send("inc"), step.check("two", (s) => s.count === 2)],
				"missing element": [step.event("click", "a")],
			},
			pbt: { maxCommands: 6 },
		},
	},
});
const counterStory = counterBook.stories[0];

test("checkStory names the step that fails", () => {
	assert.throws(
		() => checkStory(counterStory, { fc, document }),
		/Bugs\/Counter › wrong check › 2\. two: failed check failed: two/,
	);
});

test("stressStory finds the schema break", () => {
	assert.throws(
		() => stressStory(counterStory, { fc, numRuns: 100, seed: 1 }),
		(error) => /stateInvalid: Counter count invalid/.test(error.cause?.message),
	);
});

// A page with a <tutuca-app> answered by a registry, recording the summaries it publishes.
const mountStory = (story, key = `${story.id}@0`) => {
	const { window } = new JSDOM("<body></body>");
	defineTutucaApp(window);
	const registry = new StoryRegistry({ fc, books: [story.book] });
	const { body } = window.document;
	body.addEventListener(REQUEST, (e) => registry.mount(e.detail));
	const reports = [];
	body.addEventListener(REPORT, (e) => reports.push(e.detail));
	const element = window.document.createElement("tutuca-app");
	element.setAttribute("app-key", key);
	body.append(element);
	const runner = element.controller;
	const last = async (type = "state") => {
		await Promise.resolve();
		return reports.findLast((r) => r.type === type)?.data;
	};
	return { window, element, runner, registry, reports, last };
};

test("a runner steps through a sequence, back and forth", async () => {
	const { runner, element, last } = mountStory(byName(jsonBook, "Bool (edit)"));
	let summary = await last();
	assert.deepEqual(summary.sequences, ["toggle"]);
	assert.deepEqual(
		summary.steps.map((s) => s.status),
		["pending", "pending", "pending", "pending"],
	);
	runner.forward();
	runner.forward();
	summary = await last();
	assert.equal(summary.cursor, 2);
	assert.deepEqual(
		summary.steps.map((s) => [s.status, s.isNext]),
		[
			["ok", false],
			["ok", false],
			["pending", true],
			["pending", false],
		],
	);
	runner.back();
	assert.equal(runner.driver.state.toJson(), true);
	runner.goto(0);
	assert.equal(runner.driver.state.toJson(), false);
	// The canvas follows the timeline.
	assert.equal(
		element.shadowRoot.querySelector('[aria-label="boolean value"]').textContent,
		"false",
	);
	runner.toEnd();
	summary = await last();
	assert.deepEqual(
		summary.steps.map((s) => s.status),
		["ok", "ok", "ok", "ok"],
	);
	assert.equal(summary.timeline.length, 5);
});

test("user interaction in the canvas becomes a timeline entry", async () => {
	const { window, element, runner, last } = mountStory(byName(jsonBook, "Bool (edit)"));
	const button = element.shadowRoot.querySelector('[aria-label="boolean value"]');
	button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await Promise.resolve();
	const summary = await last();
	assert.deepEqual(
		summary.timeline.map((e) => [e.origin, e.label]),
		[
			["initial", "initial"],
			["user", "click → toggle()"],
		],
	);
	assert.equal(runner.driver.state.toJson(), true);
	assert.match(summary.stateJson, /"value": true/);
	assert.deepEqual(summary.changes, ["set value.value to true"]);
});

test("single steps: send to a target, generate args, random step", async () => {
	const { runner, last } = mountStory(byName(mathBook, "Quadratic/Two roots"));
	let summary = await last();
	const rootIndex = summary.targets.findIndex((t) => t.label === "Quadratic at ·");
	const root = summary.targets[rootIndex];
	assert.deepEqual(root.messages.find((m) => m.name === "setCoefficient").sourceKeys, []);
	runner.sendTo(rootIndex, "setCoefficient", '["b", "-2"]', "");
	assert.equal(runner.driver.state.b, -2);
	const { argsJson } = runner.sampleArgs(rootIndex, "setCoefficient", 3);
	assert.match(argsJson, /^\[".*\]$/);
	runner.randomStep(5);
	summary = await last();
	assert.equal(summary.timeline.length, 3);
	assert.equal(summary.timeline[2].origin, "step");
	assert.throws(() => runner.sendTo(rootIndex, "setCoefficient", "{}", ""), /JSON array/);
});

test("stress finds a counterexample that replays in the stepper", async () => {
	const { runner, last } = mountStory(counterStory);
	const result = await runner.stress({ numRuns: 100, maxCommands: 6, seed: 1 });
	assert.equal(result.status, "failed");
	assert.match(result.error, /stateInvalid: Counter count invalid/);
	assert.ok(result.commands.length > 0);
	assert.match(result.log[0], /^run 1, \d+ ops, (ok|failed)/);
	assert.match(result.log.at(-2) ?? "", /^ {2}\d+\. Counter/);
	assert.match(result.log.at(-1), /^shrunk to \d+ ops in \d+ attempts$/);
	assert.ok(result.log.some((l) => /, failed: .*Counter count invalid/.test(l)));
	assert.ok((await last()).sequences.includes("counterexample"));
	runner.load("counterexample");
	runner.toEnd();
	const summary = await last();
	assert.equal(summary.sequence, "counterexample");
	assert.equal(summary.steps.at(-1).status, "failed");
	assert.match(summary.problems.join("\n"), /Counter count invalid/);
});

test("stress can be cancelled and reports progress", async () => {
	const { runner, reports } = mountStory(byName(mathBook, "Quadratic/Two roots"));
	const running = runner.stress({ numRuns: 1000, maxCommands: 4, seed: 1 });
	await new Promise((resolve) => setTimeout(resolve, 5));
	runner.cancelStress();
	const result = await running;
	assert.equal(result.status, "cancelled");
	assert.ok(reports.some((r) => r.type === "stress" && r.data.done > 0));
	assert.ok(result.log.some((l) => /^run \d+, \d+ ops, ok$/.test(l)));
});

test("a generated story is sampled with the seed in its key", () => {
	const story = byName(mathBook, "Quadratic/Generated");
	const a = mountStory(story, `${story.id}@3`).runner.driver.state;
	const b = mountStory(story, `${story.id}@3`).runner.driver.state;
	assert.deepEqual([a.a, a.b, a.c], [b.a, b.b, b.c]);
});

test("removing the element disposes the runner", async () => {
	const { element, registry } = mountStory(counterStory);
	assert.equal(registry.runners.size, 1);
	element.remove();
	await Promise.resolve();
	assert.equal(registry.runners.size, 0);
});

test("classes stories compute at render compile into their shadow roots", async () => {
	const { window } = new JSDOM("<body></body>");
	defineTutucaApp(window);
	const compiled = [];
	const compile = (classes) => {
		compiled.push(classes);
		return Promise.resolve(classes.map((c) => `.${c}{}`).join(""));
	};
	const registry = new StoryRegistry({ fc, books: [jsonBook], compile, known: ["btn"] });
	window.document.body.addEventListener(REQUEST, (e) => registry.mount(e.detail));
	const element = window.document.createElement("tutuca-app");
	element.setAttribute("app-key", "JSON/Document@0");
	window.document.body.append(element);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const style = element.shadowRoot.querySelector("style");
	assert.match(style.textContent, /\.btn-primary\{\}/);
	assert.ok(!compiled.at(-1).includes("decoration-dashed"));
	// Edit mode renders the value's edit view, with classes the view mode never showed.
	element.shadowRoot.querySelector("button:nth-of-type(2)").click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.match(style.textContent, /\.decoration-dashed\{\}/);
});

test("a new registry carries each mounted story's state over to the new components", async () => {
	const { window } = new JSDOM("<body></body>");
	defineTutucaApp(window);
	let registry = new StoryRegistry({ fc, books: [counterBook], prefix: "r1/" });
	const { body } = window.document;
	body.addEventListener(REQUEST, (e) => registry.mount(e.detail));
	const reports = [];
	body.addEventListener(REPORT, (e) => reports.push(e.detail));
	const element = window.document.createElement("tutuca-app");
	element.setAttribute("app-key", `r1/${counterStory.id}@0`);
	body.append(element);
	element.controller.forward();
	assert.equal(element.controller.driver.state.count, 1);
	// The next version: a new field, and an invariant the carried count breaks.
	const Counter2 = component({
		name: "Counter",
		fields: (t) => ({ count: t.number(), label: t.string("clicks") }),
		view: h("button", {}, field("label")),
		invariants: {
			belowOne() {
				return this.count < 1;
			},
		},
	});
	const book2 = stories({
		title: "Bugs",
		components: { Counter: Counter2 },
		stories: { Counter: { make: (C) => C.Counter(), sequences: counterStory.sequences } },
	});
	const carried = registry.carriable();
	registry = new StoryRegistry({ fc, books: [book2], prefix: "r2/", carried });
	element.setAttribute("app-key", `r2/${counterStory.id}@0`);
	const runner = element.controller;
	assert.equal(runner.driver.state.count, 1);
	assert.equal(runner.driver.state.label, "clicks");
	await Promise.resolve();
	const summary = reports.findLast((r) => r.type === "state").data;
	assert.deepEqual(summary.timeline[0], {
		label: "hot reload",
		origin: "reload",
		problemCount: 1,
		isCurrent: true,
	});
	assert.deepEqual(summary.reload, [
		'Counter.label added: string = "clicks"',
		"/label added, at its default",
	]);
	assert.deepEqual(summary.problems, ["stateInvalid: Counter  invariant:belowOne"]);
	assert.equal(runner.nextStep, 1); // Where the sequence was.
	// Mounting the story again starts it fresh.
	element.setAttribute("app-key", `r2/${counterStory.id}@1`);
	assert.equal(element.controller.driver.state.count, 0);
});

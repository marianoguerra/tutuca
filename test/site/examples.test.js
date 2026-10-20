// The landing page's examples: they import tutuca by name, as an app would.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import fc from "fast-check";
import { lint } from "../../src/lint/index.js";
import { checkStory, prepareStory } from "../../src/storybook/index.js";
import { Driver, describeProblems } from "../../src/test/pbt.js";
import { document, testLintsClean } from "../helpers.js";

// Node can't import from a CDN: the web component example's picker loads as an empty module.
registerHooks({
	load: (url, context, nextLoad) =>
		url.startsWith("https:")
			? { format: "module", source: "", shortCircuit: true }
			: nextLoad(url, context),
});

const books = {
	counter: (await import("../../site/examples/counter.js")).default,
	"todo-list": (await import("../../site/examples/todo-list.js")).default,
	composed: (await import("../../site/examples/composed.js")).default,
	async: (await import("../../site/examples/async.js")).default,
	"web-component": (await import("../../site/examples/web-component.js")).default,
	"drag-and-drop": (await import("../../site/examples/drag-and-drop.js")).default,
};
const mistakes = (await import("../../site/examples/mistakes.js")).default;

for (const [name, book] of Object.entries(books)) {
	testLintsClean(name, book.components);
	for (const story of book.stories) {
		test(`${story.id} starts valid and its sequences pass`, () => {
			const { root } = prepareStory(story, { fc });
			assert.deepEqual(describeProblems(new Driver({ root, document }).problems), []);
			checkStory(story, { fc, document });
		});
	}
}

test("the mistakes example has exactly the three mistakes it describes", () => {
	const { components } = mistakes;
	assert.deepEqual(
		lint(Object.values(components), Object.keys(components)).map((issue) => issue.code),
		["unknown-field", "send-arity", "unknown-handler"],
	);
});

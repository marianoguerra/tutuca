// The micro-agents storybook's stories start valid, render and pass their sequences, as the
// main storybook's do (test/storybook/stories.test.js).
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { books } from "../../apps/microagents/storybook.books.js";
import { checkStory, prepareStory, stressStory } from "../../src/storybook/index.js";
import { Driver, describeProblems } from "../../src/test/pbt.js";
import { document, testLintsClean } from "../helpers.js";

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

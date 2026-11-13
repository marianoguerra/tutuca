// The landing page's examples: they import tutuca by name, as an app would.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import fc from "fast-check";
import { lint } from "../../src/lint/index.js";
import { checkStory, prepareStory } from "../../src/storybook/index.js";
import { Driver, describeProblems } from "../../src/testing/driver.js";
import { document, testLintsClean, testRendersItsCode } from "../helpers.js";

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
	testRendersItsCode(book.components);
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

test("the counter and the todo list render the code that makes them and markdown about them", async () => {
	const { renderJs } = await import("../../src/jsast/index.js");
	const { renderMd } = await import("../../src/mdast/index.js");
	const { Counter } = await import("../../site/examples/counter.js");
	const { TodoList } = await import("../../site/examples/todo-list.js");
	assert.equal(renderJs(Counter.make({ count: 3 })), "C.Counter({\n  count: 3\n})");
	assert.equal(renderJs(Counter.make({ count: -2 })), "C.Counter({\n  count: -2\n})");
	assert.equal(renderJs(Counter.make({ count: -0 })), "C.Counter({\n  count: -0\n})");
	assert.equal(renderMd(Counter.make({ count: 3 })), "Count: **3**\n");
	const todo = TodoList.make({
		text: "draft",
		items: [
			{ title: "Read the guide", done: true },
			{ title: "Edit this example", done: false },
		],
	});
	assert.equal(
		renderJs(todo),
		[
			"C.TodoList({",
			'  text: "draft",',
			"  items: [{",
			'    title: "Read the guide",',
			"    done: true",
			"  }, {",
			'    title: "Edit this example",',
			"    done: false",
			"  }]",
			"})",
		].join("\n"),
	);
	assert.equal(
		renderMd(todo),
		"## Todo\n\n- [x] Read the guide\n- [ ] Edit this example\n\n1 left\n",
	);
	assert.equal(renderMd(TodoList.make()), "## Todo\n\nNothing to do.\n\n0 left\n");
});

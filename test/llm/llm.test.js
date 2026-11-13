// tutuca/llm: components whose renders.llmTools are the tools a model is given (called back
// into the component they were rendered in) and whose renders.llmContext is the markdown it's
// told, both following the state through When, Unless and Choose.
import assert from "node:assert/strict";
import test from "node:test";
import {
	Case,
	Choose,
	callLlmTool,
	formatValue,
	LlmError,
	llmContext,
	llmContextTarget,
	llmTools,
	llmToolsTarget,
	Otherwise,
	present,
	renderLlmContext,
	renderLlmTools,
	ToolCallError,
	toolArg,
	Unless,
	When,
} from "../../src/llm/index.js";
import {
	component,
	each,
	enableTargets,
	field,
	Host,
	lookupBind,
	render,
	renderEach,
	send,
	sourceKey,
	t,
} from "../../src/tutuca.js";

enableTargets(llmToolsTarget, llmContextTarget);

const { Tools, Tool, Str, Num, Int, Bool, Enum, Option, List } = llmTools;
const { Section, Text, Hint, Fact, Items, Item, Data, Strong, Code } = llmContext;

const fails = (fn, ...messages) => {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof LlmError, error);
		assert.deepEqual(error.issues, messages);
		return true;
	});
};

const Task = component({
	name: "Task",
	fields: { title: t.string(), done: t.boolean() },
	renders: {
		llmTools: Tool(
			"rename",
			send("rename", toolArg("title")),
			"Rename a task.",
			Str("title", "Its new title"),
		),
		llmContext: Section("Task", Fact("Title", field("title")), Fact("Done", field("done"))),
	},
	on: {
		rename(next, [title]) {
			next.title = title;
		},
	},
});

const Todo = component({
	name: "Todo",
	fields: {
		items: t.array(t.record({ title: t.string(), done: t.boolean() })),
		readOnly: t.boolean(),
	},
	queries: {
		get left() {
			return this.items.filter((item) => !item.done).length;
		},
	},
	renders: {
		llmTools: Tools(
			Unless(
				field("readOnly"),
				Tool(
					"add_task",
					send("add", toolArg("title"), toolArg("done")),
					"Add a task.",
					Str({ name: "title", minLength: 1 }, "What to do"),
					Bool({ name: "done", optional: true }, "Whether it's done already"),
				),
				When(
					field("items"),
					Tool(
						"toggle_task",
						send("toggle", toolArg("index")),
						"Mark a task done, or not done.",
						Enum(
							"index",
							"Which task.",
							each(field("items"), Option(lookupBind("key"), field("title"))),
						),
					),
				),
			),
		),
		llmContext: Section(
			"Todo",
			Fact("Left", field("left")),
			Fact("Read only", field("readOnly")),
			Items(
				{ max: 2, empty: "No tasks." },
				each(field("items"), Item({ done: field("done") }, field("title"))),
			),
			Choose(
				Case(field("readOnly"), Hint("The list can't be changed.")),
				Case({ test: field("left"), is: 0 }, Hint("Everything is done.")),
				Otherwise(Text(field("left"), " to go.")),
			),
		),
	},
	on: {
		add(next, [title, done = false]) {
			next.items.push({ title, done });
		},
		toggle(next, [i]) {
			next.items[i].done = !this.items[i].done;
		},
	},
});

const Board = component({
	name: "Board",
	fields: { name: t.string(), lead: t.component("Task"), tasks: t.array(t.component("Task")) },
	renders: {
		llmTools: Tools(
			Tool("rename_board", send("rename", toolArg("name")), "Rename the board.", Str("name")),
			render(field("lead")),
		),
		llmContext: Section("Board", Fact("Name", field("name")), render(field("lead"))),
	},
	on: {
		rename(next, [name]) {
			next.name = name;
		},
	},
});

const hostOf = (components, make) => {
	const host = new Host();
	const made = host.scope.register(components);
	host.start(make(made));
	return host;
};

test("a renders.llmTools renders the tools a model is given, by the state", () => {
	assert.deepEqual(renderLlmTools(Todo.make({ items: [] })), [
		{
			name: "add_task",
			description: "Add a task.",
			input_schema: {
				type: "object",
				properties: {
					title: { type: "string", minLength: 1, description: "What to do" },
					done: { type: "boolean", description: "Whether it's done already" },
				},
				additionalProperties: false,
				required: ["title"],
			},
		},
	]);
	const items = [
		{ title: "Buy milk", done: false },
		{ title: "Write docs", done: true },
	];
	const [, toggle] = renderLlmTools(Todo.make({ items }));
	assert.deepEqual(toggle, {
		name: "toggle_task",
		description: "Mark a task done, or not done.",
		input_schema: {
			type: "object",
			properties: {
				index: {
					type: "integer",
					enum: [0, 1],
					description: "Which task.\n- 0: Buy milk\n- 1: Write docs",
				},
			},
			additionalProperties: false,
			required: ["index"],
		},
	});
	assert.deepEqual(renderLlmTools(Todo.make({ items, readOnly: true })), []);
});

test("params: numbers, integers, enums by values, lists of a param", () => {
	const Form = component({
		name: "Form",
		renders: {
			llmTools: Tool(
				"fill",
				send("fill", toolArg("n")),
				Num({ name: "n", min: 0, max: 1 }),
				Int({ name: "k", optional: true, max: 9 }, "A digit"),
				Enum({ name: "size", values: ["s", "m"] }),
				List({ name: "tags", maxItems: 3 }, "Tags", Str({ maxLength: 8 })),
			),
		},
		on: { fill() {} },
	});
	assert.deepEqual(renderLlmTools(Form.make())[0].input_schema, {
		type: "object",
		properties: {
			n: { type: "number", minimum: 0, maximum: 1 },
			k: { type: "integer", maximum: 9, description: "A digit" },
			size: { type: "string", enum: ["s", "m"] },
			tags: {
				type: "array",
				items: { type: "string", maxLength: 8 },
				maxItems: 3,
				description: "Tags",
			},
		},
		additionalProperties: false,
		required: ["n", "size", "tags"],
	});
});

test("callLlmTool checks the input and sends the tool's send to its component", () => {
	const host = hostOf({ Todo }, (C) => C.Todo({ items: [{ title: "Buy milk", done: false }] }));
	const sent = callLlmTool(host, { name: "add_task", input: { title: "Write docs" } });
	assert.equal(sent.name, "add");
	assert.deepEqual(sent.args, ["Write docs", undefined]);
	callLlmTool(host, { name: "toggle_task", input: { index: 1 } });
	assert.deepEqual(host.root.items, [
		{ title: "Buy milk", done: false },
		{ title: "Write docs", done: true },
	]);
	assert.throws(
		() => callLlmTool(host, { name: "toggle_task", input: { index: 5, extra: 1 } }),
		(e) =>
			e instanceof ToolCallError &&
			assert.deepEqual(e.issues, [
				"index is one of 0, 1, not 5",
				"there's no extra (it takes index)",
			]) === undefined,
	);
	assert.throws(
		() => callLlmTool(host, { name: "add_task", input: { title: "" } }),
		(e) => assert.deepEqual(e.issues, ['title is at least 1 characters, not ""']) === undefined,
	);
	assert.throws(
		() => callLlmTool(host, { name: "add_task", input: {} }),
		(e) => assert.deepEqual(e.issues, ["title is required"]) === undefined,
	);
});

test("a tool that isn't offered now can't be called", () => {
	const host = hostOf({ Todo }, (C) => C.Todo({ readOnly: true }));
	assert.throws(
		() => callLlmTool(host, { name: "add_task", input: { title: "x" } }),
		(e) =>
			e instanceof ToolCallError &&
			assert.deepEqual(e.issues, ["there's no tool add_task now (the tools are none)"]) ===
				undefined,
	);
});

test("a child component's tools are its parent's, and their calls go to it", () => {
	const host = hostOf({ Board, Task }, (C) =>
		C.Board({ name: "Week", lead: C.Task({ title: "Plan" }) }),
	);
	assert.deepEqual(
		renderLlmTools(host.root).map((tool) => tool.name),
		["rename_board", "rename"],
	);
	callLlmTool(host, { name: "rename", input: { title: "Plan the week" } });
	assert.equal(host.root.lead.title, "Plan the week");
	assert.equal(host.root.name, "Week");
	callLlmTool(host, { name: "rename_board", input: { name: "Next week" } });
	assert.equal(host.root.name, "Next week");
});

test("a tool per item: sourceKey is the item's, as in a click's", () => {
	const Checklist = component({
		name: "Checklist",
		fields: { items: t.array(t.record({ id: t.string(), title: t.string(), done: t.boolean() })) },
		renders: {
			llmTools: Tools(
				each(
					field("items"),
					Unless(
						field("done"),
						Tool({ name: field("id"), "on:call": send("finish", sourceKey()) }, "Finish it."),
					),
				),
			),
		},
		on: {
			finish(next, [i]) {
				next.items[i].done = true;
			},
		},
	});
	const items = [
		{ id: "a", title: "A", done: false },
		{ id: "b", title: "B", done: false },
	];
	const host = hostOf({ Checklist }, (C) => C.Checklist({ items }));
	callLlmTool(host, { name: "b" });
	assert.deepEqual(
		host.root.items.map((i) => i.done),
		[false, true],
	);
	assert.deepEqual(
		renderLlmTools(host.root).map((tool) => tool.name),
		["a"],
	);
});

test("renderEach: each item component's tools, called on that item", () => {
	const List2 = component({
		name: "Tasks",
		fields: { tasks: t.array(t.component("Task")) },
		renders: { llmTools: Tools(renderEach(field("tasks"))) },
	});
	const host = hostOf({ Tasks: List2, Task }, (C) =>
		C.Tasks({ tasks: [C.Task({ title: "one" })] }),
	);
	callLlmTool(host, { name: "rename", input: { title: "uno" } });
	assert.equal(host.root.tasks[0].title, "uno");
});

test("what a tools tag says is checked when it's built", () => {
	fails(() => Tool("x", "Does x."), 'Tool x\'s on:call is a send, not "Does x."');
	fails(() => Tool({ name: "x" }), "Tool x needs an on:call");
	fails(
		() => Tool("x", send("x"), Str({ title: "t" })),
		"Str has no attr title (its attrs: name, optional, minLength, maxLength, pattern)",
	);
	fails(() => Tool("x", send("x"), Str()), "Tool's Str needs a name");
	fails(() => Tools("text"), 'Tools takes Tools, Tool, not text "text"');
	fails(() => Str({ name: 1 }), "Str.name is a string, not 1");
	fails(() => Str({ name: "a", "on:click": send("x") }), "Str can't handle events");
	fails(() => List("l", Str("item")), "List's item is a Str without a name");
	fails(() => Choose(Otherwise("a"), Case(true, "b")), "Choose's Otherwise is its last branch");
	fails(
		() => When({ test: true, over: 2 }),
		"When compares with is, not, above, below, atLeast, atMost, in, not over",
	);
});

test("what a tools render renders is checked when it renders", () => {
	const Bad = component({
		name: "Bad",
		fields: { items: t.array() },
		renders: {
			llmTools: Tools(
				Tool(
					"pick",
					send("pick", toolArg("i")),
					Enum("i", each(field("items"), Option(field("x")))),
				),
				Tool("pick", send("pick")),
				Tool("bad name", send("pick")),
			),
		},
		on: { pick() {} },
	});
	fails(
		() => renderLlmTools(Bad.make()),
		"Tool pick > Enum[0]: Enum i has no values; offer its tool When there are",
		"Tool pick: there are two tools pick",
		'Tool bad name: a tool\'s name is 1 to 64 letters, digits, _ or -, not "bad name"',
	);
});

test("a renders.llmContext renders markdown for a model, by the state", () => {
	assert.equal(
		renderLlmContext(Todo.make({ items: [] })),
		"# Todo\n\n- **Left:** 0\n- **Read only:** no\n\nNo tasks.\n\n> **Hint:** Everything is done.\n",
	);
	const items = ["a", "b", "c"].map((title, i) => ({ title, done: i === 0 }));
	assert.equal(
		renderLlmContext(Todo.make({ items })),
		"# Todo\n\n- **Left:** 2\n- **Read only:** no\n\n* [x] a\n* [ ] b\n\n…and 1 more.\n\n2 to go.\n",
	);
	assert.equal(
		renderLlmContext(Todo.make({ items, readOnly: true }), { depth: 3 })
			.split("\n\n")
			.at(-1),
		"> **Hint:** The list can't be changed.\n",
	);
});

test("a child component's context is a section a level deeper", () => {
	const board = Board.make({ name: "Week", lead: Task.make({ title: "Plan", done: true }) });
	assert.equal(
		renderLlmContext(board),
		"# Board\n\n- **Name:** Week\n\n## Task\n\n- **Title:** Plan\n- **Done:** yes\n",
	);
});

test("Data, inline marks, nested items and comparisons with fields", () => {
	const Shop = component({
		name: "Shop",
		fields: { cart: t.array(), limit: t.number() },
		queries: {
			get size() {
				return this.cart.length;
			},
		},
		renders: {
			llmContext: Section(
				"Shop",
				Text("Cart of ", Strong(field("size")), " in ", Code("cart"), "."),
				When({ test: field("size"), atLeast: field("limit") }, Hint("The cart is full.")),
				Items(Item("Groups", Items(Item("one")))),
				Data(field("cart")),
			),
		},
	});
	assert.equal(
		renderLlmContext(Shop.make({ cart: [1, 2], limit: 2 })),
		"# Shop\n\nCart of **2** in `cart`.\n\n> **Hint:** The cart is full.\n\n- Groups\n  - one\n\n```json\n[\n  1,\n  2\n]\n```\n",
	);
	assert.ok(!renderLlmContext(Shop.make({ cart: [1], limit: 2 })).includes("full"));
});

test("present and formatValue", () => {
	for (const v of [null, undefined, false, 0, "", [], {}, new Map(), new Set(), Number.NaN]) {
		assert.equal(present(v), false, String(v));
	}
	for (const v of [true, 1, "a", [0], { a: 1 }]) assert.equal(present(v), true);
	assert.equal(formatValue([1, true, null]), "1, yes, none");
	assert.equal(formatValue({ a: 1 }), '{"a":1}');
	assert.equal(formatValue([]), "none");
});

test("what a context tag says is checked when it's built and as it renders", () => {
	fails(
		() => Section("S", "loose text"),
		'Section takes Section, Text, Hint, Fact, Items, Data, not text "loose text"',
	);
	fails(() => Items(Fact("a")), "Items takes Item, not Fact");
	fails(() => Fact({ value: 1 }), "Fact needs name");
	const Bad = component({
		name: "Bad",
		fields: { done: t.string() },
		renders: { llmContext: Items(Item({ done: field("done") }, "x")) },
	});
	fails(
		() => renderLlmContext(Bad.make({ done: "yes" })),
		'Items[0] > Item[0]: Item.done is a boolean, not "yes"',
	);
});

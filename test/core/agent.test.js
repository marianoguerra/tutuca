// The agent meta convention: a component's tools for an LLM agent, each one of its own messages
// or queries, and the pure core that runs an agent over any component that says it.
import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "../../src/lint/index.js";
import {
	AGENT_META,
	agentMetaSchemas,
	agentProblems,
	DATA_META,
	dataMetaSchemas,
	dataOf,
	dataProblems,
	dataSchema,
	loadData,
	maxStepsOf,
	nextAction,
	pendingResults,
	planToolCall,
	resultText,
	sampleChoices,
	settledText,
	systemPrompt,
	toolsFor,
	typeSchema,
	withSample,
} from "../../src/meta/index.js";
import { component, Scope, t } from "../../src/tutuca.js";

const tool = (name, kind, params, extra = {}) => ({
	name,
	kind,
	target: null,
	description: `${name} it`,
	params,
	result: null,
	...extra,
});
const Counter = component({
	name: "Counter",
	meta: {
		[AGENT_META]: {
			prompt: "A counter.",
			summary: "summary",
			tools: [
				tool("add", "message", ["by"]),
				tool("label_it", "message", ["label"]),
				tool("times", "query", ["n"]),
			],
			skills: { "count.md": "Count up." },
		},
		[DATA_META]: { data: "domain", samples: { ten: { count: 10 } } },
	},
	fields: { count: t.number().int().min(0), label: t.string() },
	queries: {
		get summary() {
			return `count ${this.count}${this.label ? `, ${this.label}` : ""}`;
		},
		get domain() {
			return { count: this.count };
		},
		times: {
			args: [t.number()],
			run(n) {
				return this.count * n;
			},
		},
	},
	on: {
		add: {
			pure: true,
			args: [t.number().int().min(1)],
			pre: (self, [by]) => self.count + by <= 100,
			why: () => "it can't go over 100",
			run(next, [by]) {
				next.count += by;
			},
		},
		// Needs a context: the agent sends it.
		label_it: {
			args: [t.string().len(1)],
			run(next, [label], ctx) {
				next.label = `${label}@${ctx.now?.() ?? 0}`;
			},
		},
		load: {
			pure: true,
			args: [t.record({ count: t.number().int().min(0) })],
			run(next, [{ count }]) {
				next.count = count;
			},
		},
	},
});
const scoped = (...specs) => {
	const scope = new Scope();
	scope.registerMetaSchemas({ ...agentMetaSchemas, ...dataMetaSchemas });
	scope.register(Object.fromEntries(specs.map((s) => [s.name, s])));
	return scope;
};

test("typeSchema derives JSON Schema from field types", () => {
	assert.deepEqual(typeSchema(t.string().len(1, 5)), {
		type: "string",
		minLength: 1,
		maxLength: 5,
	});
	assert.deepEqual(typeSchema(t.number().int().min(0)), { type: "integer", minimum: 0 });
	assert.deepEqual(typeSchema(t.enum("a", "b")), { enum: ["a", "b"] });
	assert.deepEqual(typeSchema(t.option(t.boolean())), {
		anyOf: [{ type: "boolean" }, { type: "null" }],
	});
	assert.deepEqual(typeSchema(t.array(t.string())), { type: "array", items: { type: "string" } });
	assert.deepEqual(typeSchema(t.map(t.number())), {
		type: "object",
		additionalProperties: { type: "number" },
	});
	assert.deepEqual(typeSchema(t.record({ a: t.string() })), {
		type: "object",
		properties: { a: { type: "string" } },
		required: ["a"],
		additionalProperties: false,
	});
	assert.equal(typeSchema(t.any()).type.length, 6, "any names every JSON type");
	assert.match(typeSchema(t.number().where((n) => n % 2 === 0, "even")).description, /even/);
});

test("a scope with the schema checks agent meta's shape", () => {
	const Bad = component({
		name: "Bad",
		meta: { [AGENT_META]: { tools: [{ name: "x", kind: "poke", params: [] }] } },
	});
	assert.throws(() => scoped(Bad), /tools/);
});

test("agentProblems finds tools that name what the component doesn't have", () => {
	assert.deepEqual(agentProblems(Counter), []);
	const Broken = component({
		name: "Broken",
		meta: {
			[AGENT_META]: {
				summary: "nope",
				tools: [
					tool("ghost", "message", []),
					tool("add", "message", ["by", "extra"]),
					tool("add", "query", []),
				],
			},
		},
		on: { add: { pure: true, args: [t.number()], run() {} } },
	});
	const problems = agentProblems(Broken);
	assert.ok(problems.some((p) => /ghost runs message ghost, which it doesn't have/.test(p)));
	assert.ok(problems.some((p) => /names 2 params, but add takes 1 args/.test(p)));
	assert.ok(problems.some((p) => /add is given twice/.test(p)));
	assert.ok(problems.some((p) => /summary nope isn't a zero-arg query/.test(p)));
	// lint reports them.
	assert.ok(lint([Broken]).some((issue) => issue.code === "agent-meta"));
	assert.equal(lint([Counter]).filter((issue) => issue.code === "agent-meta").length, 0);
});

test("toolsFor names the args and adds the shared tools the meta calls for", () => {
	const c = scoped(Counter).make("Counter", {});
	const tools = toolsFor(c);
	assert.deepEqual(
		tools.map((tl) => tl.name),
		[
			"add",
			"label_it",
			"times",
			"get_state",
			"set_state",
			"skills_list",
			"skills_read",
			"samples_list",
			"load_sample",
		],
	);
	assert.deepEqual(tools[0].parameters, {
		type: "object",
		properties: { by: { type: "integer", minimum: 1 } },
		required: ["by"],
		additionalProperties: false,
	});
	assert.match(tools[2].description, /reads, changes nothing/);
	assert.deepEqual(tools.find((tl) => tl.name === "set_state").parameters.properties.value, {
		type: "object",
		properties: { count: { type: "integer", minimum: 0 } },
		required: ["count"],
		additionalProperties: false,
	});
	assert.match(systemPrompt(c), /A counter\.[\s\S]*Now: count 0/);
});

test("planToolCall runs queries and pure messages, and says why a call fails", () => {
	const c = scoped(Counter).make("Counter", {});
	const added = planToolCall(c, { id: "1", name: "add", arguments: { by: 3 } });
	assert.deepEqual(added.done, { text: "count 3", isError: false });
	assert.equal(added.next.count, 3);
	const over = planToolCall(added.next, { id: "2", name: "add", arguments: { by: 98 } });
	assert.deepEqual(over.done, {
		text: "it can't run with these arguments now: it can't go over 100",
		isError: true,
	});
	assert.equal(over.next.count, 3, "nothing changed");
	const bad = planToolCall(c, { id: "3", name: "add", arguments: { by: "x" } });
	assert.match(bad.done.text, /by isn't/);
	assert.equal(planToolCall(c, { id: "4", name: "times", arguments: { n: 2 } }).done.text, "0");
	assert.equal(planToolCall(c, { id: "5", name: "nope" }).done.isError, true);
	assert.equal(planToolCall(c, { id: "6", name: "get_state" }).done.text, '{"count":0}');
	assert.equal(
		planToolCall(c, { id: "7", name: "skills_read", arguments: { path: "count.md" } }).done.text,
		"Count up.",
	);
	const loaded = planToolCall(c, { id: "8", name: "load_sample", arguments: { name: "ten" } });
	assert.equal(loaded.next.count, 10);
	const set = planToolCall(c, { id: "9", name: "set_state", arguments: { value: { count: 4 } } });
	assert.deepEqual(set.done, { text: "count 4", isError: false });
	const badSet = planToolCall(c, { id: "10", name: "set_state", arguments: { value: { n: 1 } } });
	assert.equal(badSet.done.isError, true);
	assert.match(badSet.done.text, /value isn't/);
	assert.equal(badSet.next, c, "nothing changed");
});

test("a message that needs a context is checked, not run: the host sends it", () => {
	const c = scoped(Counter).make("Counter", {});
	assert.deepEqual(planToolCall(c, { id: "1", name: "label_it", arguments: { label: "hi" } }), {
		send: { name: "label_it", args: ["hi"] },
		result: "summary",
	});
	assert.equal(
		planToolCall(c, { id: "2", name: "label_it", arguments: { label: "" } }).done.isError,
		true,
	);
	assert.equal(resultText(c, "summary"), "count 0");
});

test("samples: choices start with empty, withSample loads one", () => {
	const scope = scoped(Counter);
	assert.deepEqual(sampleChoices(Counter, scope), [
		{ id: "empty", title: "Empty" },
		{ id: "ten", title: "ten" },
	]);
	const c = scope.make("Counter", {});
	assert.equal(withSample(c, "ten").count, 10);
	assert.equal(withSample(c, "empty"), c);
	assert.equal(Object.isFrozen(dataOf(c).samples.ten), true, "the meta read is deeply frozen");
});

test("data meta: load and data must be a pure one-arg message and a zero-arg query", () => {
	assert.deepEqual(dataProblems(Counter), []);
	const Broken = component({
		name: "BrokenData",
		meta: { [DATA_META]: { load: "set", data: "nope" } },
		on: { set: { args: [t.any()], run() {} } },
	});
	assert.deepEqual(dataProblems(Broken), [
		"its data load set isn't a pure message of one arg",
		"its data nope isn't a zero-arg query",
	]);
	assert.ok(lint([Broken]).some((issue) => issue.code === "data-meta"));
	assert.equal(lint([Counter]).filter((issue) => issue.code === "data-meta").length, 0);
});

test("data meta: the schema is the load arg's, unless the meta gives one; loadData explains", () => {
	const c = scoped(Counter).make("Counter", {});
	assert.equal(dataSchema(c).properties.count.type, "integer");
	const Given = component({
		name: "Given",
		meta: { [DATA_META]: { schema: { type: "object" } } },
		fields: { v: t.any() },
		on: {
			load: {
				pure: true,
				args: [t.any()],
				pre: (_self, [v]) => typeof v === "object",
				why: () => "it must be an object",
				run(next, [v]) {
					next.v = v;
				},
			},
		},
	});
	const g = scoped(Given).make("Given", {});
	assert.deepEqual(dataSchema(g), { type: "object" });
	assert.deepEqual(loadData(g, 3), {
		error: "it can't run with these arguments now: it must be an object",
	});
	assert.deepEqual(loadData(g, { a: 1 }).next.v, { a: 1 });
	assert.match(loadData(c, { count: -1 }, "the file").error, /^the file isn't/);
});

test("nextAction: infer after a prompt or answered calls, tools for pending ones, else complete", () => {
	const call = (id) => ({ type: "toolCall", id, name: "add", arguments: {} });
	const result = (id) => ({ role: "toolResult", toolCallId: id, toolName: "add", content: [] });
	const asked = [{ role: "user", content: "go" }];
	assert.equal(nextAction([]).action, "complete");
	assert.equal(nextAction(asked).action, "infer");
	const calling = [...asked, { role: "assistant", content: [call("a"), call("b")] }];
	assert.deepEqual(
		nextAction([...calling, result("a")]).calls.map((c) => c.id),
		["b"],
	);
	assert.equal(nextAction([...calling, result("a"), result("b")]).action, "infer");
	const answered = [...asked, { role: "assistant", content: [{ type: "text", text: "ok" }] }];
	assert.equal(nextAction(answered).action, "complete");
});

test("settledText: a settled tool says what its target is now, and why when it didn't go well", () => {
	const c = scoped(Counter).make("Counter", {});
	const report = (outcome, failed = 0) => ({ id: 1, outcome, tasks: 3, failed });
	assert.deepEqual(settledText(c, "summary", report("ok")), { text: "count 0", isError: false });
	const failed = settledText(c, "summary", report("failed", 1));
	assert.equal(failed.isError, true);
	assert.match(failed.text, /1 of the 3 steps it took failed\. Now: count 0/);
	assert.match(settledText(c, "summary", report("cancelled")).text, /stopped before it finished/);
	assert.match(settledText(c, "summary", report("timeout")).text, /took too long/);
	assert.equal(maxStepsOf(c), 12);
});

test("pendingResults: a result for each call a stopped loop left without one", () => {
	const ask = { role: "user", content: "go" };
	const calls = {
		role: "assistant",
		content: [
			{ type: "toolCall", id: "a", name: "x", arguments: {} },
			{ type: "toolCall", id: "b", name: "y", arguments: {} },
		],
	};
	const answered = {
		role: "toolResult",
		toolCallId: "a",
		toolName: "x",
		content: [],
		isError: false,
	};
	assert.deepEqual(pendingResults([ask], "stopped"), []);
	const closed = pendingResults([ask, calls, answered], "stopped");
	assert.deepEqual(
		closed.map((m) => [m.toolCallId, m.isError, m.content[0].text]),
		[["b", true, "stopped"]],
	);
});

// The canvas's own agent (the agent bundle): it adds a component, gives it an agent, prompts
// that agent and waits for it (a settle scope, src/tree/scope.js), then ejects it. The models
// are scripted and answer later, as a server would.
import assert from "node:assert/strict";
import test from "node:test";
import { assistantMessage } from "../../components/agent/llm.js";
import { bundleOf } from "../../demos/canvas/bundles.js";
import { start as startCanvas } from "../../demos/canvas/main.js";
import { lint } from "../../src/lint/index.js";
import { specOf } from "../../src/tutuca.js";
import { dom } from "../helpers.js";

const mount = (handlers, bundle = "agent", agent = false) => {
	const window = dom('<div id="app"></div>');
	const host = startCanvas(
		window.document,
		bundle,
		{ inferenceAvailable: () => true, models: () => [], ...handlers },
		agent,
	);
	const problems = [];
	host.onNotify = (type, info) => {
		if (type === "taskFailed" || type === "stateInvalid") problems.push({ type, ...info });
	};
	const rootNode = window.document.getElementById("app");
	const fire = (type, el, value) => {
		if (value !== undefined) el.value = value;
		const Event = type === "click" ? window.MouseEvent : window.Event;
		el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
		while (host.tasks.length > 0) host.handleTasks();
	};
	// The canvas agent's own prompt, not one of its items' agents'.
	const own = (selector) =>
		[...rootNode.querySelectorAll(selector)].find((el) => el.closest(".canvas-card") === null);
	const prompt = (text) => {
		fire("input", own('textarea[aria-label="Prompt"]'), text);
		fire("submit", own("form.agent-prompt"));
	};
	const idle = async () => {
		for (let i = 0; i < 50 && !host.scheduler.isIdle; i++) {
			await new Promise((r) => setTimeout(r, 1));
			while (host.tasks.length > 0) host.handleTasks();
		}
	};
	return { host, rootNode, fire, own, prompt, idle, problems, state: () => host.root };
};
const later = (message) => new Promise((r) => setTimeout(() => r(message), 2));
// The text of the last tool result in a request's transcript.
const lastResult = (request) =>
	request.transcript
		.filter((m) => m.role === "toolResult")
		.at(-1)
		?.content.map((b) => b.text)
		.join("\n") ?? "";
const call = (name, args) => ({ name, arguments: args });
const results = (agent) =>
	agent.transcript.messages
		.filter((m) => m.role === "toolResult")
		.map((m) => [m.toolName, m.isError, m.content[0].text]);
const isCanvasAgent = (request) => request.tools.some((tl) => tl.name === "delegate");
// What the server offers: the first is what an agent starts with.
const MODELS = [
	{ provider: "p", id: "big", name: "Big" },
	{ provider: "p", id: "small", name: "Small" },
];

test("the canvas's agent adds a board, prompts its agent, waits for it and ejects it", async () => {
	let key = null;
	const canvasTurns = [
		() => [call("list_kinds", {})],
		() => [call("add_component", { kind: "board", choice: "week", x: null, y: null })],
		(r) => {
			key = /Added (\S+)/.exec(lastResult(r))[1];
			return [call("enable_agent", { key })];
		},
		() => [call("delegate", { key, prompt: "Start the first card." })],
		() => [call("eject_agent", { key })],
		() => ["Done: the board's first card is started."],
	];
	const boardTurns = [
		() => [call("move_card", { id: "c00", column: 1, at: 0 })],
		() => ["Moved c00 to Doing."],
	];
	const boardModels = [];
	const app = mount({
		models: () => MODELS,
		infer: ([request]) => {
			if (!isCanvasAgent(request)) boardModels.push(request.model);
			const turns = isCanvasAgent(request) ? canvasTurns : boardTurns;
			const turn = turns.shift();
			assert.ok(turn, "a turn for each request");
			return later(assistantMessage(turn(request)));
		},
	});
	assert.equal(specOf(app.state()).name, "Agent");
	assert.ok(app.state().target.kinds.some((k) => k.id === "board" && k.agent));
	// Not the first the server offers: the board's agent uses it too.
	app.fire("change", app.own('select[aria-label="Model"]'), "p/small");
	app.prompt("Make a board for the week and start its first card.");
	await app.idle();
	assert.deepEqual(boardModels, ["p/small", "p/small"], "the canvas agent's model");
	assert.equal(canvasTurns.length, 0, "every turn of the canvas's agent was asked");
	assert.equal(boardTurns.length, 0, "and of the board's");
	const canvas = app.state().target;
	const item = canvas.items[key];
	assert.equal(specOf(item.content).name, "Board", "ejected");
	assert.equal(item.content.columns[1].cards[0].id, "c00", "moved to the front of Doing");
	assert.ok(!item.content.columns[0].cards.some((c) => c.id === "c00"));
	assert.ok(item.x >= canvas.items["item-1"].x + canvas.items["item-1"].width, "after the board");
	const told = results(app.state());
	assert.deepEqual(
		told.map(([name, isError]) => [name, isError]),
		[
			["list_kinds", false],
			["add_component", false],
			["enable_agent", false],
			["delegate", false],
			["eject_agent", false],
		],
	);
	// add_component answered once the component was made; delegate once its agent was done.
	assert.match(told[1][2], /^Added /);
	assert.match(told[3][2], /Its agent said: Moved c00 to Doing\./);
	assert.equal(app.state().status, "idle");
	assert.deepEqual(app.problems, []);
	const errors = lint([...app.host.registrations], [...app.host.componentNames]).filter(
		(i) => i.level === "error",
	);
	assert.deepEqual(
		errors.map((i) => `${i.code} ${i.path}: ${i.message}`),
		[],
	);
});

test("stopping the canvas's agent mid-delegate stops its item's agent, aborting its model", async () => {
	let signal = null;
	const app = mount({
		infer: ([request], read) => {
			if (isCanvasAgent(request)) {
				return later(assistantMessage([call("delegate", { key: "item-1", prompt: "Work." })]));
			}
			signal = read.signal;
			return new Promise(() => {}); // A model that never answers.
		},
	});
	// The board's item gets its agent from its 🤖, then the canvas's agent prompts it.
	app.fire("click", app.rootNode.querySelector('[title="Wrap in an agent"]'));
	app.prompt("Have the board's agent work.");
	await app.idle();
	const board = () => app.state().target.items["item-1"].content;
	assert.equal(app.state().status, "running");
	assert.equal(board().status, "thinking");
	app.fire("click", app.own('button[title^="Stop what"]'));
	await app.idle();
	assert.equal(signal.aborted, true);
	assert.equal(app.state().status, "idle");
	assert.equal(board().status, "idle");
	const [last] = results(app.state()).slice(-1);
	assert.deepEqual(last.slice(0, 2), ["delegate", true]);
	assert.match(last[2], /Stopped by the user/);
	assert.deepEqual(app.problems, []);
});

test("an item's agent keeps a model picked for it by hand, whatever the canvas's agent uses", async () => {
	const boardModels = [];
	const app = mount({
		models: () => MODELS,
		infer: ([request]) => {
			if (isCanvasAgent(request)) {
				const done = request.transcript.at(-1).role === "toolResult";
				const turn = done ? ["Done."] : [call("delegate", { key: "item-1", prompt: "Work." })];
				return later(assistantMessage(turn));
			}
			boardModels.push(request.model);
			return later(assistantMessage(["Worked."]));
		},
	});
	app.fire("click", app.rootNode.querySelector('[title="Wrap in an agent"]'));
	await app.idle();
	const card = app.rootNode.querySelector(".canvas-card");
	app.fire("change", card.querySelector('select[aria-label="Model"]'), "p/small");
	app.prompt("Have the board's agent work.");
	await app.idle();
	assert.equal(app.state().model, "p/big");
	assert.deepEqual(boardModels, ["p/small"]);
	assert.deepEqual(app.problems, []);
});

test("?agent puts any bundle's canvas in an agent; without it, the canvas is the root", () => {
	const at = (search) => ({ location: { search } });
	assert.equal(bundleOf(at("?bundle=music&agent")).agent, true);
	assert.equal(bundleOf(at("?bundle=music")).agent, undefined);
	assert.equal(bundleOf(at("?agent")).id, "default");
	assert.equal(bundleOf(at("?bundle=agent")).agent, true, "the agent bundle comes in one");
	const plain = mount({}, "music");
	assert.equal(specOf(plain.state()).name, "Canvas");
	const music = mount({}, "music", true);
	assert.equal(specOf(music.state()).name, "Agent");
	const canvas = music.state().target;
	assert.equal(specOf(canvas).name, "Canvas");
	assert.ok(
		canvas.kinds.some((k) => k.agent),
		"music kinds an agent can drive",
	);
	assert.ok(music.own('textarea[aria-label="Prompt"]'), "its prompt, beside the canvas");
	assert.deepEqual(music.problems, []);
});

import { step, stories } from "../../src/storybook/index.js";
import { withSample } from "../../src/tutuca.js";
import { canvas, canvasKitComponents } from "../canvas/index.js";
import { kindHandlers, layoutComponents } from "../canvas/layout.js";
import { kanbanComponents } from "../kanban/index.js";
import { transcriptComponents } from "../llm/transcript.js";
import { agent, agentComponents } from "./index.js";
import { echoStep } from "./llm.js";

// What a hole in an agent can become: the kanban board, the only component here that says
// agent meta (the canvas and layouts kindHandlers adds don't).
const KINDS = { board: { component: "Board", make: (C) => C.Board({}) } };
const MODELS = [
	{ provider: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
	{ provider: "openrouter", id: "z-ai/glm-5", name: "GLM 5" },
];
const onBoard = (C, sample = "week") => agent(C, { target: withSample(C.Board({}), sample) });

const sameIds = (options, ids) => options.map((o) => o.id).join() === ids.join();
const titles = (s, column) => s.target.columns[column].cards.map((c) => c.title);
const last = (s) => s.transcript.messages.at(-1);
const resultsOf = (s) => s.transcript.messages.filter((m) => m.role === "toolResult");
const type = (text) => step.event("input", 'textarea[aria-label="Prompt"]', { value: text });
const submit = step.event("submit", "form.agent-prompt");
const click = (selector) => step.event("click", selector);
// A keydown on the prompt, with Ctrl held or not: story steps fire plain events only.
const keyCommand = (key, ctrlKey) => ({
	check: () => true,
	run(_model, driver) {
		const el = driver.rootNode.querySelector('textarea[aria-label="Prompt"]');
		const { KeyboardEvent } = el.ownerDocument.defaultView;
		el.dispatchEvent(
			new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true }),
		);
		driver.drain();
	},
	toString: () => `keydown ${ctrlKey ? "Ctrl+" : ""}${key}`,
});

export default stories({
	title: "Agent",
	components: {
		...agentComponents,
		...transcriptComponents,
		...kanbanComponents,
		...layoutComponents,
		...canvasKitComponents,
	},
	// The echo model answers at once: it runs the tool a prompt names, /tool {"arg": ...}.
	// models answers with two, as a studio server with keys would.
	askHandlers: {
		...kindHandlers(KINDS),
		infer: ([request]) => echoStep(request),
		models: () => MODELS,
	},
	stories: {
		"Pick a component": {
			make: (C) => agent(C),
			sequences: {
				"the hole lists what says agent meta, then its samples": [
					step.check("no target, nothing to send", (s) => !s.hasTarget && s.cannotSend),
					click('[title="Put a component here"]'),
					// A canvas says agent meta too: its agent makes and drives components on it.
					step.check(
						"only the board and a canvas",
						(s) => s.target.kinds.map((k) => k.id).join() === "board,canvas",
					),
					step.check(
						"with empty and its sample to start from",
						(s) => s.target.kinds[0].choices.map((c) => c.id).join() === "empty,week",
					),
					click('[data-choice="board"]'),
					click('[data-choice="week"]'),
					step.check("the agent drives the week's board", (s) => s.hasTarget),
					step.check("three columns, two cards to do", (s) => titles(s, 0).length === 2),
					step.check("its tools listed", (s) => s.tools.some((t) => t.name === "move_card")),
					step.check("the host's models to pick from, after echo", (s) =>
						sameIds(s.modelOptions, [
							"echo/echo",
							"anthropic/claude-sonnet-5-5",
							"openrouter/z-ai/glm-5",
						]),
					),
					step.event("change", 'select[aria-label="Model"]', { value: "openrouter/z-ai/glm-5" }),
					step.check("picked", (s) => s.model === "openrouter/z-ai/glm-5"),
				],
				"empty starts with no columns": [
					click('[title="Put a component here"]'),
					click('[data-choice="board"]'),
					click('[data-choice="empty"]'),
					step.check("an empty board", (s) => s.hasTarget && s.target.columns.length === 0),
				],
			},
		},
		// On a canvas with a model to ask, a board's item wraps it in an agent, and ejects it.
		"On a canvas": {
			make: (C) =>
				canvas(C, [[24, 24, withSample(C.Board({}), "week"), "🗂️ Kanban board", 640]], {
					width: 1400,
					height: 700,
					agentsAvailable: true,
				}),
			sequences: {
				"wrap the board in an agent, then eject it": [
					click('[title="Wrap in an agent"]'),
					step.check(
						"an agent holds the board",
						(s) => s.items["item-1"].content.target.columns.length === 3,
					),
					step.send("ask", ['/remove_card {"id": "c00"}'], {
						at: (b) => b.item("items", "item-1").field("content"),
					}),
					step.check("the agent changed the board", (s) =>
						s.items["item-1"].content.target.columns[0].cards.every((c) => c.id !== "c00"),
					),
					click('[title="Eject it from the agent"]'),
					step.check("the board is back, as the agent left it", (s) => {
						const board = s.items["item-1"].content;
						return board.columns?.[0].cards.length === 1 && s.items["item-1"].width === 640;
					}),
				],
			},
		},
		"Kanban board": {
			make: (C) => onBoard(C),
			sequences: {
				"a pure tool, typed as a prompt": [
					type('/move_card {"id": "c00", "column": 2, "at": 0}'),
					submit,
					step.check("the card is done", (s) => titles(s, 2)[0] === "Write the drag and drop docs"),
					step.check("the model answered after the result", (s) => last(s).role === "assistant"),
					step.check("idle again", (s) => s.status === "idle" && s.steps === 2),
				],
				"Ctrl+Enter sends the prompt, Enter alone doesn't": [
					type('/remove_card {"id": "c00"}'),
					step.command(keyCommand("Enter", false), "Enter"),
					step.check("not sent", (s) => s.transcript.isEmpty),
					step.command(keyCommand("Enter", true), "Ctrl+Enter"),
					step.check(
						"sent, and the card is gone",
						(s) => titles(s, 0).length === 1 && s.draft === "",
					),
				],
				"a tool that needs a context runs in the board": [
					step.send("ask", ['/add_card {"column": 1, "title": "Ship it"}']),
					step.check("a new card in Doing", (s) => titles(s, 1).at(-1) === "Ship it"),
					step.check("its result shows it", (s) =>
						resultsOf(s)[0].content[0].text.includes("Ship it"),
					),
				],
				"a failing tool says why": [
					step.send("ask", ['/remove_card {"id": "nope"}']),
					step.check("an error result", (s) => resultsOf(s)[0].isError),
					step.check("in words", (s) => resultsOf(s)[0].content[0].text.includes("no card nope")),
					step.check("nothing changed", (s) => titles(s, 0).length === 2),
				],
				"a query and the shared tools": [
					step.send("ask", ['/cards_in {"column": 1}']),
					step.check(
						"the cards of Doing",
						(s) => JSON.parse(resultsOf(s)[0].content[0].text).length === 1,
					),
					step.send("ask", ['/skills_read {"path": "workflow.md"}']),
					step.check("the skill", (s) => resultsOf(s)[1].content[0].text.includes("Doing")),
					step.send("ask", ['/load_sample {"name": "week"}']),
					step.check("loaded", (s) => !resultsOf(s)[2].isError),
				],
				"the models are asked for when the select is focused": [
					step.check("only echo before", (s) => sameIds(s.modelOptions, ["echo/echo"])),
					step.event("focusin", 'select[aria-label="Model"]'),
					step.check("then the host's", (s) => s.modelOptions.length === 3),
				],
				"hide the chat, the board alone; the tools on a toggle": [
					click('[title="Hide the chat"]'),
					step.check("no chat", (s) => !s.chatOpen),
					click('[title="Show the chat"]'),
					click('[title="What you can ask it to do"]'),
					step.check("the tools listed", (s) => s.showsTools),
				],
				"change the target": [
					step.send("ask", ["hello"]),
					click('[title="Drive another component"]'),
					step.check("a hole and a new conversation", (s) => !s.hasTarget && s.transcript.isEmpty),
				],
			},
		},
	},
});

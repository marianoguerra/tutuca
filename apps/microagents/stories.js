import { step, stories } from "../../src/storybook/index.js";
import { assistantMessage } from "./core/llm.js";
import { userMessage } from "./core/loop.js";
import { entriesFor, shellComponents } from "./index.js";

const regexCard = {
	id: "regex-lab",
	title: "Regex lab",
	description:
		"Run regular expressions against texts, see where they match and which expectations pass, and fix them.",
	needs: "one or more regex parts ({pattern, flags}) and one or more text parts",
	icon: "🔎",
	samples: ["emails"],
	builtin: true,
};
const logoCard = {
	id: "logo",
	title: "Logo",
	description: "Write turtle programs and watch them draw.",
	needs: "a logo-program part",
	icon: "🐢",
	samples: ["square", "spiral"],
	builtin: false,
};

const launcher = (C) =>
	C.MicroAgentApp({ agents: [C.AgentCard(regexCard), C.AgentCard(logoCard)] });

const picker = (C) =>
	C.MicroAgentApp({
		mode: "choosing",
		agents: [C.AgentCard(regexCard)],
		picker: C.Picker({
			file: "charts.tdata.json",
			message: null,
			choices: [
				C.Choice({
					id: "vega-lite-lab",
					title: "Vega-Lite lab",
					icon: "📊",
					detail: "$spec: 1, $tables: 2 parts",
				}),
				C.Choice({
					id: "echarts-lab",
					title: "ECharts lab",
					icon: "📈",
					detail: "$spec: 1, $tables: 2 parts",
				}),
			],
			misses: [
				C.Choice({ id: "regex-lab", title: "Regex lab", icon: "🔎", detail: regexCard.needs }),
			],
		}),
	});

const trust = (C) =>
	C.MicroAgentApp({
		mode: "trust",
		trust: C.TrustCard({
			title: "Logo",
			id: "logo",
			version: "2",
			needs: "a logo-program part",
			tools: ["set_program", "run", "step"],
			moduleSize: 6234,
			replaces: "1",
		}),
	});

const transcript = [
	userMessage("make every expectation pass", 0),
	assistantMessage(
		[
			"t4 matches r1 but shouldn't.",
			{
				id: "c1",
				name: "set_regex",
				arguments: { id: "r1", pattern: "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$", flags: "" },
			},
		],
		"anthropic/claude-sonnet-5-5",
	),
	{
		role: "toolResult",
		toolCallId: "c1",
		toolName: "set_regex",
		content: [{ type: "text", text: "6 pass · 0 fail · 2 unset" }],
		details: { changed: true },
		isError: false,
		timestamp: 0,
	},
	assistantMessage(["Fixed: r1 no longer accepts a second @."], "anthropic/claude-sonnet-5-5"),
	assistantMessage(
		[
			"Let me read the skill first.",
			{ id: "c2", name: "skills_read", arguments: { path: "SKILL.md" } },
			{
				id: "c3",
				name: "set_program",
				arguments: {
					program:
						'color "deepskyblue"\nrepeat 4 [ fd 12 rt 60 fd 12 lt 120 fd 12 rt 60 fd 12 ] rt 90 repeat 3 [ fd 40 rt 120 ]',
				},
			},
		],
		"anthropic/claude-sonnet-5-5",
	),
	{
		role: "toolResult",
		toolCallId: "c2",
		toolName: "skills_read",
		content: [{ type: "text", text: "# Logo\nfd n, rt deg, repeat n [ … ]" }],
		details: { changed: false },
		isError: false,
		timestamp: 0,
	},
	{
		role: "toolResult",
		toolCallId: "c3",
		toolName: "set_program",
		content: [{ type: "text", text: 'set_program threw: unknown command "color"' }],
		details: { changed: false },
		isError: true,
		timestamp: 0,
	},
];
const chat = (C) =>
	C.ChatPanel({
		transcript,
		entries: entriesFor(C, transcript),
		models: [{ provider: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }],
		model: "anthropic/claude-sonnet-5-5",
		checked: true,
	});

const toolCard = (C) =>
	C.ToolCard({
		name: "set_regex",
		kind: "message",
		description: "Change a regex's pattern and flags.",
		schemaText: JSON.stringify(
			{ id: { type: "string" }, pattern: { type: "string" }, flags: { type: "string" } },
			null,
			1,
		),
		argsText: '{"id":"r1","pattern":"\\\\d+","flags":""}',
	});

export default stories({
	title: "Micro-agents",
	components: shellComponents,
	stories: {
		"App/Launcher": {
			make: launcher,
			sequences: {
				"paste text that isn't TData": [
					step.event("input", "textarea", { value: "not tdata" }),
					step.check("kept", (s) => s.pasteText === "not tdata"),
				],
			},
		},
		"App/Picker": {
			make: picker,
			sequences: {
				"back to the launcher": [
					step.event("click", "section > button.btn-ghost"),
					step.check("launcher", (s) => s.mode === "launcher" && s.picker === null),
				],
			},
		},
		"App/Trust card": {
			make: trust,
			sequences: {
				cancel: [
					step.event("click", "button.btn-ghost"),
					step.check("launcher", (s) => s.mode === "launcher"),
				],
			},
		},
		"Chat/Transcript": { make: chat },
		"Chat/Thinking": {
			make: (C) =>
				C.ChatPanel({
					transcript: transcript.slice(0, 1),
					entries: entriesFor(C, transcript.slice(0, 1)),
					models: [{ provider: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }],
					model: "anthropic/claude-sonnet-5-5",
					busy: true,
					status: "thinking…",
					checked: true,
				}),
			sequences: {
				"a loading bubble where the reply goes": [
					step.check(
						"busy, with the status over the bubble",
						(s) => s.busy && s.busyLabel === "thinking…",
					),
				],
			},
		},
		"Tools/Card": { make: toolCard },
	},
});

import { step, stories } from "../../src/storybook/index.js";
import { $if, component, field, pushView, render, send, t, tag } from "../../src/tutuca.js";
import { schemaEditor } from "../json-schema/editor.js";
import {
	assistantMessage,
	finalResponse,
	followUpRequest,
	inferenceRequest,
	inferenceResponse,
	llmComponents,
	structuredOutput,
	systemMessage,
	toolCall,
	toolDefinition,
	toolResult,
	userMessage,
	WEATHER,
} from "./index.js";

const { button, div } = tag;

// A part with a toggle that pushes its edit view, as a canvas item's does.
const Editable = component({
	name: "Editable",
	fields: { content: t.component(), editing: t.boolean() },
	queries: {
		get pushed() {
			return this.editing ? "edit" : "main";
		},
		get toggleLabel() {
			return this.editing ? "Use it" : "Edit it";
		},
	},
	view: div(
		{ class: "flex max-w-xl flex-col items-start gap-2" },
		button(
			{
				class: "btn btn-xs",
				title: field("toggleLabel"),
				"aria-pressed": $if(field("editing"), "true", "false"),
				"on:click": send("toggle"),
			},
			field("toggleLabel"),
		),
		div({ class: "w-full" }, pushView(field("pushed"), render(field("content")))),
	),
	on: {
		toggle(next) {
			next.editing = !this.editing;
		},
	},
});

const editable = (make) => (C) => C.Editable({ content: make(C) });
const edit = step.event("click", '[title="Edit it"]');
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Adds name to the required list of the schema editor at: its JSON's third entry is required.
const addRequired = (at, name) => {
	const list = (b) => at(b).field("json").item("entries", 2).field("value");
	return [
		step.send("add", [], { at: list }),
		step.send("setTo", ["string"], { at: (b) => list(b).item("items", 1) }),
		step.send("setValue", [name], { at: (b) => list(b).item("items", 1) }),
	];
};
const type = (label, value) => step.event("input", `[aria-label="${label}"]`, { value });

export default stories({
	title: "LLM",
	components: { ...llmComponents, Editable },
	stories: {
		"System message": {
			make: editable((C) => systemMessage(C)),
			sequences: {
				"edit it, and its tokens follow": [
					edit,
					type("system message", "Answer like a pirate."),
					step.check("the new text", (s) => s.content.text === "Answer like a pirate."),
					step.check("about 5 tokens", (s) => s.content.tokens === 5),
					type("system message", ""),
					step.check("no tokens when empty", (s) => s.content.tokens === 0),
				],
			},
			pbt: { events: true, maxCommands: 8 },
		},
		"User message": { make: editable((C) => userMessage(C)) },
		"Assistant message": { make: editable((C) => assistantMessage(C)) },
		"Tool definition": {
			make: editable((C) => toolDefinition(C)),
			sequences: {
				"rename it and require a unit": [
					edit,
					type("Tool name", "get_forecast"),
					step.check("renamed", (s) => s.content.toJson().name === "get_forecast"),
					...addRequired((b) => b.field("content").field("parameters"), "unit"),
					step.check("now both are required", (s) =>
						sameJson(s.content.parameters.toSchema().required, ["city", "unit"]),
					),
					step.check("the tree follows", (s) =>
						sameJson(s.content.parameters.tree.toSchema().required, ["city", "unit"]),
					),
				],
			},
		},
		"Tool call": {
			make: editable((C) => toolCall(C)),
			sequences: {
				"call another tool": [
					edit,
					type("Tool name", "get_time"),
					type("Call id", "call_2"),
					step.check("its name and id", (s) => {
						const { name, id } = s.content.toJson();
						return name === "get_time" && id === "call_2";
					}),
				],
				"drop a JSON file on its input": [
					step.answer("readText", "ok", '{ "city": "Lima" }', {
						at: (b) => b.field("content").field("input"),
					}),
					step.check("the dropped input", (s) =>
						sameJson(s.content.toJson().input, { city: "Lima" }),
					),
				],
			},
		},
		"Tool result": {
			make: editable((C) => toolResult(C)),
			sequences: {
				"it failed": [
					edit,
					step.event("change", '[aria-label="Failed"]', { value: true }),
					step.check("an error", (s) => s.content.isError),
				],
			},
		},
		"Tool result/Error": {
			make: editable((C) =>
				toolResult(C, "The weather service didn't answer in time.", { isError: true }),
			),
		},
		"Structured output": {
			make: editable((C) => structuredOutput(C)),
			sequences: {
				"a schema the output doesn't follow": [
					step.check("matches at first", (s) => s.content.isValid),
					edit,
					...addRequired((b) => b.field("content").field("schema"), "humidity"),
					step.check("humidity is missing", (s) =>
						s.content.problems.some((p) => p.text === "$ is missing humidity"),
					),
				],
			},
		},
		"Structured output/Invalid": {
			make: editable((C) =>
				structuredOutput(C, {
					schema: WEATHER.output.schema,
					value: { city: "Buenos Aires", temperature: "18", conditions: "foggy", wind: 12 },
				}),
			),
		},
		"Inference request": {
			make: editable((C) => inferenceRequest(C)),
			sequences: {
				"its JSON is pi-ai's Context, and every part costs input tokens": [
					step.check("system, one user message and the tool", (s) => {
						const { systemPrompt, messages, tools } = s.content.toJson();
						return systemPrompt === WEATHER.system && messages.length === 1 && tools.length === 1;
					}),
					step.check("the tokens add up", (s) => {
						const { system, messages, tools } = s.content;
						return s.content.tokens === system.tokens + messages[0].tokens + tools[0].tokens;
					}),
					edit,
					type("Max tokens", "2048"),
					type("Temperature", "5"),
					step.check("max tokens set, a temperature out of range isn't", (s) => {
						const { maxTokens, temperature } = s.content;
						return maxTokens === 2048 && temperature === 1;
					}),
					step.event("click", '[title="Add an assistant message"]'),
					step.check("the transcript grows", (s) => s.content.messages.length === 2),
					step.event("click", '[title="Remove this tool"]'),
					step.check("no tools, none in the JSON", (s) => !("tools" in s.content.toJson())),
					step.event("click", '[title="Toggle the answer schema"]'),
					step.check("an answer schema", (s) => "outputSchema" in s.content.toJson()),
				],
			},
		},
		"Inference request/Follow-up": {
			make: editable((C) => followUpRequest(C)),
			sequences: {
				"the call goes in an assistant message, its result says the tool": [
					step.check("user, assistant with the call, tool result", (s) => {
						const [user, assistant, result] = s.content.toJson().messages;
						return (
							user.role === "user" &&
							assistant.role === "assistant" &&
							assistant.content[0].type === "toolCall" &&
							assistant.content[0].name === WEATHER.call.name &&
							result.role === "toolResult" &&
							result.toolName === WEATHER.call.name &&
							result.toolCallId === WEATHER.call.id
						);
					}),
				],
			},
		},
		"Inference request/Sections": {
			make: editable((C) => followUpRequest(C)),
			sequences: {
				"close a section, then open and close every one, deep": [
					step.event("click", '.llm-request > section > h3 > button[value="transcript"]'),
					step.check("the transcript is closed", (s) => !s.content.transcriptOpen),
					step.check("the others stay open", (s) => s.content.systemOpen && s.content.toolsOpen),
					step.event("click", '.llm-request > section > h3 > button[value="transcript"]'),
					step.check("open again", (s) => s.content.transcriptOpen),
					step.send("setSectionsOpen", [false], { at: (b) => b.field("content") }),
					step.check("every section is closed", (s) =>
						["system", "transcript", "tools"].every((n) => !s.content[`${n}Open`]),
					),
					step.check("and the ones in the cards it holds", (s) => {
						const [, call, result] = s.content.messages;
						return !call.inputOpen && !result.contentOpen && !s.content.tools[0].schemaOpen;
					}),
					step.check("and their JSON", (s) => !s.content.messages[1].input.value.open),
					step.send("setSectionsOpen", [true], { at: (b) => b.field("content") }),
					step.check("everything opens", (s) => {
						const [, call] = s.content.messages;
						return s.content.transcriptOpen && call.inputOpen && call.input.value.open;
					}),
				],
			},
		},
		"Inference response": {
			make: editable((C) => inferenceResponse(C)),
			sequences: {
				"it was cut off, then it failed": [
					step.check("wants a tool", (s) => s.content.toJson().stopReason === "toolUse"),
					step.check("the total", (s) => s.content.totalTokens === 450),
					edit,
					step.event("change", '[aria-label="Stop reason"]', { value: "length" }),
					step.check("cut off", (s) => s.content.stopLabel === "Cut off"),
					type("Output tokens", "1024"),
					step.check("the total follows", (s) => s.content.toJson().usage.totalTokens === 1436),
					step.event("change", '[aria-label="Stop reason"]', { value: "error" }),
					type("Error message", "Overloaded"),
					step.check("why it failed", (s) => s.content.toJson().errorMessage === "Overloaded"),
				],
			},
		},
		"Inference response/Final": {
			make: editable((C) => finalResponse(C)),
			sequences: {
				"the answer, mostly read from the cache": [
					step.check("text, and done", (s) => {
						const { content, stopReason } = s.content.toJson();
						return stopReason === "stop" && content[0].text === WEATHER.assistant;
					}),
					step.check("87% from the cache", (s) => s.content.cacheShare === "87%"),
				],
			},
		},
		"JSON Schema editor": {
			make: editable((C) => schemaEditor(C, WEATHER.output.schema)),
			sequences: {
				"read as JSON, then edited as JSON": [
					step.event("click", ".reading-json"),
					step.check("the JSON reading", (s) => s.content.isJson),
					step.event("click", ".collapse-all"),
					step.check("collapsed", (s) => !s.content.json.open),
					edit,
					step.check("no tree while editing", (s) => s.content.isJson),
					...addRequired((b) => b.field("content"), "wind"),
					step.check("the schema follows", (s) => s.content.toSchema().required.includes("wind")),
				],
			},
		},
	},
});

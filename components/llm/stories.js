import { step, stories } from "../../src/storybook/index.js";
import { $if, component, field, pushView, render, send, t, tag } from "../../src/tutuca.js";
import { schemaEditor } from "../json-schema/editor.js";
import {
	assistantMessage,
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
					type("Schema JSON", '{"type": "object", "required": ['),
					step.check("text that isn't JSON keeps the last schema", (s) => {
						const { parameters } = s.content;
						return parameters.hasError && parameters.toSchema().required.join() === "city";
					}),
					type(
						"Schema JSON",
						JSON.stringify({ ...WEATHER.tool.parameters, required: ["city", "unit"] }),
					),
					step.check("now both are required", (s) => {
						const { parameters } = s.content;
						return !parameters.hasError && parameters.toSchema().required.join() === "city,unit";
					}),
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
					type(
						"Schema JSON",
						JSON.stringify({
							...WEATHER.output.schema,
							required: [...WEATHER.output.schema.required, "humidity"],
						}),
					),
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
		"JSON Schema editor": {
			make: editable((C) => schemaEditor(C, WEATHER.output.schema)),
			sequences: {
				"a schema that's just true": [
					edit,
					type("Schema JSON", "true"),
					step.check("anything", (s) => s.content.toSchema() && !s.content.hasError),
					type("Schema JSON", "[]"),
					step.check("an array isn't a schema", (s) => s.content.hasError),
				],
			},
		},
	},
});

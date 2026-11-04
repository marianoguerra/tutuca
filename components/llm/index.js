// The parts of an LLM request and its response, as cards to lay out and explain inference
// with: the system message, user and assistant messages, a tool's definition, a call to it and
// its result, and a structured output checked against its schema. Each shows in its main view
// as it reads in a conversation, and has an edit view, pushed from above (as the canvas's item
// toggle does), that edits it in place: the text in a textarea, the JSON values inline (the
// json components' edit views) and the schemas as JSON text (JsonSchemaEditor).
import {
	$if,
	component,
	DISPLAY_META,
	each,
	field,
	render,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { CANVAS_META } from "../canvas/layout.js";
import { fromJson, jsonRoot } from "../json/index.js";
import { schemaEditor, schemaEditorComponents } from "../json-schema/editor.js";
import { validate } from "./validate.js";

const { div, h3, header, input, label, li, p, section, span, textarea, ul } = tag;

// What each part says of itself (its title, icon and what it's for) and how wide it starts on a
// canvas.
const metaFor = (title, icon, description, width) => ({
	[DISPLAY_META]: { title, icon, description },
	[CANVAS_META]: { width },
});

// About how many tokens text is: a rough rule of thumb of 4 characters to a token, for
// English; a real tokenizer counts differently.
export const approxTokens = (text) => (text === "" ? 0 : Math.max(1, Math.round(text.length / 4)));

const CARD =
	"llm-card flex flex-col gap-2 rounded-md border border-base-300 bg-base-100 p-3 text-sm";
const BADGE = "badge badge-sm badge-soft font-semibold";
const MONO = "font-mono text-sm";
const TEXTAREA = "textarea textarea-bordered textarea-sm min-h-24 w-full text-sm";
const INPUT = "input input-bordered input-sm w-full";
const FIELD_LABEL = "flex flex-col gap-1 text-xs opacity-80";
const PART = "text-xs font-semibold opacity-60";

// A card's header: its badge (role) and what's beside it.
const cardHeader = (badge, badgeClass, ...rest) =>
	header(
		{ class: "flex flex-wrap items-center gap-2" },
		span({ class: `${BADGE} ${badgeClass}` }, badge),
		...rest,
	);
const tokens = () =>
	span({ class: "ml-auto text-xs tabular-nums opacity-50" }, "≈ ", field("tokens"), " tokens");
const labeled = (text, control) => label({ class: FIELD_LABEL }, text, control);

// A message of role: its text, read in main and typed in edit.
const message = (name, role, badge, badgeClass, placeholder, meta) =>
	component({
		name,
		meta,
		fields: { text: t.string() },
		methods: {
			toJson() {
				return { role, content: this.text };
			},
		},
		queries: {
			get tokens() {
				return approxTokens(this.text);
			},
			get isEmpty() {
				return this.text === "";
			},
		},
		view: div(
			{ class: `${CARD} llm-${role}` },
			cardHeader(badge, badgeClass, tokens()),
			$if(
				field("isEmpty"),
				p({ class: "italic opacity-50" }, placeholder),
				p({ class: "whitespace-pre-wrap" }, field("text")),
			),
		),
		views: {
			edit: div(
				{ class: `${CARD} llm-${role}` },
				cardHeader(badge, badgeClass, tokens()),
				textarea({
					class: TEXTAREA,
					"aria-label": `${role} message`,
					placeholder,
					value: field("text"),
					"on:input": send("setText", targetValue()),
				}),
			),
		},
		on: {
			setText: {
				args: [t.string()],
				run(next, [text]) {
					next.text = text;
				},
			},
		},
	});

export const SystemMessage = message(
	"SystemMessage",
	"system",
	"System",
	"badge-warning",
	"How the model should behave, before the conversation starts.",
	metaFor("System message", "⚙️", "How the model should behave.", 420),
);
export const UserMessage = message(
	"UserMessage",
	"user",
	"User",
	"badge-primary",
	"What the user asks.",
	metaFor("User message", "👤", "What the user asks.", 420),
);
export const AssistantMessage = message(
	"AssistantMessage",
	"assistant",
	"Assistant",
	"badge-secondary",
	"What the model answers.",
	metaFor("Assistant message", "🤖", "What the model answers.", 420),
);

// A tool the model may call: its name, what it does, and the schema its input follows.
export const ToolDefinition = component({
	name: "ToolDefinition",
	meta: metaFor("Tool definition", "🧰", "A tool the model may call, and its input's schema.", 460),
	fields: {
		name: t.string(),
		description: t.string(),
		parameters: t.component("JsonSchemaEditor"),
	},
	methods: {
		toJson() {
			return {
				name: this.name,
				description: this.description,
				parameters: this.parameters.toSchema(),
			};
		},
	},
	queries: {
		// The definition goes in the request too: it costs tokens like the messages do.
		get tokens() {
			return approxTokens(JSON.stringify(this.toJson()));
		},
	},
	view: div(
		{ class: `${CARD} llm-tool-definition` },
		cardHeader(
			"Tool",
			"badge-accent",
			span({ class: `${MONO} font-bold` }, field("name")),
			tokens(),
		),
		p({ class: "whitespace-pre-wrap opacity-80" }, field("description")),
		span({ class: PART }, "Input Schema"),
		render(field("parameters")),
	),
	views: {
		edit: div(
			{ class: `${CARD} llm-tool-definition` },
			cardHeader("Tool", "badge-accent", tokens()),
			labeled(
				"Name",
				input({
					class: `${INPUT} font-mono`,
					"aria-label": "Tool name",
					value: field("name"),
					"on:input": send("setName", targetValue()),
				}),
			),
			labeled(
				"Description",
				textarea({
					class: TEXTAREA,
					"aria-label": "Tool description",
					value: field("description"),
					"on:input": send("setDescription", targetValue()),
				}),
			),
			span({ class: PART }, "Input Schema"),
			render(field("parameters")),
		),
	},
	on: {
		setName: {
			args: [t.string()],
			run(next, [name]) {
				next.name = name;
			},
		},
		setDescription: {
			args: [t.string()],
			run(next, [description]) {
				next.description = description;
			},
		},
	},
});

// The model asking to run a tool: which, with what input, and the id its result answers.
export const ToolCall = component({
	name: "ToolCall",
	meta: metaFor("Tool call", "📞", "The model asking to run a tool.", 420),
	fields: {
		id: t.string(),
		name: t.string(),
		input: t.component("JsonRoot"),
	},
	methods: {
		toJson() {
			return { id: this.id, name: this.name, input: this.input.toJson() };
		},
	},
	queries: {
		get tokens() {
			return approxTokens(JSON.stringify(this.toJson()));
		},
	},
	view: div(
		{ class: `${CARD} llm-tool-call` },
		cardHeader(
			"Tool Call",
			"badge-info",
			span({ class: `${MONO} font-bold` }, field("name")),
			span({ class: "font-mono text-xs opacity-50" }, field("id")),
			tokens(),
		),
		render(field("input")),
	),
	views: {
		edit: div(
			{ class: `${CARD} llm-tool-call` },
			cardHeader("Tool Call", "badge-info", tokens()),
			div(
				{ class: "grid grid-cols-2 gap-2" },
				labeled(
					"Tool",
					input({
						class: `${INPUT} font-mono`,
						"aria-label": "Tool name",
						value: field("name"),
						"on:input": send("setName", targetValue()),
					}),
				),
				labeled(
					"Call id",
					input({
						class: `${INPUT} font-mono`,
						"aria-label": "Call id",
						value: field("id"),
						"on:input": send("setId", targetValue()),
					}),
				),
			),
			span({ class: PART }, "Input"),
			render(field("input")),
		),
	},
	on: {
		setName: {
			args: [t.string()],
			run(next, [name]) {
				next.name = name;
			},
		},
		setId: {
			args: [t.string()],
			run(next, [id]) {
				next.id = id;
			},
		},
	},
});

// What running a tool gave back, for the call with callId; isError when it failed.
export const ToolResult = component({
	name: "ToolResult",
	meta: metaFor("Tool result", "📦", "What running the tool gave back.", 420),
	fields: {
		callId: t.string(),
		isError: t.boolean(),
		content: t.component("JsonRoot"),
	},
	methods: {
		toJson() {
			return { callId: this.callId, isError: this.isError, content: this.content.toJson() };
		},
	},
	queries: {
		get tokens() {
			return approxTokens(JSON.stringify(this.toJson()));
		},
		get badgeClass() {
			return this.isError ? `${BADGE} badge-error` : `${BADGE} badge-success`;
		},
		get badge() {
			return this.isError ? "Tool Error" : "Tool Result";
		},
	},
	view: div(
		{ class: `${CARD} llm-tool-result` },
		header(
			{ class: "flex flex-wrap items-center gap-2" },
			span({ class: field("badgeClass") }, field("badge")),
			span({ class: "font-mono text-xs opacity-50" }, "for ", field("callId")),
			tokens(),
		),
		render(field("content")),
	),
	views: {
		edit: div(
			{ class: `${CARD} llm-tool-result` },
			header(
				{ class: "flex flex-wrap items-center gap-2" },
				span({ class: field("badgeClass") }, field("badge")),
				tokens(),
			),
			div(
				{ class: "flex items-end gap-2" },
				labeled(
					"For call id",
					input({
						class: `${INPUT} font-mono`,
						"aria-label": "Call id",
						value: field("callId"),
						"on:input": send("setCallId", targetValue()),
					}),
				),
				label(
					{ class: "flex shrink-0 items-center gap-1 pb-2 text-xs" },
					input({
						type: "checkbox",
						class: "checkbox checkbox-xs",
						"aria-label": "Failed",
						checked: field("isError"),
						"on:change": send("setError", targetValue()),
					}),
					"failed",
				),
			),
			span({ class: PART }, "Content"),
			render(field("content")),
		),
	},
	on: {
		setCallId: {
			args: [t.string()],
			run(next, [callId]) {
				next.callId = callId;
			},
		},
		setError: {
			args: [t.boolean()],
			run(next, [isError]) {
				next.isError = isError;
			},
		},
	},
});

// How a structured output reads: its schema, its output and whether that matches.
const structuredView = () =>
	div(
		{ class: `${CARD} llm-structured-output` },
		cardHeader("Structured Output", "badge-neutral", tokens()),
		section(
			{ class: "flex flex-col gap-1" },
			h3({ class: PART }, "Schema"),
			render(field("schema")),
		),
		section(
			{ class: "flex flex-col gap-1" },
			h3({ class: PART }, "Output"),
			render(field("output")),
		),
		$if(
			field("isValid"),
			p({ class: "llm-valid text-xs text-success" }, "✓ The output matches the schema."),
			div(
				{ class: "llm-invalid flex flex-col gap-1 text-xs text-error" },
				p("✗ The output doesn't match the schema:"),
				ul(
					{ class: "list-disc pl-5" },
					each(field("problems"), li({ class: "font-mono" }, field("text"))),
				),
			),
		),
	);

// An answer constrained to a schema: the schema and the output, checked against it.
export const StructuredOutput = component({
	name: "StructuredOutput",
	meta: metaFor(
		"Structured output",
		"🧾",
		"An answer that follows a schema, checked against it.",
		460,
	),
	fields: {
		schema: t.component("JsonSchemaEditor"),
		output: t.component("JsonRoot"),
	},
	methods: {
		toJson() {
			return this.output.toJson();
		},
	},
	queries: {
		get problems() {
			return validate(this.schema.toSchema(), this.output.toJson()).map(({ path, message }) => ({
				text: `${path} ${message}`,
			}));
		},
		get isValid() {
			return this.problems.length === 0;
		},
		get tokens() {
			return approxTokens(JSON.stringify(this.toJson()));
		},
	},
	view: structuredView(),
	// The same: what edits it are the schema's and the output's own edit views, pushed with it.
	views: { edit: structuredView() },
});

export const llmComponents = {
	...schemaEditorComponents,
	SystemMessage,
	UserMessage,
	AssistantMessage,
	ToolDefinition,
	ToolCall,
	ToolResult,
	StructuredOutput,
};

// A worked example to start from, and to make each kind with: a weather tool, called once.
export const WEATHER = {
	system:
		"You are a helpful assistant. Use the tools you're given when they help, and answer in a sentence or two.",
	user: "What's the weather like in Buenos Aires right now?",
	tool: {
		name: "get_weather",
		description: "Get the current weather in a city.",
		parameters: {
			type: "object",
			properties: {
				city: { type: "string", description: "The city's name, like Buenos Aires." },
				unit: { type: "string", enum: ["celsius", "fahrenheit"] },
			},
			required: ["city"],
		},
	},
	call: { id: "call_1", name: "get_weather", input: { city: "Buenos Aires", unit: "celsius" } },
	result: { temperature: 18, conditions: "partly cloudy" },
	assistant: "It's 18 °C and partly cloudy in Buenos Aires right now.",
	output: {
		schema: {
			type: "object",
			properties: {
				city: { type: "string" },
				temperature: { type: "number" },
				conditions: { type: "string", enum: ["sunny", "partly cloudy", "cloudy", "rainy"] },
			},
			required: ["city", "temperature", "conditions"],
			additionalProperties: false,
		},
		value: { city: "Buenos Aires", temperature: 18, conditions: "partly cloudy" },
	},
};

// Each part of the example, made with C.
export const systemMessage = (C, text = WEATHER.system) => C.SystemMessage({ text });
export const userMessage = (C, text = WEATHER.user) => C.UserMessage({ text });
export const assistantMessage = (C, text = WEATHER.assistant) => C.AssistantMessage({ text });
export const toolDefinition = (C, { name, description, parameters } = WEATHER.tool) =>
	C.ToolDefinition({ name, description, parameters: schemaEditor(C, parameters) });
export const toolCall = (C, { id, name, input } = WEATHER.call) =>
	C.ToolCall({ id, name, input: jsonRoot(C, input) });
export const toolResult = (
	C,
	content = WEATHER.result,
	{ callId = WEATHER.call.id, isError = false } = {},
) => C.ToolResult({ callId, isError, content: jsonRoot(C, content) });
export const structuredOutput = (C, { schema, value } = WEATHER.output) =>
	C.StructuredOutput({ schema: schemaEditor(C, schema), output: jsonRoot(C, value) });

// What a canvas hole can become, in the llm bundle: the parts above, a schema and a JSON value,
// each making its component, which says what it is in its display meta. The JSON ones say
// nothing to a canvas: their kinds give their width.
export const LLM_KINDS = {
	system: { component: "SystemMessage", make: (C) => systemMessage(C) },
	user: { component: "UserMessage", make: (C) => userMessage(C) },
	assistant: { component: "AssistantMessage", make: (C) => assistantMessage(C) },
	toolDefinition: { component: "ToolDefinition", make: (C) => toolDefinition(C) },
	toolCall: { component: "ToolCall", make: (C) => toolCall(C) },
	toolResult: { component: "ToolResult", make: (C) => toolResult(C) },
	structuredOutput: { component: "StructuredOutput", make: (C) => structuredOutput(C) },
	jsonSchema: {
		component: "JsonSchemaEditor",
		width: 420,
		make: (C) => schemaEditor(C, WEATHER.tool.parameters),
	},
	json: {
		component: "JsonEditor",
		width: 420,
		make: (C) => C.JsonEditor({ mode: "view", value: fromJson(C, WEATHER.call.input) }),
	},
};

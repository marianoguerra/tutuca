// The parts of an LLM request and its response, as cards to lay out and explain inference
// with: the system message, user and assistant messages, a tool's definition, a call to it and
// its result, and a structured output checked against its schema. Each shows in its main view
// as it reads in a conversation, and has an edit view, pushed from above (as the canvas's item
// toggle does), that edits it in place: the text in a textarea, the JSON values inline (the
// json components' edit views) and the schemas as JSON text (JsonSchemaEditor).
import {
	$if,
	AGENT_META,
	agentTool,
	component,
	each,
	field,
	render,
	renderIt,
	scopeOf,
	send,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import {
	BADGE,
	cardClass,
	cardHeader,
	INPUT,
	isCount,
	labeled,
	MONO,
	metaFor,
	numberInput,
	removable,
	SMALL_BUTTON,
	sectionFields,
	sectionMessages,
	sectionQueries,
	setNumber,
	TEXTAREA,
	titled,
} from "../common/card.js";
import { fromJson, jsonRoot } from "../json/index.js";
import { schemaEditor, schemaEditorComponents } from "../json-schema/editor.js";
import { MessageGroup, Transcript, TranscriptEntry, transcript } from "./transcript.js";
import { validate } from "./validate.js";

const { button, div, footer, header, input, label, li, option, p, select, span, textarea, ul } =
	tag;

// About how many tokens text is: a rough rule of thumb of 4 characters to a token, for
// English; a real tokenizer counts differently.
export const approxTokens = (text) => (text === "" ? 0 : Math.max(1, Math.round(text.length / 4)));

const CARD = cardClass("llm-card");
const tokens = () =>
	span({ class: "ml-auto text-xs tabular-nums opacity-50" }, "≈ ", field("tokens"), " tokens");

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
		...sectionFields(),
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
		...sectionQueries(["schema"]),
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
		titled("schema", "Input Schema", render(field("parameters"))),
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
			titled("schema", "Input Schema", render(field("parameters"))),
		),
	},
	on: {
		...sectionMessages(["schema"], ["parameters"]),
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
		...sectionFields(),
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
		...sectionQueries(["input"]),
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
			titled("input", "Input", render(field("input"))),
		),
	},
	on: {
		...sectionMessages(["input"], ["input"]),
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
		...sectionFields(),
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
		...sectionQueries(["content"]),
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
			titled("content", "Content", render(field("content"))),
		),
	},
	on: {
		...sectionMessages(["content"], ["content"]),
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
		titled("schema", "Schema", render(field("schema"))),
		titled("output", "Output", render(field("output"))),
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
const STRUCTURED_SECTIONS = ["schema", "output"];
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
		...sectionFields(),
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
		...sectionQueries(STRUCTURED_SECTIONS),
	},
	view: structuredView(),
	// The same: what edits it are the schema's and the output's own edit views, pushed with it.
	views: { edit: structuredView() },
	on: sectionMessages(STRUCTURED_SECTIONS, ["schema", "output"]),
});

// pi-ai's transcript, from the cards: a tool call goes into the content of the assistant
// message before it (or of a new one), as models give them back, and a tool result says the
// name of the tool its call ran.
export const toTranscript = (parts) => {
	const messages = [];
	const toolNames = {};
	for (const part of parts) {
		const kind = specOf(part).name;
		if (kind === "UserMessage") {
			messages.push({ role: "user", content: part.text });
		} else if (kind === "AssistantMessage") {
			messages.push({ role: "assistant", content: [{ type: "text", text: part.text }] });
		} else if (kind === "ToolCall") {
			const { id, name, input: args } = part.toJson();
			toolNames[id] = name;
			const call = { type: "toolCall", id, name, arguments: args };
			const last = messages.at(-1);
			if (last?.role === "assistant") last.content.push(call);
			else messages.push({ role: "assistant", content: [call] });
		} else if (kind === "ToolResult") {
			const { callId, isError, content } = part.toJson();
			const text = typeof content === "string" ? content : JSON.stringify(content);
			messages.push({
				role: "toolResult",
				toolCallId: callId,
				toolName: toolNames[callId] ?? "",
				content: [{ type: "text", text }],
				isError,
			});
		}
	}
	return messages;
};

// The parts a request's transcript can gain, each made empty or from the example.
const TRANSCRIPT_PARTS = {
	user: (C) => userMessage(C, ""),
	assistant: (C) => assistantMessage(C, ""),
	toolCall: (C) => toolCall(C),
	toolResult: (C) => toolResult(C),
};
const addPart = (kind, text) =>
	button(
		{ class: SMALL_BUTTON, title: `Add ${text}`, "on:click": send("addMessage", kind) },
		`+ ${text.replace(/^an? /, "")}`,
	);

const REQUEST_SECTIONS = ["system", "transcript", "tools", "schema"];
// What's sent to the model in one call: the system message, the whole conversation so far,
// the tools it may call and, optionally, a schema its answer must follow. All of it is input:
// every turn sends everything again.
export const InferenceRequest = component({
	name: "InferenceRequest",
	meta: metaFor(
		"Inference request",
		"📤",
		"What's sent to the model in one call: the conversation so far, its tools and options.",
		560,
		{
			[AGENT_META]: {
				prompt:
					"An LLM inference request, to explain or build one: the model, an optional system prompt, the conversation (user and assistant messages, the model's tool calls and their results), the tools the model may call (each a name, description and JSON Schema for its input), an optional schema the answer must follow, and the options. The summary is the request as JSON, about as it's sent.",
				tools: [
					agentTool("set_model", "message", ["model"], "Set the model, provider/id.", {
						target: "setModel",
					}),
					agentTool("set_system", "message", ["text"], "Set the system prompt; null for none."),
					agentTool(
						"add_message",
						"message",
						["role", "text"],
						"Add a user or assistant message at the end.",
					),
					agentTool(
						"add_tool_call",
						"message",
						["id", "name", "input"],
						"Add the model's call of a tool, with its call id and JSON input.",
					),
					agentTool(
						"add_tool_result",
						"message",
						["callId", "content", "isError"],
						"Add what running the call callId gave back.",
					),
					agentTool("remove_message", "message", ["index"], "Remove a message by its index.", {
						target: "removeMessage",
					}),
					agentTool(
						"set_tool",
						"message",
						["name", "description", "parameters"],
						"Define a tool the model may call, replacing one of that name: parameters is its input's JSON Schema.",
					),
					agentTool("remove_tool", "message", ["name"], "Remove the tool of that name."),
					agentTool(
						"set_output_schema",
						"message",
						["schema"],
						"Set the schema the answer must follow; null for none.",
					),
					agentTool(
						"set_options",
						"message",
						["temperature", "maxTokens"],
						"Set the temperature (0 to 2) and max tokens.",
					),
				],
			},
		},
	),
	fields: {
		model: t.string(),
		system: t.option(t.component("SystemMessage")),
		messages: t.array(t.component()),
		tools: t.array(t.component("ToolDefinition")),
		outputSchema: t.option(t.component("JsonSchemaEditor")),
		temperature: t.number().min(0).max(2).default(1),
		maxTokens: t.number().int().min(1).default(1024),
		...sectionFields(),
	},
	methods: {
		// pi-ai's Context ({ systemPrompt, messages, tools }), with the model, its options and,
		// which pi-ai doesn't have, the schema the answer must follow.
		toJson() {
			return {
				model: this.model,
				...(this.system === null ? {} : { systemPrompt: this.system.text }),
				messages: toTranscript(this.messages),
				...(this.tools.length === 0 ? {} : { tools: this.tools.map((tool) => tool.toJson()) }),
				...(this.outputSchema === null ? {} : { outputSchema: this.outputSchema.toSchema() }),
				temperature: this.temperature,
				maxTokens: this.maxTokens,
			};
		},
	},
	queries: {
		get summary() {
			return `${JSON.stringify(this.toJson())}\n(about ${this.tokens} tokens in)`;
		},
		get hasSystem() {
			return this.system !== null;
		},
		get hasTools() {
			return this.tools.length > 0;
		},
		get hasSchema() {
			return this.outputSchema !== null;
		},
		get schemaToggle() {
			return this.hasSchema ? "Answer in free text" : "Answer to a schema";
		},
		get systemToggle() {
			return this.hasSystem ? "Remove the system message" : "Add a system message";
		},
		// Everything in it is input the model reads: the system message, the messages, the
		// tools' definitions and the schema.
		get tokens() {
			const parts = [this.system, ...this.messages, ...this.tools].filter((p) => p !== null);
			const schema =
				this.outputSchema === null ? 0 : approxTokens(JSON.stringify(this.outputSchema.toSchema()));
			return parts.reduce((sum, part) => sum + part.tokens, schema);
		},
		...sectionQueries(REQUEST_SECTIONS),
	},
	view: div(
		{ class: `${CARD} llm-request` },
		cardHeader(
			"Request",
			"badge-primary badge-outline",
			span({ class: `${MONO} font-bold` }, field("model")),
			span(
				{ class: "text-xs opacity-60" },
				"temperature ",
				field("temperature"),
				" · up to ",
				field("maxTokens"),
				" tokens out",
			),
			span(
				{ class: "ml-auto text-xs tabular-nums opacity-50" },
				"≈ ",
				field("tokens"),
				" tokens in",
			),
		),
		$if(field("hasSystem"), titled("system", "System", render(field("system"))), ""),
		titled("transcript", "Transcript", each(field("messages"), renderIt())),
		$if(field("hasTools"), titled("tools", "Tools", each(field("tools"), renderIt())), ""),
		$if(field("hasSchema"), titled("schema", "Answer Schema", render(field("outputSchema"))), ""),
	),
	views: {
		edit: div(
			{ class: `${CARD} llm-request` },
			cardHeader(
				"Request",
				"badge-primary badge-outline",
				span(
					{ class: "ml-auto text-xs tabular-nums opacity-50" },
					"≈ ",
					field("tokens"),
					" tokens in",
				),
			),
			div(
				{ class: "grid grid-cols-3 gap-2" },
				labeled(
					"Model",
					input({
						class: `${INPUT} font-mono`,
						"aria-label": "Model",
						value: field("model"),
						"on:input": send("setModel", targetValue()),
					}),
				),
				labeled("Temperature", numberInput("Temperature", "temperature", "setTemperature")),
				labeled("Max tokens out", numberInput("Max tokens", "maxTokens", "setMaxTokens")),
			),
			$if(field("hasSystem"), titled("system", "System", render(field("system"))), ""),
			button(
				{ class: `${SMALL_BUTTON} self-start`, "on:click": send("toggleSystem") },
				field("systemToggle"),
			),
			titled(
				"transcript",
				"Transcript",
				each(field("messages"), removable("Remove this message", "removeMessage")),
				div(
					{ class: "flex flex-wrap gap-1" },
					addPart("user", "a user message"),
					addPart("assistant", "an assistant message"),
					addPart("toolCall", "a tool call"),
					addPart("toolResult", "a tool result"),
				),
			),
			titled(
				"tools",
				"Tools",
				each(field("tools"), removable("Remove this tool", "removeTool")),
				button(
					{ class: `${SMALL_BUTTON} self-start`, title: "Add a tool", "on:click": send("addTool") },
					"+ tool",
				),
			),
			$if(field("hasSchema"), titled("schema", "Answer Schema", render(field("outputSchema"))), ""),
			button(
				{
					class: `${SMALL_BUTTON} self-start`,
					title: "Toggle the answer schema",
					"on:click": send("toggleSchema"),
				},
				field("schemaToggle"),
			),
		),
	},
	on: {
		...sectionMessages(REQUEST_SECTIONS, ["system", "messages", "tools", "outputSchema"]),
		setModel: {
			args: [t.string()],
			run(next, [model]) {
				next.model = model;
			},
		},
		setTemperature: setNumber("temperature", (n) => n >= 0 && n <= 2),
		setMaxTokens: setNumber("maxTokens", (n) => isCount(n) && n >= 1),
		toggleSystem(next, _args, ctx) {
			next.system = this.system === null ? systemMessage(ctx.scope.components, "") : null;
		},
		toggleSchema(next, _args, ctx) {
			next.outputSchema =
				this.outputSchema === null
					? schemaEditor(ctx.scope.components, WEATHER.output.schema)
					: null;
		},
		addMessage: {
			args: [t.enum(...Object.keys(TRANSCRIPT_PARTS))],
			run(next, [kind], ctx) {
				next.messages.push(TRANSCRIPT_PARTS[kind](ctx.scope.components));
			},
		},
		removeMessage: {
			args: [t.index("messages")],
			run(next, [at]) {
				next.messages.splice(at, 1);
			},
		},
		addTool(next, _args, ctx) {
			next.tools.push(toolDefinition(ctx.scope.components));
		},
		// The agent's: each part made from what it says.
		set_system: {
			pure: true,
			args: [t.option(t.string())],
			run(next, [text]) {
				next.system = text === null ? null : systemMessage(scopeOf(this).components, text);
			},
		},
		add_message: {
			pure: true,
			args: [t.enum("user", "assistant"), t.string()],
			run(next, [role, text]) {
				const C = scopeOf(this).components;
				next.messages.push(role === "user" ? userMessage(C, text) : assistantMessage(C, text));
			},
		},
		add_tool_call: {
			pure: true,
			args: [t.string().len(1), t.string().len(1), t.any()],
			run(next, [id, name, input]) {
				next.messages.push(toolCall(scopeOf(this).components, { id, name, input: input ?? {} }));
			},
		},
		add_tool_result: {
			pure: true,
			args: [t.string().len(1), t.any(), t.boolean()],
			run(next, [callId, content, isError]) {
				next.messages.push(toolResult(scopeOf(this).components, content, { callId, isError }));
			},
		},
		set_tool: {
			pure: true,
			args: [t.string().len(1), t.string(), t.any()],
			pre: (_self, [, , parameters]) => typeof parameters === "object" && parameters !== null,
			why: () => "parameters is a JSON Schema object",
			run(next, [name, description, parameters]) {
				const tool = toolDefinition(scopeOf(this).components, { name, description, parameters });
				const at = this.tools.findIndex((tl) => tl.name === name);
				if (at === -1) next.tools.push(tool);
				else next.tools[at] = tool;
			},
		},
		remove_tool: {
			pure: true,
			args: [t.string()],
			pre: (self, [name]) => self.tools.some((tl) => tl.name === name),
			why: (self, [name]) =>
				`there's no tool ${name}; there are ${self.tools.map((tl) => tl.name).join(", ") || "none"}`,
			run(next, [name]) {
				next.tools = this.tools.filter((tl) => tl.name !== name);
			},
		},
		set_output_schema: {
			pure: true,
			args: [t.any()],
			pre: (_self, [schema]) =>
				schema === null || typeof schema === "object" || typeof schema === "boolean",
			why: () => "a schema is an object or a boolean, or null for none",
			run(next, [schema]) {
				next.outputSchema = schema === null ? null : schemaEditor(scopeOf(this).components, schema);
			},
		},
		set_options: {
			pure: true,
			args: [t.number().min(0).max(2), t.number().int().min(1)],
			run(next, [temperature, maxTokens]) {
				next.temperature = temperature;
				next.maxTokens = maxTokens;
			},
		},
		removeTool: {
			args: [t.index("tools")],
			run(next, [at]) {
				next.tools.splice(at, 1);
			},
		},
	},
});

// Why the model stopped, as pi-ai says it, and what that means for whoever called it.
export const STOP_REASONS = {
	stop: { label: "Done", badge: "badge-success", means: "The model finished its answer." },
	length: {
		label: "Cut off",
		badge: "badge-warning",
		means: "It ran out of max tokens before finishing: the answer is incomplete.",
	},
	toolUse: {
		label: "Wants a tool",
		badge: "badge-info",
		means: "Run the tool calls, then send their results in another request.",
	},
	error: { label: "Error", badge: "badge-error", means: "The call failed." },
	aborted: { label: "Aborted", badge: "badge-neutral", means: "The call was cancelled." },
};
// The usage fields: name, its label, its input's aria-label and the handler that sets it.
const USAGE = [
	["input", "In", "Input tokens", "setInput"],
	["output", "Out", "Output tokens", "setOutput"],
	["cacheRead", "Cache read", "Cache read tokens", "setCacheRead"],
	["cacheWrite", "Cache write", "Cache write tokens", "setCacheWrite"],
];
const usageCell = (name, text) =>
	div(
		{ class: "flex flex-col" },
		span({ class: "text-xs opacity-60" }, text),
		span({ class: "font-mono tabular-nums" }, field(name)),
	);

const RESPONSE_SECTIONS = ["answer", "usage"];
// What comes back from one call: a new assistant turn (its text, tool calls or structured
// output), why the model stopped and how many tokens it took.
export const InferenceResponse = component({
	name: "InferenceResponse",
	meta: metaFor(
		"Inference response",
		"📥",
		"What comes back from one call: the answer, why it stopped and the tokens it took.",
		560,
	),
	fields: {
		model: t.string(),
		content: t.array(t.component()),
		stopReason: t.enum(...Object.keys(STOP_REASONS)),
		errorMessage: t.string(),
		input: t.number().int().min(0),
		output: t.number().int().min(0),
		cacheRead: t.number().int().min(0),
		cacheWrite: t.number().int().min(0),
		...sectionFields(),
	},
	methods: {
		// pi-ai's AssistantMessage, without what's only for bookkeeping (api, provider,
		// timestamps, signatures, cost).
		toJson() {
			const content = this.content.map((part) => {
				const kind = specOf(part).name;
				if (kind === "ToolCall") {
					const { id, name, input: args } = part.toJson();
					return { type: "toolCall", id, name, arguments: args };
				}
				const text = kind === "AssistantMessage" ? part.text : JSON.stringify(part.toJson());
				return { type: "text", text };
			});
			const { input: i, output, cacheRead, cacheWrite, totalTokens } = this;
			return {
				role: "assistant",
				content,
				model: this.model,
				usage: { input: i, output, cacheRead, cacheWrite, totalTokens },
				stopReason: this.stopReason,
				...(this.failed ? { errorMessage: this.errorMessage } : {}),
			};
		},
	},
	queries: {
		get totalTokens() {
			return this.input + this.output + this.cacheRead + this.cacheWrite;
		},
		get failed() {
			return this.stopReason === "error" || this.stopReason === "aborted";
		},
		get stopLabel() {
			return STOP_REASONS[this.stopReason].label;
		},
		get stopBadgeClass() {
			return `${BADGE} ${STOP_REASONS[this.stopReason].badge}`;
		},
		get stopMeans() {
			return STOP_REASONS[this.stopReason].means;
		},
		// How much of what the model read came from the prompt cache, cheaper than input.
		get cacheShare() {
			const read = this.input + this.cacheRead + this.cacheWrite;
			return read === 0 ? "0%" : `${Math.round((100 * this.cacheRead) / read)}%`;
		},
		...sectionQueries(RESPONSE_SECTIONS),
	},
	view: div(
		{ class: `${CARD} llm-response` },
		cardHeader(
			"Response",
			"badge-secondary badge-outline",
			span({ class: `${MONO} font-bold` }, field("model")),
		),
		titled("answer", "Answer", each(field("content"), renderIt())),
		$if(field("failed"), p({ class: "llm-error text-error" }, field("errorMessage")), ""),
		footer(
			{ class: "flex flex-col gap-2 border-t border-base-300 pt-2" },
			div(
				{ class: "flex flex-wrap items-center gap-2" },
				span({ class: field("stopBadgeClass") }, field("stopLabel")),
				span({ class: "font-mono text-xs opacity-50" }, field("stopReason")),
				span({ class: "text-xs opacity-80" }, field("stopMeans")),
			),
			titled(
				"usage",
				"Usage",
				div(
					{ class: "flex flex-wrap gap-4" },
					...USAGE.map(([name, text]) => usageCell(name, text)),
					usageCell("totalTokens", "Total"),
					usageCell("cacheShare", "From cache"),
				),
			),
		),
	),
	views: {
		edit: div(
			{ class: `${CARD} llm-response` },
			cardHeader("Response", "badge-secondary badge-outline"),
			labeled(
				"Model",
				input({
					class: `${INPUT} font-mono`,
					"aria-label": "Model",
					value: field("model"),
					"on:input": send("setModel", targetValue()),
				}),
			),
			titled("answer", "Answer", each(field("content"), renderIt())),
			labeled(
				"Stop reason",
				select(
					{
						class: "select select-bordered select-sm w-full",
						"aria-label": "Stop reason",
						value: field("stopReason"),
						"on:change": send("setStopReason", targetValue()),
					},
					...Object.entries(STOP_REASONS).map(([reason, { label: text }]) =>
						option({ value: reason }, `${text} (${reason})`),
					),
				),
			),
			$if(
				field("failed"),
				labeled(
					"Error message",
					input({
						class: INPUT,
						"aria-label": "Error message",
						value: field("errorMessage"),
						"on:input": send("setErrorMessage", targetValue()),
					}),
				),
				"",
			),
			titled(
				"usage",
				"Usage",
				div(
					{ class: "grid grid-cols-4 gap-2" },
					...USAGE.map(([name, text, aria, set]) => labeled(text, numberInput(aria, name, set))),
				),
			),
		),
	},
	on: {
		...sectionMessages(RESPONSE_SECTIONS, ["content"]),
		setModel: {
			args: [t.string()],
			run(next, [model]) {
				next.model = model;
			},
		},
		setStopReason: {
			args: [t.enum(...Object.keys(STOP_REASONS))],
			run(next, [stopReason]) {
				next.stopReason = stopReason;
			},
		},
		setErrorMessage: {
			args: [t.string()],
			run(next, [errorMessage]) {
				next.errorMessage = errorMessage;
			},
		},
		...Object.fromEntries(USAGE.map(([name, , , set]) => [set, setNumber(name, isCount)])),
	},
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
	InferenceRequest,
	InferenceResponse,
	Transcript,
	TranscriptEntry,
	MessageGroup,
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
	model: "claude-haiku-5-5",
	// What each of the two calls took: the second reads the first's prompt from the cache.
	usage: {
		toolUse: { input: 412, output: 38, cacheRead: 0, cacheWrite: 0 },
		stop: { input: 61, output: 17, cacheRead: 412, cacheWrite: 0 },
	},
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

// The JSON a card holds: a dropped JSON file replaces it.
const droppable = (C, v) => jsonRoot(C, v, { allowDrop: true });

// Each part of the example, made with C.
export const systemMessage = (C, text = WEATHER.system) => C.SystemMessage({ text });
export const userMessage = (C, text = WEATHER.user) => C.UserMessage({ text });
export const assistantMessage = (C, text = WEATHER.assistant) => C.AssistantMessage({ text });
export const toolDefinition = (C, { name, description, parameters } = WEATHER.tool) =>
	C.ToolDefinition({ name, description, parameters: schemaEditor(C, parameters) });
export const toolCall = (C, { id, name, input } = WEATHER.call) =>
	C.ToolCall({ id, name, input: droppable(C, input) });
export const toolResult = (
	C,
	content = WEATHER.result,
	{ callId = WEATHER.call.id, isError = false } = {},
) => C.ToolResult({ callId, isError, content: droppable(C, content) });
export const structuredOutput = (C, { schema, value } = WEATHER.output) =>
	C.StructuredOutput({ schema: schemaEditor(C, schema), output: droppable(C, value) });

// The first call of the example: the question, with the weather tool to answer it with.
// messages makes the transcript, for the calls after it.
export const inferenceRequest = (C, messages = (C) => [userMessage(C)]) =>
	C.InferenceRequest({
		model: WEATHER.model,
		system: systemMessage(C),
		messages: messages(C),
		tools: [toolDefinition(C)],
		outputSchema: null,
		temperature: 1,
		maxTokens: 1024,
	});
// Its answer: a call to the tool, and the model stops to have it run.
export const inferenceResponse = (C) =>
	C.InferenceResponse({
		model: WEATHER.model,
		content: [toolCall(C)],
		stopReason: "toolUse",
		errorMessage: "",
		...WEATHER.usage.toolUse,
	});
// The second call: everything again, plus the call and what running it gave back.
export const followUpRequest = (C) =>
	inferenceRequest(C, (C) => [userMessage(C), toolCall(C), toolResult(C)]);
// Its answer: the text the user reads.
export const finalResponse = (C) =>
	C.InferenceResponse({
		model: WEATHER.model,
		content: [assistantMessage(C)],
		stopReason: "stop",
		errorMessage: "",
		...WEATHER.usage.stop,
	});

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
	request: { component: "InferenceRequest", make: (C) => inferenceRequest(C) },
	response: { component: "InferenceResponse", make: (C) => inferenceResponse(C) },
	transcript: { component: "Transcript", make: (C) => transcript(C) },
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

// The micro-agents app: a launcher (drop a TData file, or start an agent empty or from a
// sample), a picker when several agents match what was dropped, a trust card before an agent
// file is installed, and the shell an open agent works in: its workspace (the agent's root
// component) beside tabs for the chat with a model, its tools, its skills and the TData export.
// What needs the registry, the host or the network (opening, matching, installing, running
// tools, the model) goes through asks (app-asks.js).
import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	render,
	renderEach,
	scopeOf,
	send,
	sourceKey,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { nextAction, stepRequest, textOf, userMessage } from "./core/loop.js";
import { jsonViewArgs, kindBadge, toolCallView, components as uiComponents } from "./ui.js";

const {
	a,
	details,
	div,
	form,
	h1,
	h2,
	h3,
	input,
	kbd,
	label,
	li,
	option,
	p,
	pre,
	section,
	select,
	span,
	summary,
	textarea,
	ul,
} = tag;

const MODES = ["launcher", "choosing", "trust", "active"];
const TABS = ["chat", "tools", "skills", "tdata"];

// --- launcher --------------------------------------------------------------------------------

export const AgentCard = component({
	name: "AgentCard",
	fields: {
		id: t.string(),
		title: t.string(),
		description: t.string(),
		needs: t.string(),
		icon: t.string(),
		samples: t.array(t.string()),
		builtin: t.boolean(),
	},
	queries: {
		get hasSamples() {
			return this.samples.length > 0;
		},
		get origin() {
			return this.builtin ? "built in" : "installed";
		},
	},
	view: div(
		{ class: "card border border-base-300 bg-base-100 p-4 shadow-sm" },
		div(
			{ class: "flex items-start gap-3" },
			span({ class: "text-3xl" }, field("icon")),
			div(
				{ class: "flex min-w-0 flex-1 flex-col gap-1" },
				h3(
					{ class: "font-semibold" },
					field("title"),
					span({ class: "badge badge-ghost badge-sm ml-2" }, field("origin")),
				),
				p({ class: "text-sm opacity-80" }, field("description")),
				p({ class: "text-xs opacity-60" }, "Opens: ", field("needs")),
			),
		),
		div(
			{ class: "mt-3 flex flex-wrap gap-2" },
			button({ class: "btn btn-sm btn-primary", "on:click": send("startEmpty") }, "New"),
			each(
				field("samples"),
				button(
					{ class: "btn btn-sm btn-outline", "on:click": send("startSample", sourceKey()) },
					"Sample: ",
					lookupBind("value"),
				),
			),
			$if(
				field("builtin"),
				"",
				button({ class: "btn btn-sm btn-ghost", "on:click": send("remove") }, "Remove"),
			),
		),
	),
	on: {
		startEmpty: {
			args: [],
			emits: { notify: ["start"] },
			run(_next, _args, ctx) {
				ctx.notify("start", [this.id, "empty"]);
			},
		},
		startSample: {
			args: [t.index("samples")],
			emits: { notify: ["start"] },
			run(_next, [i], ctx) {
				ctx.notify("start", [this.id, this.samples[i]]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeAgent"] },
			run(_next, _args, ctx) {
				ctx.notify("removeAgent", [this.id]);
			},
		},
	},
});

// An agent that matched (or didn't) what was dropped.
export const Choice = component({
	name: "Choice",
	fields: { id: t.string(), title: t.string(), icon: t.string(), detail: t.string() },
	view: button(
		{ class: "btn h-auto justify-start gap-3 py-2 text-left", "on:click": send("pick") },
		span({ class: "text-2xl" }, field("icon")),
		span(
			{ class: "flex flex-col" },
			span({ class: "font-semibold" }, field("title")),
			span({ class: "text-xs font-normal opacity-70" }, field("detail")),
		),
	),
	views: {
		miss: li(
			{ class: "text-sm" },
			span({ class: "font-semibold" }, field("title")),
			" needs ",
			field("detail"),
		),
	},
	on: {
		pick: {
			args: [],
			emits: { notify: ["choose"] },
			run(_next, _args, ctx) {
				ctx.notify("choose", [this.id]);
			},
		},
	},
});

// What the dropped file matched: the agents to open it with, the ones it didn't match and, when
// it is itself an agent, the offer to install it.
export const Picker = component({
	name: "Picker",
	fields: {
		file: t.string(),
		message: t.any(), // The dropped tdata message.
		choices: t.array(t.component("Choice")),
		misses: t.array(t.component("Choice")),
		agent: t.any(), // When the file is an agent: what the trust card shows of it.
	},
	loops: { misses: { view: "miss" } },
	queries: {
		get isAgent() {
			return this.agent !== null;
		},
		get hasChoices() {
			return this.choices.length > 0;
		},
		get headline() {
			if (this.isAgent) return `${this.file} is a micro-agent: ${this.agent.title}`;
			return this.hasChoices ? `Open ${this.file} with…` : `No agent opens ${this.file}`;
		},
	},
	view: section(
		{ class: "card mx-auto flex max-w-2xl flex-col gap-3 border border-base-300 bg-base-100 p-6" },
		h2({ class: "text-lg font-semibold" }, field("headline")),
		$if(
			field("isAgent"),
			button({ class: "btn btn-primary self-start", "on:click": send("install") }, "Install…"),
			"",
		),
		div({ class: "flex flex-col gap-2" }, renderEach(field("choices"))),
		details(
			{ class: "collapse collapse-arrow border border-base-300" },
			summary({ class: "collapse-title text-sm" }, "Agents that don't open it"),
			ul({ class: "collapse-content list-disc pl-6" }, renderEach(field("misses"), "misses")),
		),
		button({ class: "btn btn-ghost self-start", "on:click": send("cancel") }, "Back"),
	),
	on: {
		install: {
			args: [],
			emits: { notify: ["reviewInstall"] },
			run(_next, _args, ctx) {
				ctx.notify("reviewInstall");
			},
		},
		cancel: {
			args: [],
			emits: { notify: ["backToLauncher"] },
			run(_next, _args, ctx) {
				ctx.notify("backToLauncher");
			},
		},
	},
});

// Before an agent file is installed: what it contains, and that its code runs in this page.
export const TrustCard = component({
	name: "TrustCard",
	fields: {
		title: t.string(),
		id: t.string(),
		version: t.string(),
		needs: t.string(),
		tools: t.array(t.string()),
		moduleSize: t.number(),
		replaces: t.string(), // The version of the installed agent it replaces, "" if none.
	},
	queries: {
		get toolList() {
			return this.tools.join(", ") || "none";
		},
		get sizeText() {
			return `${(this.moduleSize / 1024).toFixed(1)} KB of JavaScript`;
		},
		get replacing() {
			return this.replaces !== "";
		},
	},
	view: section(
		{ class: "card mx-auto flex max-w-2xl flex-col gap-3 border border-warning bg-base-100 p-6" },
		h2({ class: "text-lg font-semibold" }, "Install ", field("title"), "?"),
		p(
			{ class: "text-sm" },
			span({ class: "font-mono" }, field("id")),
			" version ",
			field("version"),
		),
		p({ class: "text-sm" }, "Opens: ", field("needs")),
		p({ class: "text-sm" }, "Tools: ", span({ class: "font-mono" }, field("toolList"))),
		$if(
			field("replacing"),
			p(
				{ class: "text-sm text-warning" },
				"Replaces the installed version ",
				field("replaces"),
				".",
			),
			"",
		),
		p(
			{ class: "alert alert-warning text-sm" },
			"Its module (",
			field("sizeText"),
			") runs in this page with the page's access. Install agents only from people you trust.",
		),
		div(
			{ class: "flex gap-2" },
			button({ class: "btn btn-warning", "on:click": send("confirm") }, "Install"),
			button({ class: "btn btn-ghost", "on:click": send("cancel") }, "Cancel"),
		),
	),
	on: {
		confirm: {
			args: [],
			emits: { notify: ["confirmInstall"] },
			run(_next, _args, ctx) {
				ctx.notify("confirmInstall");
			},
		},
		cancel: {
			args: [],
			emits: { notify: ["backToLauncher"] },
			run(_next, _args, ctx) {
				ctx.notify("backToLauncher");
			},
		},
	},
});

// --- the shell -------------------------------------------------------------------------------

// A tool, run by hand with JSON arguments.
export const ToolCard = component({
	name: "ToolCard",
	fields: {
		sessionId: t.string(),
		name: t.string(),
		kind: t.string(),
		description: t.string(),
		schemaText: t.string(),
		argsText: t.string(),
		resultText: t.string(),
		isError: t.boolean(),
		running: t.boolean(),
		schema: t.option(t.component("JsonView")),
		result: t.option(t.component("JsonView")),
	},
	queries: {
		get hasResult() {
			return this.result !== null;
		},
		get hasSchema() {
			return this.schema !== null;
		},
		get kindClass() {
			return kindBadge(this.kind);
		},
	},
	view: details(
		{ class: "collapse collapse-arrow border border-base-300" },
		summary(
			{ class: "collapse-title flex items-center gap-2 text-sm" },
			span({ class: field("kindClass") }, field("kind")),
			span({ class: "font-mono font-semibold" }, field("name")),
		),
		div(
			{ class: "collapse-content flex flex-col gap-2" },
			p({ class: "text-sm opacity-80" }, field("description")),
			$if(field("hasSchema"), render(field("schema")), ""),
			textarea({
				class: "textarea textarea-bordered font-mono text-xs",
				rows: 2,
				"aria-label": "Arguments as JSON",
				value: field("argsText"),
				"on:input": send("setArgs", targetValue()),
			}),
			button(
				{ class: "btn btn-sm self-start", disabled: field("running"), "on:click": send("run") },
				"Run",
			),
			$if(field("hasResult"), render(field("result")), ""),
		),
	),
	on: {
		setArgs: {
			args: [t.string()],
			run(next, [text]) {
				next.argsText = text;
			},
		},
		run: {
			args: [],
			emits: { ask: ["runTool"] },
			run(next, _args, ctx) {
				let args;
				try {
					args = JSON.parse(this.argsText || "{}");
				} catch (error) {
					showResult(next, ctx, `The arguments aren't JSON: ${error.message}`, true);
					return;
				}
				next.running = true;
				ctx.ask("runTool", [
					this.sessionId,
					{ type: "toolCall", id: `manual-${ctx.uuid()}`, name: this.name, arguments: args },
				]);
			},
		},
	},
	answers: {
		runTool: {
			ok(next, [result], ctx) {
				next.running = false;
				showResult(next, ctx, result.content.map((b) => b.text ?? "").join("\n"), result.isError);
			},
			error(next, [error], ctx) {
				next.running = false;
				showResult(next, ctx, String(error?.message ?? error), true);
			},
			unhandled(next) {
				next.running = false;
			},
		},
	},
});
// A tool card's result, shown in a JsonView (raw when it isn't JSON).
const showResult = (next, ctx, text, isError) => {
	next.resultText = text;
	next.isError = isError;
	next.result = ctx.scope.make(
		"JsonView",
		jsonViewArgs(text, { label: isError ? "Error" : "Result" }),
	);
};

// A message in the chat: the user's, the model's text, or an error.
const BUBBLE_KINDS = ["user", "assistant", "error"];
export const ChatBubble = component({
	name: "ChatBubble",
	fields: { kind: t.enum(...BUBBLE_KINDS), title: t.string(), text: t.string() },
	queries: {
		get cls() {
			return this.kind === "user" ? "chat chat-end" : "chat chat-start";
		},
		get bubble() {
			return BUBBLE[this.kind];
		},
	},
	view: div(
		{ class: field("cls") },
		div({ class: "chat-header text-xs opacity-60" }, field("title")),
		div({ class: field("bubble") }, field("text")),
	),
});

const BUBBLE = {
	user: "chat-bubble chat-bubble-primary whitespace-pre-wrap",
	assistant: "chat-bubble whitespace-pre-wrap",
	call: "chat-bubble chat-bubble-info font-mono text-xs whitespace-pre-wrap",
	result: "chat-bubble font-mono text-xs whitespace-pre-wrap max-h-48 overflow-auto",
	error:
		"chat-bubble chat-bubble-error font-mono text-xs whitespace-pre-wrap max-h-48 overflow-auto",
};
// Goes on with the loop after the transcript grew: the model's next step, the next tool call
// (one at a time), or the user's turn. self is the AgentShell as it is, next its draft.
const advance = (self, next, ctx, transcript) => {
	const action = nextAction(transcript);
	if (action.kind === "complete") {
		next.chat.status = "thinking…";
		ctx.ask("infer", [self.sessionId, self.request(transcript)]);
	} else if (action.kind === "tools") {
		next.chat.status = `running ${action.calls[0].name}…`;
		ctx.ask("runTool", [self.sessionId, action.calls[0]]);
	} else {
		next.chat.busy = false;
		next.chat.status = action.reason;
	}
};
// The typed message, sent: the model's turn starts (through the step notification).
const sendInput = (self, next, ctx) => {
	if (!self.canSend) return;
	const text = self.input.trim();
	next.transcript.push(userMessage(text, ctx.now()));
	next.entries.push(ctx.scope.make("ChatBubble", { kind: "user", title: "you", text }));
	next.input = "";
	next.busy = true;
	next.status = "thinking…";
	ctx.notify("step");
};

// The conversation with the model: the transcript, the model and the input. The AgentShell it is
// in runs the agent loop (loop.js) on it; send and stop tell the shell.
export const ChatPanel = component({
	name: "ChatPanel",
	fields: {
		transcript: t.array(t.any()),
		// What the chat shows of it: ChatBubbles and tool calls (ToolCall, or the agent's own
		// component for that tool).
		entries: t.array(t.component()),
		models: t.array(t.any()),
		model: t.string(),
		input: t.string(),
		busy: t.boolean(),
		status: t.string(),
		checked: t.boolean(), // Whether the models were asked for.
	},
	queries: {
		get hasModels() {
			return this.models.length > 0;
		},
		get noModels() {
			return this.checked && this.models.length === 0;
		},
		get modelOptions() {
			return this.models.map((m) => ({
				value: `${m.provider}/${m.id}`,
				label: `${m.name} (${m.provider})`,
			}));
		},
		// The label over the loading bubble, where the model's next message will appear.
		get busyLabel() {
			return this.status || "thinking…";
		},
		// The status once the loop stopped (an error, the step limit); while it runs it's in the
		// loading bubble.
		get idleStatus() {
			return this.busy ? "" : this.status;
		},
		get canSend() {
			return !this.busy && this.model !== "" && this.input.trim() !== "";
		},
		get cantSend() {
			return !this.canSend;
		},
	},
	view: div(
		{ class: "flex h-full flex-col gap-2" },
		$if(
			field("noModels"),
			p(
				{ class: "alert text-sm" },
				"No models: run the page from the micro-agents server (",
				span({ class: "font-mono" }, "just microagents"),
				") with an API key in .env. The Tools tab works without one.",
			),
			"",
		),
		$if(
			field("hasModels"),
			select(
				{
					class: "select select-sm select-bordered",
					"aria-label": "Model",
					value: field("model"),
					"on:change": send("setModel", targetValue()),
				},
				each(field("modelOptions"), option({ value: field("value") }, field("label"))),
			),
			"",
		),
		div(
			{ class: "flex min-h-48 flex-1 flex-col overflow-auto" },
			renderEach(field("entries")),
			$if(
				field("busy"),
				div(
					{ class: "chat chat-start" },
					div({ class: "chat-header text-xs opacity-60" }, field("busyLabel")),
					div({ class: "chat-bubble" }, span({ class: "loading loading-dots loading-sm" })),
				),
				"",
			),
		),
		p({ class: "text-xs opacity-70" }, field("idleStatus")),
		form(
			{ class: "flex flex-col gap-1", "on:submit": send("send") },
			textarea({
				class: "textarea textarea-bordered w-full text-sm",
				rows: 3,
				placeholder: "Ask the agent…",
				"aria-label": "Message",
				value: field("input"),
				"on:input": send("setInput", targetValue()),
				"on:keydown": send("inputKey"),
			}),
			div(
				{ class: "flex items-center gap-2" },
				span(
					{ class: "flex-1 text-xs opacity-60" },
					kbd({ class: "kbd kbd-xs" }, "Ctrl"),
					" + ",
					kbd({ class: "kbd kbd-xs" }, "Enter"),
					" to send",
				),
				$if(
					field("busy"),
					button({ class: "btn btn-sm btn-ghost", "on:click": send("stop") }, "Stop"),
					"",
				),
				button(
					{ type: "submit", class: "btn btn-sm btn-primary px-6", disabled: field("cantSend") },
					"Send",
				),
			),
		),
	),
	on: {
		checkModels: {
			args: [],
			emits: { ask: ["llmModels"] },
			run(_next, _args, ctx) {
				ctx.ask("llmModels", []);
			},
		},
		setModel: {
			args: [t.string()],
			emits: { ask: ["rememberModel"] },
			run(next, [model], ctx) {
				next.model = model;
				ctx.ask("rememberModel", [model]);
			},
		},
		setInput: {
			args: [t.string()],
			run(next, [text]) {
				next.input = text;
			},
		},
		send: {
			args: [],
			emits: { notify: ["step"] },
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				sendInput(this, next, ctx);
			},
		},
		// Ctrl+Enter (Cmd+Enter on a Mac) in the message sends it.
		inputKey: {
			args: [],
			emits: { notify: ["step"] },
			run(next, _args, ctx) {
				const e = ctx.event;
				if (e?.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				sendInput(this, next, ctx);
			},
		},
		stop: {
			args: [],
			emits: { notify: ["stopStep"] },
			run(next, _args, ctx) {
				next.busy = false;
				next.status = "stopped";
				ctx.notify("stopStep");
			},
		},
	},
	answers: {
		llmModels: {
			ok(next, [{ models, remembered }]) {
				next.checked = true;
				next.models = models;
				const ids = models.map((m) => `${m.provider}/${m.id}`);
				next.model = ids.includes(remembered) ? remembered : (ids[0] ?? "");
			},
			error(next) {
				next.checked = true;
			},
			unhandled(next) {
				next.checked = true;
			},
		},
		rememberModel: { ok() {}, error() {}, unhandled() {} },
	},
});

// An open agent, a session of its own: its workspace beside the chat, tools, skills and export
// tabs. It holds everything a step of the model needs (the transcript, the model, its standing
// prompt, its tools and the data) and runs the agent loop, sending all of it with every step:
// the server remembers nothing, so any number of sessions can run at once.
// The chat entries for an assistant message: its text, a tool call view per call (still
// running), and its error. self is the AgentShell, C the components to make them with.
const entriesOf = (self, C, message) => {
	const out = [];
	const text = textOf(message);
	if (text !== "")
		out.push(C.ChatBubble({ kind: "assistant", title: message.model ?? "model", text }));
	for (const call of message.content.filter((b) => b.type === "toolCall"))
		out.push(self.callView(C, call, null));
	if (message.stopReason === "error") {
		out.push(
			C.ChatBubble({
				kind: "error",
				title: "error",
				text: message.errorMessage ?? "the model failed",
			}),
		);
	}
	return out;
};
// The tool call view waiting for result gets it (the generic one also its result view).
const showToolResult = (self, next, C, result) => {
	const i = self.chat.entries.findIndex((e) => e.call?.id === result.toolCallId);
	if (i < 0) {
		next.chat.entries.push(
			self.callView(
				C,
				{ type: "toolCall", id: result.toolCallId, name: result.toolName, arguments: {} },
				result,
			),
		);
		return;
	}
	const entry = self.chat.entries[i];
	if (specOf(entry)?.name === "ToolCall")
		next.chat.entries[i] = toolCallView(C, entry.call, result, entry.kind);
	else next.chat.entries[i].result = result;
};

// The chat entries for a whole transcript (a chat opened with one), with C.
export const entriesFor = (C, transcript, kindOf = () => "message") => {
	const shell = {
		callView: (C2, call, result) => toolCallView(C2, call, result, kindOf(call.name)),
	};
	const entries = [];
	for (const m of transcript) {
		if (m.role === "user")
			entries.push(C.ChatBubble({ kind: "user", title: "you", text: textOf(m) }));
		else if (m.role === "assistant") entries.push(...entriesOf(shell, C, m));
		else if (m.role === "toolResult") {
			const i = entries.findIndex((e) => e.call?.id === m.toolCallId);
			if (i >= 0) entries[i] = toolCallView(C, entries[i].call, m, entries[i].kind);
		}
	}
	return entries;
};

export const AgentShell = component({
	name: "AgentShell",
	fields: {
		sessionId: t.string(),
		agentId: t.string(),
		title: t.string(),
		icon: t.string(),
		source: t.string(), // Where the data came from: a file name or a sample.
		original: t.any(), // The tdata message it was opened from, for a lossless export.
		workspace: t.component(),
		tab: t.enum(...TABS),
		chat: t.component("ChatPanel"),
		tools: t.array(t.component("ToolCard")),
		skills: t.map(t.string()),
		skillPath: t.string(),
		exportText: t.string(),
		prompt: t.string(), // The standing system prompt: the agent's, its skills and tools.
		toolSpecs: t.array(t.any()), // The tools the model is offered, in pi-ai's shape.
		toolViews: t.map(t.string()), // Tool name → the agent's component that shows its calls.
		exportView: t.option(t.component("JsonView")),
	},
	methods: {
		// The view of a tool call (result null while it runs): the agent's component for the tool,
		// made in its scope, or the generic ToolCall.
		callView(C, call, result) {
			const kind = this.tools.find((x) => x.name === call.name)?.kind ?? "message";
			const custom = this.toolViews[call.name];
			const scope = scopeOf(this.workspace);
			if (custom !== undefined && scope?.lookupByName(custom))
				return scope.make(custom, { call, result, kind });
			return toolCallView(C, call, result, kind);
		},
		// The inference step for transcript, with the data as it is now.
		request(transcript) {
			return stepRequest({
				model: this.chat.model,
				prompt: this.prompt,
				root: this.workspace,
				tools: this.toolSpecs,
				transcript,
			});
		},
	},
	queries: {
		get hasExport() {
			return this.exportView !== null;
		},
		get skillPaths() {
			return Object.keys(this.skills).map((path) => ({
				path,
				cls: path === this.skillPath ? "btn btn-xs btn-active" : "btn btn-xs btn-ghost",
			}));
		},
		get skillText() {
			return this.skills[this.skillPath] ?? "";
		},
		get tabs() {
			const names = { chat: "Chat", tools: "Tools", skills: "Skills", tdata: "TData" };
			return TABS.map((id) => ({
				id,
				label: names[id],
				cls: `tab ${id === this.tab ? "tab-active" : ""}`,
			}));
		},
		get onChat() {
			return this.tab === "chat";
		},
		get onTools() {
			return this.tab === "tools";
		},
		get onSkills() {
			return this.tab === "skills";
		},
		get onTData() {
			return this.tab === "tdata";
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			span({ class: "text-2xl" }, field("icon")),
			h1({ class: "text-xl font-semibold" }, field("title")),
			span({ class: "badge badge-ghost" }, field("source")),
			span({ class: "flex-1" }),
			button({ class: "btn btn-sm", "on:click": send("close") }, "Close"),
		),
		div(
			{ class: "grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]" },
			div(
				{ class: "card min-w-0 border border-base-300 bg-base-100 p-4" },
				render(field("workspace")),
			),
			div(
				{ class: "card flex min-w-0 flex-col gap-3 border border-base-300 bg-base-100 p-4" },
				div(
					{ role: "tablist", class: "tabs tabs-bordered" },
					each(
						field("tabs"),
						a(
							{ role: "tab", class: field("cls"), "on:click": send("setTab", sourceKey()) },
							field("label"),
						),
					),
				),
				$if(field("onChat"), render(field("chat")), ""),
				$if(
					field("onTools"),
					div({ class: "flex flex-col gap-2" }, renderEach(field("tools"))),
					"",
				),
				$if(
					field("onSkills"),
					div(
						{ class: "flex flex-col gap-2" },
						div(
							{ class: "flex flex-wrap gap-1" },
							each(
								field("skillPaths"),
								button(
									{ class: field("cls"), "on:click": send("setSkill", sourceKey()) },
									field("path"),
								),
							),
						),
						pre(
							{
								class:
									"max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-base-200 p-3 text-sm",
							},
							field("skillText"),
						),
					),
					"",
				),
				$if(
					field("onTData"),
					div(
						{ class: "flex flex-col gap-2" },
						div(
							{ class: "flex flex-wrap gap-2" },
							button({ class: "btn btn-sm", "on:click": send("preview") }, "Preview"),
							button(
								{ class: "btn btn-sm btn-primary", "on:click": send("download", "json") },
								"Download JSON",
							),
							button(
								{ class: "btn btn-sm", "on:click": send("download", "cbor") },
								"Download CBOR",
							),
						),
						$if(field("hasExport"), render(field("exportView")), ""),
					),
					"",
				),
			),
		),
	),
	on: {
		setTab: {
			args: [
				t
					.number()
					.int()
					.min(0)
					.max(TABS.length - 1),
			],
			emits: { ask: ["exportData"] },
			run(next, [i], ctx) {
				const tab = TABS[i];
				next.tab = tab;
				if (tab === "tdata") ctx.ask("exportData", [this.sessionId, "preview"]);
			},
		},
		setSkill: {
			args: [t.number().int().min(0)],
			run(next, [i]) {
				next.skillPath = Object.keys(this.skills)[i] ?? "";
			},
		},
		preview: {
			args: [],
			emits: { ask: ["exportData"] },
			run(_next, _args, ctx) {
				ctx.ask("exportData", [this.sessionId, "preview"]);
			},
		},
		download: {
			args: [t.enum("json", "cbor")],
			emits: { ask: ["exportData"] },
			run(_next, [format], ctx) {
				ctx.ask("exportData", [this.sessionId, format]);
			},
		},
		close: {
			args: [],
			emits: { notify: ["closeSession"] },
			run(_next, _args, ctx) {
				ctx.notify("closeSession", [this.sessionId]);
			},
		},
		// From the chat, once the user's message is in the transcript.
		step: {
			args: [],
			emits: { ask: ["infer"] },
			run(_next, _args, ctx) {
				ctx.ask("infer", [this.sessionId, this.request(this.chat.transcript)]);
			},
		},
		stopStep: {
			args: [],
			emits: { ask: ["abortInfer"] },
			run(_next, _args, ctx) {
				ctx.ask("abortInfer", [this.sessionId]);
			},
		},
	},
	answers: {
		// The message to append; a step stopped meanwhile is dropped.
		infer: {
			ok(next, [message], ctx) {
				if (!this.chat.busy) return;
				next.chat.transcript.push(message);
				next.chat.entries.push(...entriesOf(this, ctx.scope.components, message));
				advance(this, next, ctx, [...this.chat.transcript, message]);
			},
			error(next, [error]) {
				if (!this.chat.busy) return;
				next.chat.busy = false;
				next.chat.status = `the model failed: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.chat.busy = false;
				next.chat.status = "this page has no model";
			},
		},
		runTool: {
			ok(next, [result], ctx) {
				if (!this.chat.busy) return;
				next.chat.transcript.push(result);
				showToolResult(this, next, ctx.scope.components, result);
				advance(this, next, ctx, [...this.chat.transcript, result]);
			},
			error(next, [error]) {
				next.chat.busy = false;
				next.chat.status = `the tool failed: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.chat.busy = false;
			},
		},
		abortInfer: { ok() {}, error() {}, unhandled() {} },
		exportData: {
			ok(next, [text], ctx) {
				next.exportText = text;
				next.exportView = ctx.scope.make("JsonView", jsonViewArgs(text, { label: "TData" }));
			},
			error(next, [error], ctx) {
				next.exportText = `The export failed: ${error?.message ?? error}`;
				next.exportView = ctx.scope.make(
					"JsonView",
					jsonViewArgs(next.exportText, { label: "Error", mode: "raw" }),
				);
			},
			unhandled() {},
		},
	},
});

// --- the app ---------------------------------------------------------------------------------

// Opens shell in a new tab and shows it.
const addSession = (next, shell) => {
	next.sessions[shell.sessionId] = shell;
	next.order.push(shell.sessionId);
	next.current = shell.sessionId;
	next.mode = "active";
	next.picker = null;
	next.trust = null;
};

export const MicroAgentApp = component({
	name: "MicroAgentApp",
	fields: {
		mode: t.enum(...MODES),
		agents: t.array(t.component("AgentCard")),
		picker: t.option(t.component("Picker")),
		trust: t.option(t.component("TrustCard")),
		// The open agents, each a session of its own, by session id; order is the tabs' order and
		// current the one shown when mode is "active".
		sessions: t.map(t.component("AgentShell")),
		order: t.array(t.string()),
		current: t.string(),
		pasteText: t.string(),
		notice: t.string(),
		error: t.string(),
	},
	queries: {
		get onLauncher() {
			return this.mode === "launcher";
		},
		get onPicker() {
			return this.mode === "choosing";
		},
		get onTrust() {
			return this.mode === "trust";
		},
		get onShell() {
			return this.mode === "active";
		},
		get hasTabs() {
			return this.order.length > 0;
		},
		get launcherTabClass() {
			return `tab ${this.mode === "active" ? "" : "tab-active"}`;
		},
		get tabs() {
			return this.order.map((id) => {
				const shell = this.sessions[id];
				return {
					label: `${shell.icon} ${shell.title}${shell.chat.busy ? " …" : ""}`,
					cls: `tab ${this.mode === "active" && id === this.current ? "tab-active" : ""}`,
				};
			});
		},
		get hasError() {
			return this.error !== "";
		},
		get hasNotice() {
			return this.notice !== "";
		},
	},
	loops: {
		// Only the session shown; the others keep running, they just aren't rendered.
		shown: {
			iter(sessions) {
				const shell = sessions[this.current];
				return shell === undefined ? [] : [[this.current, shell]];
			},
		},
	},
	invariants: {
		orderHasEverySession() {
			const ids = Object.keys(this.sessions);
			return ids.length === this.order.length && this.order.every((id) => id in this.sessions);
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		$if(
			field("hasTabs"),
			div(
				{ role: "tablist", class: "tabs tabs-lifted" },
				a(
					{ role: "tab", class: field("launcherTabClass"), "on:click": send("showLauncher") },
					"＋ Agents",
				),
				each(
					field("tabs"),
					a(
						{ role: "tab", class: field("cls"), "on:click": send("focus", sourceKey()) },
						field("label"),
					),
				),
			),
			"",
		),
		$if(field("hasError"), p({ class: "alert alert-error text-sm" }, field("error")), ""),
		$if(field("hasNotice"), p({ class: "alert alert-success text-sm" }, field("notice")), ""),
		$if(
			field("onLauncher"),
			div(
				{ class: "flex flex-col gap-4" },
				div(
					{
						class:
							"flex flex-col items-center gap-3 rounded-box border-2 border-dashed border-base-300 p-8 text-center data-[draggingover]:border-primary data-[draggingover]:bg-primary/10",
						"on:drop": send("dropFile"),
					},
					p(
						{ class: "text-lg" },
						"Drop a TData file here (.json or .cbor): a data file opens with the agents that understand it, an agent file installs that agent.",
					),
					label(
						{ class: "btn btn-sm" },
						"Choose a file",
						input({
							type: "file",
							class: "hidden",
							accept: ".json,.cbor,.tdata",
							"on:change": send("pickFile"),
						}),
					),
					details(
						{ class: "w-full max-w-2xl text-left" },
						summary({ class: "cursor-pointer text-sm opacity-70" }, "or paste TData JSON"),
						textarea({
							class: "textarea textarea-bordered mt-2 h-32 w-full font-mono text-xs",
							"aria-label": "TData JSON",
							value: field("pasteText"),
							"on:input": send("setPaste", targetValue()),
						}),
						button({ class: "btn btn-sm mt-2", "on:click": send("openPaste") }, "Open"),
					),
				),
				h2({ class: "text-sm font-semibold uppercase opacity-60" }, "Agents"),
				div({ class: "grid gap-3 md:grid-cols-2 xl:grid-cols-3" }, renderEach(field("agents"))),
			),
			"",
		),
		$if(field("onPicker"), render(field("picker")), ""),
		$if(field("onTrust"), render(field("trust")), ""),
		$if(field("onShell"), renderEach(field("sessions"), "shown"), ""),
	),
	on: {
		// From the host once the agents are registered.
		setAgents: {
			args: [t.array(t.component("AgentCard"))],
			run(next, [agents]) {
				next.agents = agents;
			},
		},
		setPaste: {
			args: [t.string()],
			run(next, [text]) {
				next.pasteText = text;
			},
		},
		openPaste: {
			args: [],
			emits: { ask: ["dropped"] },
			run(next, _args, ctx) {
				next.error = "";
				ctx.ask("dropped", [{ name: "pasted TData", text: this.pasteText }]);
			},
		},
		dropFile: {
			args: [],
			emits: { ask: ["dropped"] },
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				const file = ctx.event?.dataTransfer?.files?.[0];
				next.error = "";
				if (file !== undefined) ctx.ask("dropped", [file]);
			},
		},
		pickFile: {
			args: [],
			emits: { ask: ["dropped"] },
			run(next, _args, ctx) {
				const file = ctx.event?.target?.files?.[0];
				next.error = "";
				if (file !== undefined) ctx.ask("dropped", [file]);
			},
		},
		// From an agent card: open the agent with one of its samples.
		start: {
			args: [t.string(), t.string()],
			emits: { ask: ["openAgent"] },
			run(next, [id, sample], ctx) {
				next.error = "";
				next.notice = "";
				ctx.ask("openAgent", [id, sample]);
			},
		},
		choose: {
			args: [t.string()],
			emits: { ask: ["openWith"] },
			run(_next, [id], ctx) {
				ctx.ask("openWith", [id, this.picker.message, this.picker.file]);
			},
		},
		reviewInstall: {
			args: [],
			run(next, _args, ctx) {
				next.trust = ctx.scope.make("TrustCard", this.picker.agent);
				next.mode = "trust";
			},
		},
		confirmInstall: {
			args: [],
			emits: { ask: ["installAgent"] },
			run(_next, _args, ctx) {
				ctx.ask("installAgent", [this.picker.message]);
			},
		},
		removeAgent: {
			args: [t.string()],
			emits: { ask: ["uninstallAgent"] },
			run(_next, [id], ctx) {
				ctx.ask("uninstallAgent", [id]);
			},
		},
		showLauncher: {
			args: [],
			run(next) {
				next.mode = "launcher";
			},
		},
		focus: {
			args: [t.number().int().min(0)],
			run(next, [i]) {
				const id = this.order[i];
				if (id === undefined) return;
				next.current = id;
				next.mode = "active";
				next.picker = null;
				next.trust = null;
			},
		},
		// From a picker or trust card.
		backToLauncher: {
			args: [],
			run(next) {
				next.mode = "launcher";
				next.picker = null;
				next.trust = null;
			},
		},
		// From an AgentShell: its step in flight is aborted; the tab beside it, or the launcher,
		// is shown if it was.
		closeSession: {
			args: [t.string()],
			emits: { ask: ["abortInfer"] },
			run(next, [id], ctx) {
				const i = this.order.indexOf(id);
				if (i < 0) return;
				ctx.ask("abortInfer", [id]);
				delete next.sessions[id];
				next.order.splice(i, 1);
				if (this.current !== id) return;
				const neighbor = next.order[i] ?? next.order[i - 1];
				next.current = neighbor ?? "";
				if (neighbor === undefined) next.mode = "launcher";
			},
		},
	},
	answers: {
		// What a dropped file is: { shell } to open, or { picker } to choose from.
		dropped: {
			ok(next, [outcome]) {
				if (outcome.shell !== undefined) addSession(next, outcome.shell);
				else {
					next.picker = outcome.picker;
					next.mode = "choosing";
				}
			},
			error(next, [error]) {
				next.error = `That file can't be read as TData: ${error?.message ?? error}`;
			},
			unhandled() {},
		},
		openAgent: {
			ok(next, [shell]) {
				addSession(next, shell);
			},
			error(next, [error]) {
				next.error = `The agent didn't open: ${error?.message ?? error}`;
			},
			unhandled() {},
		},
		openWith: {
			ok(next, [shell]) {
				addSession(next, shell);
			},
			error(next, [error]) {
				next.error = `The agent didn't open the file: ${error?.message ?? error}`;
			},
			unhandled() {},
		},
		installAgent: {
			ok(next, [{ agents, title }]) {
				next.agents = agents;
				next.notice = `Installed ${title}.`;
				next.mode = "launcher";
				next.picker = null;
				next.trust = null;
			},
			error(next, [error]) {
				next.error = `The agent didn't install: ${error?.message ?? error}`;
				next.mode = "launcher";
			},
			unhandled() {},
		},
		uninstallAgent: {
			ok(next, [{ agents }]) {
				next.agents = agents;
			},
			error(next, [error]) {
				next.error = String(error?.message ?? error);
			},
			unhandled() {},
		},
		abortInfer: { ok() {}, error() {}, unhandled() {} },
	},
});

export const shellComponents = {
	...uiComponents,
	ChatBubble,
	AgentCard,
	Choice,
	Picker,
	TrustCard,
	ToolCard,
	ChatPanel,
	AgentShell,
	MicroAgentApp,
};

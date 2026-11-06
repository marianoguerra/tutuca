// A domain-specific agent made generic: it drives whatever component it holds through what
// that component says in its agent meta (AGENT_META, src/agent.js), knowing nothing of its
// domain. It starts with a hole that lists only the components that say it, picking one (and
// one of its samples, or empty) puts it in the agent, shown beside the conversation, where
// people and the model edit the same instance.
//
// A prompt asks the host to infer (one model step, the ask's answer the model's message). The
// tools it calls run here: a query or a pure message at once, through query and apply, its
// ContractError told to the model in words; a message that needs a context is checked, then
// sent to the target in a settle scope (src/tree/scope.js), and toolSettled, once that message
// and everything it caused ran (the asks it made answered, the messages it sent handled, other
// agents it prompted done), answers the call with what the target looks like after, and with
// how many of its steps failed if any did. Once every call has its result it infers again,
// until the model answers without calling a tool or the target's max steps.
//
// Stop cancels the tool running (its scope, and every agent it prompted with it), and tells a
// target that holds agents of its own to stop them (stopAgents, when it has it).
import {
	$if,
	AGENT_META,
	agentOf,
	apply,
	component,
	DISPLAY_META,
	displayLabel,
	each,
	field,
	hasAgentMeta,
	maxStepsOf,
	nextAction,
	pendingResults,
	planToolCall,
	render,
	reportType,
	send,
	settledText,
	specOf,
	systemPrompt,
	t,
	tag,
	targetValue,
	toolResultMessage,
	toolsFor,
} from "../../src/tutuca.js";
import { BECOME_ARGS, CANVAS_META } from "../canvas/layout.js";

const { button, div, form, header, label, option, p, select, span, textarea } = tag;

// The model the agent asks by default: the echo model, which needs no keys (llm.js).
export const ECHO_MODEL = "echo/echo";

// What the agent sends the host to infer: one step with everything the model needs.
const inferRequest = (target, transcript, model) => ({
	model,
	systemPrompt: systemPrompt(target),
	tools: toolsFor(target),
	transcript,
});

// The agent's loop from where it is, with appended the messages to add first: runs every tool
// call it can here, until it has to infer, wait for a sent message, or stop. this is self.
const advance = (self, next, ctx, appended, steps = self.steps) => {
	// A target that holds agents of its own (a canvas) hears which model this one uses, so
	// theirs is the same unless someone picked one for them.
	let target = usesModel(self.target) ? apply(self.target, "useModel", self.model) : self.target;
	const transcript = [...self.transcript.messages, ...appended];
	const added = [...appended];
	const answer = (call, text, isError) => {
		const m = toolResultMessage(call, text, isError);
		transcript.push(m);
		added.push(m);
	};
	let status = "idle";
	let error = "";
	loop: for (;;) {
		const { action, calls } = nextAction(transcript);
		if (action === "complete") break;
		if (action === "infer") {
			const max = maxStepsOf(target);
			if (steps >= max) {
				error = `Stopped after ${max} steps.`;
				break;
			}
			status = "thinking";
			ctx.ask("infer", [inferRequest(target, transcript, self.model)]);
			break;
		}
		for (const call of calls) {
			const plan = planToolCall(target, call);
			if (plan.done) {
				answer(call, plan.done.text, plan.done.isError);
				target = plan.next;
				continue;
			}
			// A message that needs a context: the target handles it, and once it and what it
			// caused settled, toolSettled answers it.
			status = "running";
			next.job = ctx.sendAt(plan.send.name, plan.send.args, (s) => s.field("target"), {
				settled: ["toolSettled", [call.id, call.name, plan.result]],
				progress: "toolProgress",
			});
			next.jobTasks = 0;
			break loop;
		}
	}
	if (status !== "running") next.job = 0;
	if (target !== self.target) next.target = target;
	if (added.length > 0) next.transcript = apply(next.transcript, "append", added);
	next.steps = steps;
	next.status = status;
	next.error = error;
};

// The conversation, the prompt and, under it, the tools and the model, both small: the tools
// (what people can ask for, from the target's agent meta) open on a toggle; the model is
// "provider/id", echo/echo the model without a model that runs the tool a prompt names.
const chatPanel = () =>
	div(
		{ class: field("chatPanelClass") },
		// Laid out bottom-up (column-reverse), the scroll stays at the bottom as messages come,
		// unless it was scrolled up; the one child keeps them in order, and its auto margin keeps
		// them at the top while they're fewer than fill it (justify-end would leave what
		// overflows where it can't be scrolled to).
		div(
			{ class: field("transcriptClass") },
			div(
				{ class: "mb-auto flex flex-col gap-2" },
				render(field("transcript")),
				// While it works, a card where its answer will come, after the last message, so
				// it's seen where one looks for the answer.
				$if(
					field("isBusy"),
					div(
						{
							class:
								"agent-status flex w-full items-center gap-2 rounded-box border border-dashed border-base-300 bg-base-100 px-3 py-2 text-sm",
							role: "status",
						},
						span({ class: "loading loading-dots loading-xs opacity-60" }),
						p({ class: "italic opacity-70" }, field("statusText")),
						button(
							{
								class: "btn btn-ghost btn-xs ml-auto",
								type: "button",
								title: "Stop what it's doing, and the agents it asked",
								"on:click": send("stop"),
							},
							"■ Stop",
						),
					),
					"",
				),
			),
		),
		$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		form(
			{ class: "agent-prompt flex flex-col gap-1", "on:submit": send("prompt") },
			textarea({
				class: "textarea textarea-bordered textarea-sm w-full",
				"aria-label": "Prompt",
				placeholder: field("placeholder"),
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
				"on:keydown": send("promptKey"),
			}),
			$if(
				field("showsTools"),
				div(
					{ class: "agent-tools flex flex-wrap gap-1", "aria-label": "Tools" },
					each(
						field("tools"),
						span(
							{ class: "badge badge-sm badge-ghost font-mono", title: field("description") },
							field("icon"),
							" ",
							field("name"),
						),
					),
				),
				"",
			),
			div(
				{ class: "flex items-center gap-1 text-xs" },
				$if(
					field("hasTarget"),
					button(
						{
							class: "btn btn-ghost btn-xs",
							type: "button",
							title: "What you can ask it to do",
							"aria-expanded": $if(field("toolsOpen"), "true", "false"),
							"on:click": send("toggleTools"),
						},
						field("toolsLabel"),
					),
					"",
				),
				label(
					{ class: "ml-auto flex items-center gap-1 opacity-70" },
					"Model",
					select(
						{
							class: "select select-bordered select-xs w-48",
							"aria-label": "Model",
							title:
								"The models the studio server has keys for; echo runs the tool you name, /tool {json}",
							value: field("model"),
							"on:focusin": send("loadModels"),
							"on:change": send("setModel", targetValue()),
						},
						each(
							field("modelOptions"),
							option({ value: field("id"), selected: field("selected") }, field("name")),
						),
					),
				),
				button(
					{ class: "btn btn-ghost btn-xs", type: "button", "on:click": send("clear") },
					"Clear",
				),
				button({ class: "btn btn-primary btn-xs", disabled: field("cannotSend") }, "Send"),
			),
		),
	);

// The draft as the user's message, and the model is asked; nothing without a target, while
// busy or for an empty draft.
const sendDraft = (self, next, ctx) => {
	const text = self.draft.trim();
	if (!self.hasTarget || self.isBusy || text === "") return;
	next.draft = "";
	advance(self, next, ctx, userTurn(self, text), 0);
};
// text as the user's message, after results for calls a stopped loop (or a reload) left
// without one, so the model can be asked again.
const userTurn = (self, text) => [
	...pendingResults(self.transcript.messages, "It was stopped before it finished."),
	{ role: "user", content: text },
];
// Whether the target passes the model on to the agents it holds: its useModel is pure.
const usesModel = (target) => specOf(target)?.on?.useModel?.pure === true;
// Whether the target holds agents of its own, which stopping this one stops too.
const holdsAgents = (target) => specOf(target)?.on?.stopAgents !== undefined;

// What a tool's settle scope says while it runs.
const progressType = t.record({
	id: t.number(),
	tasks: t.number().int().min(0),
	open: t.number().int().min(0),
	failed: t.number().int().min(0),
});

// Its handlers that advance the loop declare no emits: what they send to the target is the
// target's own message, named by the tool the model calls.
export const Agent = component({
	name: "Agent",
	meta: {
		[DISPLAY_META]: {
			title: "Agent",
			icon: "🤖",
			description: "An LLM agent for whatever component you give it, through its agent meta.",
		},
		[CANVAS_META]: { width: 1000 },
	},
	fields: {
		target: t.component(),
		transcript: t.component("Transcript"),
		draft: t.string().sync("none"),
		// The model, "provider/id": echo/echo needs no keys.
		model: t.string(ECHO_MODEL),
		// Where the model came from: default (the first the host offers, or echo), given (the
		// agent that prompts this one uses it: useModel) or chosen (picked in the select), which
		// neither of the others changes.
		modelFrom: t.enum("default", "given", "chosen"),
		// idle, thinking while the model is asked, running while a sent tool runs. Not kept:
		// after a reload nothing is running.
		status: t.enum("idle", "thinking", "running").sync("none"),
		// The settle scope of the tool running (0 when none) and how many tasks it ran so far.
		job: t.number().int().min(0).sync("none"),
		jobTasks: t.number().int().min(0).sync("none"),
		// split: the target and the chat side by side, halves; side: the chat a narrow column
		// beside a wide target (a canvas).
		layout: t.enum("split", "side"),
		steps: t.number().int().min(0),
		error: t.string(),
		chatOpen: t.boolean(true), // Off, the agent shows the component alone.
		// Whether it can drive another component: not when what holds it put it there (a canvas
		// item, which ejects it instead).
		canChange: t.boolean(true),
		// The models the host offers besides echo (its answer to the models ask), and whether
		// it was asked: unasked until the agent gets a target or the select is focused.
		models: t.array(t.record({ id: t.string(), name: t.string() })).sync("none"),
		modelsAsked: t.boolean(false).sync("none"),
		toolsOpen: t.boolean(false).sync("none"),
	},
	queries: {
		get hasTarget() {
			return hasAgentMeta(this.target);
		},
		get targetLabel() {
			return this.hasTarget ? (displayLabel(this.target) ?? "") : "Pick a component";
		},
		get isBusy() {
			return this.status !== "idle";
		},
		// What the model said last, as text: what an agent that prompted this one reads.
		get lastAnswer() {
			const last = this.transcript.messages.findLast((m) => m.role === "assistant");
			if (!Array.isArray(last?.content)) return "";
			return last.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
		},
		get canSend() {
			return this.hasTarget && !this.isBusy && this.draft.trim() !== "";
		},
		// The models to pick from: echo, then the host's, the one in use marked selected; one no
		// longer offered is kept, so the select shows what's used.
		get modelOptions() {
			const all = [
				{ id: ECHO_MODEL, name: "Echo (no model: runs the tool you name)" },
				...this.models,
			];
			if (!all.some((m) => m.id === this.model)) all.push({ id: this.model, name: this.model });
			return all.map((m) => ({ ...m, selected: m.id === this.model }));
		},
		get canChangeTarget() {
			return this.canChange && this.hasTarget;
		},
		get chatTitle() {
			return this.chatOpen ? "Hide the chat" : "Show the chat";
		},
		get gridClass() {
			if (!this.chatOpen) return "grid gap-3";
			return this.layout === "side"
				? "grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_26rem] md:grid-rows-[minmax(0,1fr)]"
				: "grid gap-3 md:grid-cols-2";
		},
		// Beside a wide target, the agent is as tall as the window (less the page's padding) and
		// the chat as tall as what's left: the conversation scrolls, the prompt at the bottom.
		get rootClass() {
			const base = "agent flex flex-col gap-3";
			return this.layout === "side" ? `${base} md:h-[calc(100dvh-1rem)]` : base;
		},
		get chatClass() {
			return this.layout === "side" ? "min-h-0 md:h-full" : "";
		},
		get chatPanelClass() {
			const base = "agent-chat flex min-w-0 flex-col gap-2";
			return this.layout === "side" ? `${base} h-full` : base;
		},
		// A box of its own, bordered and a shade off the page, so an empty conversation reads as
		// a place for one.
		get transcriptClass() {
			const scroll =
				"flex flex-col-reverse overflow-y-auto rounded-box border border-base-content/15 bg-base-100 p-3";
			return this.layout === "side"
				? `${scroll} min-h-0 flex-1`
				: `${scroll} min-h-24 max-h-[28rem]`;
		},
		get showsTools() {
			return this.toolsOpen && this.hasTarget;
		},
		get toolsLabel() {
			return `🧰 ${this.tools.length} tools ${this.toolsOpen ? "▾" : "▸"}`;
		},
		get cannotSend() {
			return !this.canSend;
		},
		get placeholder() {
			return this.hasTarget ? "Ask the agent… (Ctrl+Enter sends)" : "Pick a component first";
		},
		get statusText() {
			if (this.status === "thinking") return `Thinking… (step ${this.steps + 1})`;
			if (this.status === "running") {
				return this.jobTasks > 0 ? `Running a tool… (${this.jobTasks} steps)` : "Running a tool…";
			}
			return "";
		},
		get hasError() {
			return this.error !== "";
		},
		// The target's own tools, for people to see what the model can do: ⚙️ a message, 🔍 a query.
		get tools() {
			if (!this.hasTarget) return [];
			return agentOf(this.target).tools.map((tl) => ({
				name: tl.name,
				description: tl.description ?? "",
				icon: tl.kind === "query" ? "🔍" : "⚙️",
			}));
		},
	},
	view: div(
		{ class: field("rootClass") },
		header(
			{ class: "flex items-center gap-2" },
			// Held by what put the target there (a canvas item), whose header names it already.
			$if(field("canChange"), span({ class: "font-semibold" }, field("targetLabel")), ""),
			div(
				{ class: "ml-auto flex items-center gap-1" },
				$if(
					field("canChangeTarget"),
					button(
						{
							class: "btn btn-ghost btn-xs",
							title: "Drive another component",
							"on:click": send("changeTarget"),
						},
						"Change",
					),
					"",
				),
				button(
					{
						class: "btn btn-ghost btn-xs",
						title: field("chatTitle"),
						"aria-pressed": $if(field("chatOpen"), "true", "false"),
						"on:click": send("toggleChat"),
					},
					"💬",
				),
			),
		),
		div(
			{ class: field("gridClass") },
			div({ class: "agent-target min-h-0 min-w-0" }, render(field("target"))),
			$if(field("chatOpen"), div({ class: field("chatClass") }, chatPanel()), ""),
		),
	),
	on: {
		toggleChat(next) {
			next.chatOpen = !this.chatOpen;
		},
		// Asks the host which models it offers, once.
		loadModels(next, _args, ctx) {
			if (this.modelsAsked) return;
			next.modelsAsked = true;
			ctx.ask("models");
		},
		toggleTools(next) {
			next.toolsOpen = !this.toolsOpen;
		},
		setDraft: {
			args: [t.string()],
			run(next, [text]) {
				next.draft = text;
			},
		},
		// Picked in the select: this one keeps it.
		setModel: {
			args: [t.string()],
			run(next, [model]) {
				next.model = model;
				next.modelFrom = "chosen";
			},
		},
		// The model the agent that drives this one uses, which it uses too, unless one was
		// picked for it.
		useModel: {
			pure: true,
			args: [t.string().len(1)],
			run(next, [model]) {
				if (this.modelFrom === "chosen") return;
				next.model = model;
				next.modelFrom = "given";
			},
		},
		// The prompt typed: the user's message, and the model is asked.
		prompt: {
			args: [],
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				sendDraft(this, next, ctx);
			},
		},
		// Ctrl+Enter (⌘+Enter on a Mac) in the prompt sends it; Enter alone is a new line.
		promptKey: {
			args: [],
			run(next, _args, ctx) {
				const e = ctx.event;
				if (e?.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				sendDraft(this, next, ctx);
			},
		},
		// Says text as the user, from outside (a test, a story, another component).
		ask: {
			args: [t.string().len(1)],
			pre: (self) => self.hasTarget && !self.isBusy,
			run(next, [text], ctx) {
				advance(this, next, ctx, userTurn(this, text), 0);
			},
		},
		// Stops what it's doing: the tool running is cancelled (and whatever it started), the
		// target's agents are stopped, and the calls left without a result get one saying so.
		stop: {
			args: [],
			run(next, _args, ctx) {
				if (this.job !== 0) ctx.cancel(this.job);
				if (holdsAgents(this.target)) ctx.sendAt("stopAgents", [], (s) => s.field("target"));
				const closed = pendingResults(this.transcript.messages, "Stopped by the user.");
				if (closed.length > 0) next.transcript = apply(next.transcript, "append", closed);
				next.status = "idle";
				next.job = 0;
				next.jobTasks = 0;
			},
		},
		clear: {
			args: [],
			run(next) {
				next.transcript = apply(next.transcript, "clear");
				next.status = "idle";
				next.steps = 0;
				next.error = "";
			},
		},
		// A hole to pick another component in, and a new conversation.
		changeTarget: {
			args: [],
			run(next, _args, ctx) {
				next.target = ctx.scope.make("Hole", { meta: AGENT_META });
				next.transcript = apply(next.transcript, "clear");
				next.status = "idle";
				next.steps = 0;
				next.error = "";
			},
		},
		// From the hole: what was picked, which the agent now drives.
		become: {
			args: BECOME_ARGS,
			run(next, [content], ctx) {
				ctx.stopNext();
				next.target = content;
				if (!this.modelsAsked) {
					next.modelsAsked = true;
					ctx.ask("models");
				}
				next.transcript = apply(next.transcript, "clear");
				next.status = "idle";
				next.steps = 0;
				next.error = "";
			},
		},
		// After a sent tool's message, and everything it caused, ran: its result, and the loop
		// goes on. One that timed out leaves the target's agents stopped too.
		toolSettled: {
			args: [t.string(), t.string(), t.string(), reportType],
			run(next, [id, name, result, report], ctx) {
				if (this.status !== "running" || report.id !== this.job) return;
				if (report.outcome === "timeout" && holdsAgents(this.target)) {
					ctx.sendAt("stopAgents", [], (s) => s.field("target"));
				}
				const { text, isError } = settledText(this.target, result, report);
				advance(this, next, ctx, [toolResultMessage({ id, name }, text, isError)]);
			},
		},
		// How far the tool running got: the steps its scope ran so far.
		toolProgress: {
			args: [progressType],
			run(next, [report]) {
				if (this.status === "running" && report.id === this.job) next.jobTasks = report.tasks;
			},
		},
	},
	answers: {
		// [{ provider, id, name }] → the models to pick from; none when the host has none.
		models: {
			// Still on echo by default, it switches to the first model offered; not one given or
			// chosen.
			ok(next, [models]) {
				next.models = (Array.isArray(models) ? models : [])
					.filter((m) => typeof m?.provider === "string" && typeof m.id === "string")
					.map((m) => ({ id: `${m.provider}/${m.id}`, name: String(m.name ?? m.id) }));
				const switches = this.modelFrom === "default" && this.model === ECHO_MODEL;
				if (switches && next.models.length > 0) next.model = next.models[0].id;
			},
			error(next) {
				next.models = [];
			},
			unhandled(next) {
				next.models = [];
			},
		},
		infer: {
			ok: {
				run(next, [message], ctx) {
					if (this.status !== "thinking") return; // Cleared or changed meanwhile.
					if (message?.role !== "assistant") {
						next.status = "idle";
						next.error = "The model answered something that isn't a message.";
						return;
					}
					advance(this, next, ctx, [message], this.steps + 1);
					if (message.stopReason === "error") next.error = message.errorMessage ?? "Model error.";
				},
			},
			error(next, [error]) {
				next.status = "idle";
				next.error = `The model couldn't be asked: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.status = "idle";
				next.error = "This page can't ask a model: nothing answers infer.";
			},
		},
	},
});

// An agent, its hole listing only the components that say agent meta.
export const agent = (C, fields = {}) =>
	C.Agent({
		target: C.Hole({ meta: AGENT_META }),
		transcript: C.Transcript({ messages: [] }),
		...fields,
	});

export const agentComponents = { Agent };

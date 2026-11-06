// A domain-specific agent made generic: it drives whatever component it holds through what
// that component says in its agent meta (AGENT_META, src/agent.js), knowing nothing of its
// domain. It starts with a hole that lists only the components that say it, picking one (and
// one of its samples, or empty) puts it in the agent, shown beside the conversation, where
// people and the model edit the same instance.
//
// A prompt asks the host to infer (one model step, the ask's answer the model's message). The
// tools it calls run here: a query or a pure message at once, through query and apply, its
// ContractError told to the model in words; a message that needs a context is checked, then
// sent to the target, and a toolSettled sent after it (the queue is FIFO) answers the call with
// what the target looks like after. Once every call has its result it infers again, until the
// model answers without calling a tool or MAX_STEPS steps.
//
// v1's limits: asks the target makes while handling a tool aren't waited for, and a target's
// handler that fails tells the host, not the agent (the precondition is checked first).
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
	MAX_STEPS,
	nextAction,
	planToolCall,
	render,
	resultText,
	send,
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
	let target = self.target;
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
			if (steps >= MAX_STEPS) {
				error = `Stopped after ${MAX_STEPS} steps.`;
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
			// A message that needs a context: the target handles it, then toolSettled answers it.
			status = "running";
			ctx.sendAt(plan.send.name, plan.send.args, (s) => s.field("target"));
			ctx.sendAt("toolSettled", [call.id, call.name, plan.result], (s) => s);
			break loop;
		}
	}
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
		{ class: "agent-chat flex min-w-0 flex-col gap-2" },
		div({ class: "max-h-[28rem] overflow-y-auto" }, render(field("transcript"))),
		$if(field("isBusy"), p({ class: "text-xs opacity-70" }, field("statusText")), ""),
		$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		form(
			{ class: "agent-prompt flex flex-col gap-1", "on:submit": send("prompt") },
			textarea({
				class: "textarea textarea-bordered textarea-sm w-full",
				"aria-label": "Prompt",
				placeholder: field("placeholder"),
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
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
		// idle, thinking while the model is asked, running while a sent tool runs.
		status: t.enum("idle", "thinking", "running"),
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
			return this.chatOpen ? "grid gap-3 md:grid-cols-2" : "grid gap-3";
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
			return this.hasTarget ? "Ask the agent…" : "Pick a component first";
		},
		get statusText() {
			if (this.status === "thinking") return `Thinking… (step ${this.steps + 1})`;
			if (this.status === "running") return "Running a tool…";
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
		{ class: "agent flex flex-col gap-3" },
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
			div({ class: "agent-target min-w-0" }, render(field("target"))),
			$if(field("chatOpen"), chatPanel(), ""),
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
		setModel: {
			args: [t.string()],
			run(next, [model]) {
				next.model = model;
			},
		},
		// The prompt typed: the user's message, and the model is asked.
		prompt: {
			args: [],
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				const text = this.draft.trim();
				if (!this.hasTarget || this.isBusy || text === "") return;
				next.draft = "";
				advance(this, next, ctx, [{ role: "user", content: text }], 0);
			},
		},
		// Says text as the user, from outside (a test, a story, another component).
		ask: {
			args: [t.string().len(1)],
			pre: (self) => self.hasTarget && !self.isBusy,
			run(next, [text], ctx) {
				advance(this, next, ctx, [{ role: "user", content: text }], 0);
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
		// After a sent tool's message ran in the target: its result, and the loop goes on.
		toolSettled: {
			args: [t.string(), t.string(), t.string()],
			run(next, [id, name, result], ctx) {
				if (this.status !== "running") return;
				const text = resultText(this.target, result);
				advance(this, next, ctx, [toolResultMessage({ id, name }, text)]);
			},
		},
	},
	answers: {
		// [{ provider, id, name }] → the models to pick from; none when the host has none.
		models: {
			// Still on echo, it switches to the first model offered.
			ok(next, [models]) {
				next.models = (Array.isArray(models) ? models : [])
					.filter((m) => typeof m?.provider === "string" && typeof m.id === "string")
					.map((m) => ({ id: `${m.provider}/${m.id}`, name: String(m.name ?? m.id) }));
				if (this.model === ECHO_MODEL && next.models.length > 0) next.model = next.models[0].id;
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

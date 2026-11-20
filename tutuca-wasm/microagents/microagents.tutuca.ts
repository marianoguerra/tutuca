// The micro-agents' shell: the agents installed, the open sessions as tabs, and
// each session's workspace (the agent's root, made by the host in the agent's scope) beside its
// chat. What only the page can do is the host's (app.js), asked for: opening a sample or a
// dropped file with an agent (answered with the session it made), running the model's turns and
// their tool calls, exporting, installing. The host tells the shell what happens outside it by
// sending it messages: offer when a dropped file fits several agents, say for the status line,
// setAgents when one is installed, and a session's setChat as its conversation goes on.
import {
	aside,
	button,
	details,
	div,
	each,
	field,
	h2,
	lookupBind,
	nav,
	option,
	p,
	pre,
	render,
	renderEach,
	select,
	send,
	sourceKey,
	span,
	summary,
	targetValue,
	textarea,
	when,
} from "tutuca/view";

/** A line of a conversation, as the host writes it. */
export type ChatLine = { kind: "user" | "assistant" | "tool" | "note"; title: string; text: string; error: boolean };
/** An agent a dropped file fits. */
export type Offer = { id: string; title: string; icon: string };
/** A model the shell offers ("provider/id" values). */
export type ModelChoice = { value: string; name: string };

/** An open agent: its workspace and its conversation with the model. The transcript is the
 * host's; the session shows its lines. */
export type Session = {
	id: string;
	agent: string;
	title: string;
	icon: string;
	/** The agent's root, as the host made it (sync none: the host makes it). */
	workspace: Component | null;
	/** The conversation's lines, as the host writes them. */
	chat: ChatLine[];
	draft: string;
	/** Whether the model is taking its turn. */
	busy: boolean;
	/** Why the conversation stopped; "" when it didn't. */
	stopped: string;
	readonly canSend: boolean;
};
export interface SessionAsks {
	/** To the host: the model's turn on what the user wrote. */
	infer(session: string, text: string): boolean;
	stopInfer(session: string): boolean;
	exportData(session: string): boolean;
}

export const Session = {
	meta: {
		// The chat lines' classes, which their loop's enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes:
				"rounded-box border border-error/40 bg-error/5 px-2 py-1 text-xs border-base-300 bg-base-200",
		},
	},
	defaults: { id: "", agent: "", title: "", icon: "", workspace: null, chat: [], draft: "", busy: false, stopped: "" },
	sync: { workspace: "none", chat: "none" },
	queries: {
		get canSend(): boolean {
			return !this.busy && this.draft.trim() !== "";
		},
	},
	on: {
		setDraft: {
			pure: true,
			changes: ["draft"],
			post(prev, next, [text]: [string]) {
				return next.draft === text;
			},
			run(next, [text]: [string]) {
				next.draft = text;
			},
		},
		sendChat: {
			changes: ["draft", "busy", "stopped"],
			run(next, [], ctx) {
				if (!this.canSend) return;
				ctx.ask("infer", [this.id, this.draft]);
				next.draft = "";
				next.busy = true;
				next.stopped = "";
			},
		},
		stop: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("stopInfer", [this.id]);
			},
		},
		export: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("exportData", [this.id]);
			},
		},
		/** From the host: the conversation's lines now, whether the model is still at it, and why
		 * it stopped. */
		setChat: {
			pure: true,
			changes: ["chat", "busy", "stopped"],
			run(next, [chat, busy, stopped]: [ChatLine[], boolean, string]) {
				next.chat = chat;
				next.busy = busy;
				next.stopped = stopped;
			},
		},
		/** From the host: the workspace now (a tool call undone puts the one before it back). */
		setWorkspace: {
			pure: true,
			changes: ["workspace"],
			run(next, [workspace]: [Component]) {
				next.workspace = workspace;
			},
		},
	},
	answers: {
		/** The turn is over when the host says so (setChat); an error ends it here. */
		infer: {
			error(next, [error]: [unknown]) {
				next.busy = false;
				next.stopped = `the model failed: ${tutuca.errorMessage(error)}`;
			},
			unhandled(next, []: []) {
				next.busy = false;
				next.stopped = "nothing answers this";
			},
		},
	},
	loops: {
		chat: {
			enrich(key: number, line: ChatLine) {
				return {
					isTool: line.kind === "tool",
					isUser: line.kind === "user",
					isNote: line.kind === "note",
					toolClass: line.error
						? "rounded-box border border-error/40 bg-error/5 px-2 py-1 text-xs"
						: "rounded-box border border-base-300 bg-base-200 px-2 py-1 text-xs",
				};
			},
		},
	},
	view: div(
		{ class: "grid flex-1 min-h-0 gap-3 p-3 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]" },
		div(
			{ class: "min-h-0 overflow-auto rounded-box bg-base-100 p-4 shadow-sm" },
			when(field("workspace"), render(field("workspace")), p({ class: "opacity-60" }, "opening…")),
		),
		aside(
			{ class: "flex min-h-0 flex-col gap-2 rounded-box bg-base-100 p-3 shadow-sm" },
			div(
				{ class: "flex items-center justify-between gap-2" },
				h2({ class: "font-semibold" }, "Chat"),
				button({ class: "btn btn-xs btn-ghost", title: "Download the data as JSON", "on:click": send("export") }, "Export"),
			),
			div(
				{ class: "ma-chat flex min-h-0 flex-1 flex-col gap-2 overflow-auto" },
				each(
					field("chat"),
					when(
						lookupBind("isTool"),
						details(
							{ class: lookupBind("toolClass") },
							summary({ class: "cursor-pointer font-mono" }, field("title")),
							pre({ class: "mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words" }, field("text")),
						),
						when(
							lookupBind("isUser"),
							div({ class: "chat chat-end" }, div({ class: "chat-bubble chat-bubble-primary whitespace-pre-wrap text-sm" }, field("text"))),
							when(
								lookupBind("isNote"),
								p({ class: "text-xs opacity-60" }, field("text")),
								div({ class: "chat chat-start" }, div({ class: "chat-bubble whitespace-pre-wrap text-sm" }, field("text"))),
							),
						),
					),
					"chat",
				),
			),
			when(field("stopped"), p({ class: "text-xs text-warning" }, field("stopped"))),
			textarea({
				class: "textarea textarea-bordered w-full text-sm",
				rows: "3",
				placeholder: "Ask the agent…",
				"aria-label": "Message",
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
				"on:keydown+enter+ctrl+prevent": send("sendChat"),
			}),
			div(
				{ class: "flex justify-end gap-2" },
				when(
					field("busy"),
					button({ class: "btn btn-sm", "on:click": send("stop") }, "Stop"),
					button(
						{ class: "btn btn-sm btn-primary", disabled: when(field("canSend"), false, true), "on:click": send("sendChat") },
						"Send",
					),
				),
			),
		),
	),
};

/** An agent, as the shell lists it: what it opens, its samples to open, and why it can't be
 * used when it can't. */
export type AgentCard = {
	id: string;
	title: string;
	description: string;
	needs: string;
	icon: string;
	samples: { name: string }[];
	problems: string;
};
export interface AgentCardNotifies {
	openSample(agent: string, sample: string): void;
	removeAgent(agent: string): void;
}

export const AgentCard = {
	defaults: { id: "", title: "", description: "", needs: "", icon: "", samples: [], problems: "" },
	on: {
		/** The sample at at, opened. */
		open: {
			changes: [],
			constraints: { at: { keyOf: "samples" } },
			run(next, [at]: [number | null], ctx) {
				const sample = at === null ? undefined : this.samples[at];
				if (sample !== undefined) ctx.notify("openSample", [this.id, sample.name]);
			},
		},
		remove: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("removeAgent", [this.id]);
			},
		},
	},
	view: div(
		{ class: "card card-border bg-base-100 shadow-sm" },
		div(
			{ class: "card-body gap-2 p-4" },
			h2({ class: "card-title text-base" }, span({}, field("icon")), field("title")),
			p({ class: "text-sm" }, field("description")),
			p({ class: "text-xs opacity-60" }, "Opens: ", field("needs")),
			when(field("problems"), p({ class: "text-xs text-error" }, field("problems"))),
			div(
				{ class: "card-actions" },
				each(field("samples"), button({ class: "btn btn-xs", "on:click": send("open", sourceKey()) }, field("name"))),
				button({ class: "btn btn-xs btn-ghost", title: "Uninstall", "on:click": send("remove") }, "Remove"),
			),
		),
	),
};

/** The shell: the agents, the sessions as tabs, the one shown. */
export type MicroAgents = {
	agents: AgentCard[];
	sessions: Session[];
	/** The session shown, by id; "" for the agents. */
	active: string;
	models: ModelChoice[];
	model: string;
	/** The page's theme. */
	theme: "light" | "dark";
	/** The status line. */
	status: string;
	/** The agents a dropped file fits, to pick one; empty when none is offered. */
	offers: Offer[];
	readonly onHome: boolean;
	readonly hasOffers: boolean;
	readonly noAgents: boolean;
	readonly isDark: boolean;
	/** The sessions' tabs, the shown one on. */
	readonly tabs: { id: string; title: string; icon: string; on: boolean }[];
};
export interface MicroAgentsAsks {
	/** To the host: a session of agent on its sample; answers with the session made. */
	openSample(agent: string, sample: string): Session;
	/** To the host: a session of agent on the file dropped last. */
	openDropped(agent: string): Session;
	rememberModel(model: string): boolean;
	/** To the host: show the page in theme, and remember it. */
	setTheme(theme: string): boolean;
	uninstall(agent: string): boolean;
}

export const MicroAgents = {
	defaults: { agents: [], sessions: [], active: "", models: [], model: "", theme: "light", status: "", offers: [] },
	queries: {
		get onHome(): boolean {
			return this.active === "";
		},
		get hasOffers(): boolean {
			return this.offers.length > 0;
		},
		get noAgents(): boolean {
			return this.agents.length === 0;
		},
		get isDark(): boolean {
			return this.theme === "dark";
		},
		get tabs() {
			return this.sessions.map((s) => ({ id: s.id, title: s.title, icon: s.icon, on: s.id === this.active }));
		},
	},
	on: {
		show: {
			pure: true,
			changes: ["active"],
			post(prev, next, [id]: [string]) {
				return next.active === id;
			},
			run(next, [id]: [string]) {
				next.active = id;
			},
		},
		/** A tab's click: the session at at shown. */
		showAt: {
			pure: true,
			changes: ["active"],
			constraints: { at: { keyOf: "sessions" } },
			run(next, [at]: [number | null]) {
				const s = at === null ? undefined : this.sessions[at];
				if (s !== undefined) next.active = s.id;
			},
		},
		close: {
			pure: true,
			changes: ["sessions", "active"],
			run(next, [id]: [string]) {
				next.sessions = this.sessions.filter((s) => s.id !== id);
				if (this.active === id) next.active = "";
			},
		},
		/** A tab's ✕: the session at at closed. */
		closeAt: {
			pure: true,
			changes: ["sessions", "active"],
			constraints: { at: { keyOf: "sessions" } },
			run(next, [at]: [number | null]) {
				const s = at === null ? undefined : this.sessions[at];
				if (s === undefined) return;
				next.sessions = this.sessions.filter((x) => x.id !== s.id);
				if (this.active === s.id) next.active = "";
			},
		},
		/** An agent card's notify, or the host's: a session of agent on its sample. */
		openSample: {
			changes: [],
			run(next, [agent, sample]: [string, string], ctx) {
				ctx.ask("openSample", [agent, sample]);
			},
		},
		/** The offer at at, picked. */
		pickOffer: {
			changes: ["offers"],
			constraints: { at: { keyOf: "offers" } },
			run(next, [at]: [number | null], ctx) {
				const offer = at === null ? undefined : this.offers[at];
				if (offer !== undefined) ctx.ask("openDropped", [offer.id]);
				next.offers = [];
			},
		},
		dismissOffers: {
			pure: true,
			changes: ["offers"],
			run(next, []: []) {
				next.offers = [];
			},
		},
		/** Light to dark, or dark to light. */
		toggleTheme: {
			changes: ["theme"],
			run(next, [], ctx) {
				const theme = this.theme === "dark" ? "light" : "dark";
				ctx.ask("setTheme", [theme]);
				next.theme = theme;
			},
		},
		setModel: {
			changes: ["model"],
			post(prev, next, [model]: [string]) {
				return next.model === model;
			},
			run(next, [model]: [string], ctx) {
				ctx.ask("rememberModel", [model]);
				next.model = model;
			},
		},
		/** An agent card's notify. */
		removeAgent: {
			changes: [],
			run(next, [agent]: [string], ctx) {
				ctx.ask("uninstall", [agent]);
			},
		},
		/** From the host: the status line. */
		say: {
			pure: true,
			changes: ["status"],
			post(prev, next, [text]: [string]) {
				return next.status === text;
			},
			run(next, [text]: [string]) {
				next.status = text;
			},
		},
		/** From the host: a session it opened (a file dropped that one agent opens), added and
		 * shown. */
		addSession: {
			pure: true,
			changes: ["sessions", "active"],
			run(next, [session]: [Session]) {
				next.sessions.push(session);
				next.active = session.id;
			},
		},
		/** From the host: the agents a dropped file fits. */
		offer: {
			pure: true,
			changes: ["offers"],
			run(next, [offers]: [Offer[]]) {
				next.offers = offers;
			},
		},
		/** From the host: the agents now (one was installed or removed). */
		setAgents: {
			pure: true,
			changes: ["agents"],
			run(next, [agents]: [AgentCard[]]) {
				next.agents = agents;
			},
		},
	},
	answers: {
		/** A session opened: it's added and shown. */
		openSample: {
			ok(next, [session]: [Session]) {
				next.sessions.push(session);
				next.active = session.id;
			},
			error(next, [error]: [unknown]) {
				next.status = `can't open it: ${tutuca.errorMessage(error)}`;
			},
		},
		openDropped: {
			ok(next, [session]: [Session]) {
				next.sessions.push(session);
				next.active = session.id;
			},
			error(next, [error]: [unknown]) {
				next.status = `can't open it: ${tutuca.errorMessage(error)}`;
			},
		},
	},
	loops: {
		/** Only the session shown renders. */
		shown: {
			filter(key: number, session: Session): boolean {
				return session.id === this.active;
			},
		},
	},
	view: div(
		{ class: "flex h-screen flex-col" },
		nav(
			{ class: "navbar min-h-0 gap-2 bg-base-100 px-3 py-1 shadow-sm" },
			span({ class: "text-lg font-bold" }, "Micro-agents"),
			div(
				{ class: "tabs tabs-box tabs-sm flex-1 flex-nowrap overflow-x-auto" },
				button({ class: when(field("onHome"), "tab tab-active", "tab"), "on:click": send("show", "") }, "Agents"),
				each(
					field("tabs"),
					div(
						{ class: "flex items-center" },
						button(
							{ class: when(field("on"), "tab tab-active", "tab"), "on:click": send("showAt", sourceKey()) },
							span({ class: "mr-1" }, field("icon")),
							field("title"),
						),
						button(
							{ class: "btn btn-ghost btn-xs", title: "Close", "aria-label": "Close", "on:click": send("closeAt", sourceKey()) },
							"✕",
						),
					),
				),
			),
			button(
				{
					class: "btn btn-sm btn-ghost btn-square",
					title: "Switch between light and dark",
					"aria-label": "Switch theme",
					"on:click": send("toggleTheme"),
				},
				when(field("isDark"), "☀", "☾"),
			),
			select(
				{ class: "select select-sm w-56", "aria-label": "Model", value: field("model"), "on:change": send("setModel", targetValue()) },
				option({ value: "" }, "no model"),
				each(field("models"), option({ value: field("value") }, field("name"))),
			),
		),
		when(field("status"), div({ class: "bg-base-200 px-3 py-1 text-xs opacity-70" }, field("status"))),
		when(
			field("hasOffers"),
			div(
				{ class: "alert m-3 flex flex-wrap" },
				span({}, "This file opens with:"),
				each(
					field("offers"),
					button({ class: "btn btn-sm", "on:click": send("pickOffer", sourceKey()) }, span({}, field("icon")), field("title")),
				),
				button({ class: "btn btn-sm btn-ghost", "on:click": send("dismissOffers") }, "Cancel"),
			),
		),
		when(
			field("onHome"),
			div(
				{ class: "grid gap-3 overflow-auto p-3 md:grid-cols-2 xl:grid-cols-3" },
				p(
					{ class: "text-sm opacity-70 md:col-span-2 xl:col-span-3" },
					"Drop a JSON file to open it with an agent that fits it, or an agent's package to install it.",
				),
				when(
					field("noAgents"),
					p(
						{ class: "text-sm opacity-70 md:col-span-2 xl:col-span-3" },
						"No agents loaded yet: drop an agent's package here (dist/agents/*.json), or open the page with ?loadAgents=all.",
					),
				),
				renderEach(field("agents")),
			),
		),
		renderEach(field("sessions"), "shown"),
	),
};

export const register = { AgentCard: "AgentCard", Session: "Session", MicroAgents: "MicroAgents" };

export const hostAsks = ["infer", "stopInfer", "exportData", "openSample", "openDropped", "rememberModel", "setTheme", "uninstall"];

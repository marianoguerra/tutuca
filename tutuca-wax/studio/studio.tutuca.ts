// The studio's own components, in tutuca-wax: the screens as tabs, the screen shown, the menu,
// the picker a new screen's scope is chosen in, and the editor a component is written in, with
// its assistant. What only the page can do is the host's (studio.js), asked for: keeping the
// library (saveScreen, saveScope, deleteScreen, saveComponent, keepChat), making a screen or a
// preview in its scope chain (openScreen, preview, which answer with the component made,
// rendered here), building (build), the model's turn (chat, stopChat, prompt), confirming, and
// moving the library in and out. The host tells the studio what happens outside it by sending it
// messages: showScreen at the start, openEditor when a hole asks for a new component or a slot's
// ✎ for one to edit, reopen when a component a screen uses changed, say and note for the status
// line and the events, setLibrary after an import; and the editor (host.send to editor) the
// preview's state and what its components reported.
import {
	a,
	aside,
	button,
	circle,
	details,
	dialog,
	div,
	each,
	eventProperty,
	field,
	h,
	h3,
	header,
	input,
	li,
	lookupBind,
	main,
	nav,
	option,
	p,
	path,
	pre,
	query,
	render,
	section,
	select,
	send,
	sourceKey,
	span,
	summary,
	svg,
	table,
	tbody,
	td,
	textarea,
	tr,
	targetValue,
	ul,
	when,
} from "tutuca/view";
import { get, itemsOf, range } from "tutuca/data";

/** A scope of the library; the root's parent is "". */
export type ScopeRecord = { id: string; name: string; parent: string };
/** A screen of the library: a layout made in a scope. */
export type ScreenRecord = { id: string; name: string; scope: string; created: number };
/** What a component reported, or the studio noted. */
export type Event = { kind: string; text: string };
/** One of pure-tutuca's diagnostics; text is how the model reads it. */
export type Diagnostic = {
	file: string;
	line: number;
	col: number;
	endLine: number;
	endCol: number;
	severity: string;
	message: string;
	text: string;
};
/** A type the module registers, and whether a hole can make it. */
export type Register = { name: string; ok: boolean; note: string };
export type Named = { name: string };
/** The models a provider offers ("provider/id" values). */
export type ModelGroup = { provider: string; models: { value: string; name: string }[] };
/** A tool call of the model's last message. */
export type Call = { id: string; name: string };
/** A line of the conversation as the assistant panel shows it. */
export type Bubble = { kind: string; text: string; details: string };
/** What a build says. */
export type Built = {
	ok: boolean;
	status: string;
	makeable: Named[];
	registers: Register[];
	diagnostics: Diagnostic[];
	/** How many builds in a row failed with only the errors of the one before. */
	stuck: number;
};
/** A screen's component, as the host made it in its scope chain. */
export type Opened = { id: string; screen: Component; editing: boolean };
/** An example's source, and the name a new component takes for it; ok is false when the user
 * keeps what's there. */
export type ExampleSource = { ok: boolean; name: string; source: string };

/** The path of the component itself, what a send to itself goes to. */
const SELF: string[] = [];

/** A rem per level: "margin-left: 2rem". */
function indent(depth: number): string {
	return `margin-left: ${depth}rem`;
}

/** The indexes of the scope at at and of its ancestors, the root's first; empty when its chain
 * doesn't reach the root. */
function ancestry(scopes: readonly ScopeRecord[], at: number): number[] {
	const up: number[] = [at];
	let parent = scopes.at(at)?.parent ?? "";
	for (const _ of range(0, scopes.length)) {
		if (parent === "") return up.map((x, i) => up[up.length - 1 - i] ?? x);
		const i = scopes.findIndex((s) => s.id === parent);
		if (i < 0) return [];
		up.push(i);
		parent = scopes.at(i)?.parent ?? "";
	}
	return [];
}

/** a before b in the tree: the order of their paths of ancestors, a parent before its children,
 * siblings in the library's order. */
function treeOrder(left: readonly number[], right: readonly number[]): number {
	for (const i of range(0, Math.min(left.length, right.length))) {
		const x = left[i] ?? 0;
		const y = right[i] ?? 0;
		if (x !== y) return x - y;
	}
	return left.length - right.length;
}

/** The class of a line of the events: failed in red, an issue in yellow, a log in green. */
function eventClass(kind: string): string {
	if (kind === "failed") return "py-0.5 border-b border-base-300 text-error";
	if (kind === "issue") return "py-0.5 border-b border-base-300 text-warning";
	if (kind === "log") return "py-0.5 border-b border-base-300 text-success";
	return "py-0.5 border-b border-base-300";
}

/** The tree a new screen's scope is picked from, a child scope added under any of them, and the
 * screen's name. */
export type ScopePicker = {
	scopes: ScopeRecord[];
	/** The scope picked, by id. */
	selected: string;
	/** The scope a child is being added under, by id; "" while none is. */
	adding: string;
	name: string;
	/** The name it gets when none is written. */
	placeholder: string;
	/** The scopes in the tree's order, each with what its row shows. */
	readonly tree: { id: string; name: string; on: boolean; adding: boolean; indent: string; childIndent: string; addLabel: string }[];
};
export interface ScopePickerNotifies {
	/** To the studio: make a screen in scope, named name. */
	createScreen(scope: string, name: string): void;
	closePicker(): void;
	/** To the studio: a scope was added, so its list has it. */
	scopeAdded(id: string, name: string, parent: string): void;
}
export interface ScopePickerAsks {
	saveScope(id: string, name: string, parent: string): boolean;
}

export const ScopePicker = {
	defaults: { scopes: [], selected: "", adding: "", name: "", placeholder: "screen 1" },
	constraints: { name: { maxLength: 60 } },
	queries: {
		get tree() {
			const paths = this.scopes.map((_, i) => ancestry(this.scopes, i)).filter((up) => up.length > 0);
			paths.sort((x, y) => treeOrder(x, y));
			return paths.map((up) => {
				const scope = this.scopes[up[up.length - 1] ?? 0] ?? { id: "", name: "", parent: "" };
				const depth = up.length - 1;
				return {
					id: scope.id,
					name: scope.name,
					on: scope.id === this.selected,
					adding: scope.id === this.adding,
					indent: indent(depth),
					childIndent: indent(depth + 1),
					addLabel: `Add a scope in ${scope.name}`,
				};
			});
		},
	},
	on: {
		/** The scope of the tree's row at at, picked. */
		pick: {
			pure: true,
			changes: ["selected"],
			run(next, [at]: [number]) {
				const row = this.tree[at];
				if (row !== undefined) next.selected = row.id;
			},
		},
		/** A child of the scope of the tree's row at at, being added. */
		startAdding: {
			pure: true,
			changes: ["adding"],
			run(next, [at]: [number]) {
				const row = this.tree[at];
				if (row !== undefined) next.adding = row.id;
			},
		},
		cancelAdding: {
			pure: true,
			changes: ["adding"],
			post(prev, next, []: []) {
				return next.adding === "";
			},
			run(next, []: []) {
				next.adding = "";
			},
		},
		/** A child of the scope being added under, picked; saved by the host and told to the
		 * studio. */
		addScope: {
			changes: ["scopes", "selected", "adding"],
			run(next, [name]: [string], ctx) {
				if (this.adding === "") return;
				const id = ctx.uuid();
				const named = name === "" ? "scope" : name;
				ctx.ask("saveScope", [id, named, this.adding]);
				ctx.notify("scopeAdded", [id, named, this.adding]);
				next.scopes.push({ id, name: named, parent: this.adding });
				next.selected = id;
				next.adding = "";
			},
		},
		setName: {
			pure: true,
			changes: ["name"],
			constraints: { name: { maxLength: 60 } },
			post(prev, next, [name]: [string]) {
				return next.name === name;
			},
			run(next, [name]: [string]) {
				next.name = name;
			},
		},
		/** The name written, or the placeholder. */
		create: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("createScreen", [this.selected, this.name === "" ? this.placeholder : this.name]);
			},
		},
		cancel: {
			changes: [],
			run(next, [], ctx) {
				ctx.notify("closePicker", []);
			},
		},
	},
	view: dialog(
		{ class: "modal modal-open", open: "open", "aria-label": "New screen" },
		div(
			{ class: "modal-box flex flex-col gap-3" },
			h3({ class: "text-lg font-bold" }, "New screen"),
			p({ class: "text-xs uppercase tracking-wide opacity-60" }, "the scope it's made in"),
			div(
				{
					class: "st-tree flex flex-col gap-0.5 max-h-80 overflow-auto rounded-box border border-base-300 p-1",
					role: "tree",
				},
				each(
					field("tree"),
					div(
						{ class: "flex flex-col gap-0.5" },
						div(
							{ class: "flex items-center gap-1", style: field("indent") },
							button(
								{
									class: when(
										field("on"),
										"st-scope btn btn-sm btn-active flex-1 justify-start font-mono",
										"st-scope btn btn-sm btn-ghost flex-1 justify-start font-mono",
									),
									role: "treeitem",
									"aria-selected": when(field("on"), "true", "false"),
									"on:click": send("pick", sourceKey()),
								},
								field("name"),
							),
							button(
								{
									class: "btn btn-xs btn-ghost",
									title: field("addLabel"),
									"aria-label": field("addLabel"),
									"on:click": send("startAdding", sourceKey()),
								},
								"+",
							),
						),
						when(
							field("adding"),
							div(
								{ class: "flex items-center gap-1", style: field("childIndent") },
								input({
									class: "input input-sm",
									placeholder: "scope's name",
									"aria-label": "New scope's name",
									autofocus: "autofocus",
									"on:keydown+enter+prevent": send("addScope", targetValue()),
									"on:keydown+escape+prevent": send("cancelAdding"),
								}),
							),
						),
					),
				),
			),
			p({ class: "text-xs uppercase tracking-wide opacity-60" }, "its name"),
			input({
				class: "input input-sm",
				placeholder: field("placeholder"),
				"aria-label": "New screen's name",
				value: field("name"),
				"on:input": send("setName", targetValue()),
				"on:keydown+enter+prevent": send("create"),
			}),
			div(
				{ class: "modal-action mt-0" },
				button({ class: "btn btn-sm btn-ghost", "on:click": send("cancel") }, "Cancel"),
				button({ class: "btn btn-sm btn-primary", "on:click": send("create") }, "Create"),
			),
		),
	),
	examples: {
		addingAScopePicksIt: {
			start: { scopes: [{ id: "root", name: "root", parent: "" }], selected: "root" },
			steps: [
				{ send: "startAdding", args: [0] },
				{ expect: { adding: "root" } },
				{ send: "addScope", args: ["a"] },
				{ expect: { adding: "" } },
			],
		},
	},
};

/** Whether v's key is the string s. */
function is(v: unknown, key: string, s: string): boolean {
	return get(v, key) === s;
}

/** A message's content as text: itself, or its text blocks joined. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	const texts: string[] = [];
	for (const block of itemsOf(content)) {
		const text = get(block, "text");
		if (is(block, "type", "text") && typeof text === "string") texts.push(text);
	}
	return texts.join("\n");
}

/** A component being written or edited: its module in a code editor (tw-code-editor,
 * code-editor.js), built by the host as it changes, what the build says, a preview of one of the
 * types it registers, made in the screen's scope chain, and the assistant: a model that edits the
 * component through one tool, write_component, told what each build of what it wrote says until
 * it builds, up to four tries. */
export type Editor = {
	/** A new component, registered in the screen's scope when it's saved, or one of the
	 * library's. */
	creating: boolean;
	id: string;
	name: string;
	/** The module, name.tutuca.ts. */
	source: string;
	/** The source as it was opened, to tell whether it changed. */
	saved: { name: string; source: string };
	status: string;
	building: boolean;
	/** What the last build said: pure-tutuca's diagnostics (text: as the model reads them), each type
	 * it registers and whether a hole can make it, and the ones that can. */
	diagnostics: Diagnostic[];
	registers: Register[];
	/** How many builds in a row failed with only the errors of the one before: the assistant
	 * stops fixing at 2, as it's making no progress. */
	stuck: number;
	makeable: Named[];
	previewType: string;
	/** The preview, as the host made it (sync none: made again from the build). */
	preview: Component | null;
	/** The preview's state, as JSON text, and what its components reported. */
	stateText: string;
	events: Event[];
	/** The inspector shown: "diagnostics", "registers", "state" or "events". */
	inspecting: string;
	/** Where the code editor jumps: "line:col", and a count that makes each jump a new value. */
	gotoAt: string;
	jumps: number;
	/** Whether there's an assistant, and whether its panel is open. */
	assistant: boolean;
	chatOpen: boolean;
	/** The models offered, by provider, and the one picked. */
	models: ModelGroup[];
	model: string;
	/** The conversation, in pi's format (scripts/studio-server.mjs): the user's messages, the
	 * model's, and the results of its tool calls. */
	transcript: unknown[];
	draft: string;
	/** What the assistant is doing, "" when it's idle. */
	busy: string;
	/** The tries since the user's last message (0 for the first). */
	round: number;
	/** The tool calls of the model's last message, while what they wrote is built. */
	calls: Call[];
	/** Why the conversation stopped, shown after it; "" when it didn't. */
	chatNote: string;
	showPrompt: boolean;
	promptText: string;
	/** The examples whose sources can replace this one (the assistant's and the prebuilt
	 * modules), by name. */
	examples: Named[];
	readonly changed: boolean;
	readonly file: string;
	readonly severalTypes: boolean;
	readonly sending: boolean;
	/** The transcript as what it shows: user, assistant, tool, ok, failed (text the summary,
	 * details what the model was told) or error. */
	readonly bubbles: Bubble[];
};
export interface EditorNotifies {
	/** To the studio: done, saved or not. */
	closeEditor(): void;
}
export interface EditorAsks {
	/** The source built: what pure-tutuca says, and what it registers. */
	build(id: string, name: string, source: string): Built;
	/** One of its types, made with no fields where the screen's holes make. */
	preview(id: string, type: string): Component;
	/** Kept in the library (and registered in the screen's scope when it's new), its
	 * conversation too: what to say, or why it can't be. */
	saveComponent(creating: boolean, id: string, name: string, source: string, chat: unknown[]): string;
	leaveEditor(creating: boolean): boolean;
	confirm(text: string): boolean;
	/** The model's next message, told the conversation and the component. */
	chat(model: string, messages: unknown[], name: string, source: string): unknown;
	stopChat(): boolean;
	/** What the model is told: the reference, the examples, the component. */
	prompt(name: string, source: string): string;
	rememberModel(model: string): boolean;
	/** The conversation kept with the component, once it's in the library. */
	keepChat(id: string, messages: unknown[]): boolean;
	/** An example's source, and the name a new component takes for it. */
	example(name: string, replacing: boolean): ExampleSource;
}

export const Editor = {
	meta: {
		// The classes its loops' enrich computes: a diagnostic's severity, an event's kind.
		"https://tutuca.dev/meta/classes": {
			classes: "text-error text-warning text-info font-semibold py-0.5 border-b border-base-300 text-success",
		},
	},
	defaults: {
		creating: false,
		id: "",
		name: "",
		source: "",
		saved: { name: "", source: "" },
		status: "",
		building: false,
		diagnostics: [],
		registers: [],
		stuck: 0,
		makeable: [],
		previewType: "",
		preview: null,
		stateText: "",
		events: [],
		inspecting: "diagnostics",
		gotoAt: "",
		jumps: 0,
		assistant: false,
		chatOpen: false,
		models: [],
		model: "",
		transcript: [],
		draft: "",
		busy: "",
		round: 0,
		calls: [],
		chatNote: "",
		showPrompt: false,
		promptText: "",
		examples: [],
	},
	constraints: {
		stuck: { int: true, min: 0 },
		events: { maxLength: 200 },
		jumps: { int: true },
		round: { int: true, min: 0 },
	},
	sync: { preview: "none" },
	queries: {
		get changed(): boolean {
			return this.name !== this.saved.name || this.source !== this.saved.source;
		},
		get file(): string {
			return `${this.name}.tutuca.ts`;
		},
		get severalTypes(): boolean {
			return this.makeable.length > 1;
		},
		get sending(): boolean {
			return this.busy !== "";
		},
		get bubbles(): Bubble[] {
			const out: Bubble[] = [];
			for (const m of this.transcript) {
				const content = get(m, "content");
				if (is(m, "role", "user")) out.push({ kind: "user", text: textOf(content), details: "" });
				if (is(m, "role", "assistant")) {
					const text = textOf(content);
					if (text !== "") out.push({ kind: "assistant", text, details: "" });
					for (const block of itemsOf(content)) {
						if (is(block, "type", "toolCall")) {
							const wrote = typeof get(get(block, "arguments"), "source") === "string";
							out.push({ kind: "tool", text: wrote ? `✎ wrote ${this.name}.tutuca.ts` : "✎ wrote nothing", details: "" });
						}
					}
					if (is(m, "stopReason", "error") || is(m, "stopReason", "aborted")) {
						const why = get(m, "errorMessage");
						const reason = get(m, "stopReason");
						out.push({
							kind: "error",
							text: typeof why === "string" ? why : typeof reason === "string" ? reason : "",
							details: "",
						});
					}
				}
				if (is(m, "role", "toolResult")) {
					const text = textOf(content);
					if (get(m, "isError") === true) {
						out.push({ kind: "failed", text: "✗ it didn't build; the model was told why", details: text });
					} else {
						out.push({ kind: "ok", text: `✓ ${text}`, details: "" });
					}
				}
			}
			return out;
		},
		/** Whether the inspector shows tab. */
		inspectingIs(tab: string): boolean {
			return this.inspecting === tab;
		},
	},
	on: {
		setSource: {
			pure: true,
			changes: ["source"],
			post(prev, next, [text]: [string]) {
				return next.source === text;
			},
			run(next, [text]: [string]) {
				next.source = text;
			},
		},
		/** The host checks the name when it's saved. */
		rename: {
			pure: true,
			changes: ["name"],
			run(next, [name]: [string]) {
				next.name = name;
			},
		},
		/** The source replaced by an example's, then built; asked first, by the page, when the
		 * source changed since it was opened. */
		loadExample: {
			changes: [],
			run(next, [name]: [string], ctx) {
				ctx.ask("example", [name, this.changed]);
			},
		},
		build: {
			changes: ["building", "status"],
			run(next, [], ctx) {
				ctx.ask("build", [this.id, this.name, this.source]);
				next.building = true;
				next.status = `building ${this.name}…`;
			},
		},
		pickType: {
			changes: ["previewType", "preview"],
			run(next, [type]: [string], ctx) {
				ctx.ask("preview", [this.id, type]);
				next.previewType = type;
				next.preview = null;
			},
		},
		inspect: {
			pure: true,
			changes: ["inspecting"],
			post(prev, next, [tab]: [string]) {
				return next.inspecting === tab;
			},
			run(next, [tab]: [string]) {
				next.inspecting = tab;
			},
		},
		/** The code editor sent to the place of the diagnostic at at. */
		goto: {
			pure: true,
			changes: ["gotoAt", "jumps"],
			constraints: { at: { keyOf: "diagnostics" } },
			run(next, [at]: [number | null]) {
				const d = at === null ? undefined : this.diagnostics[at];
				if (d === undefined) return;
				next.gotoAt = `${d.line}:${d.col}`;
				next.jumps = this.jumps + 1;
			},
		},
		/** pre is only checked in dev mode: no assistant, no chat to open. */
		toggleChat: {
			pure: true,
			changes: ["chatOpen"],
			pre(prev, []: []) {
				return this.assistant;
			},
			run(next, []: []) {
				if (this.assistant) next.chatOpen = !this.chatOpen;
			},
		},
		save: {
			changes: ["status"],
			run(next, [], ctx) {
				ctx.ask("saveComponent", [this.creating, this.id, this.name, this.source, this.transcript]);
				next.status = "saving…";
			},
		},
		/** Asked first when it changed. */
		back: {
			changes: [],
			run(next, [], ctx) {
				if (this.changed) ctx.ask("confirm", [`Leave ${this.name} without saving?`]);
				else ctx.ask("leaveEditor", [this.creating]);
			},
		},
		/** From the host: the preview's state, what its components reported. */
		setState: {
			pure: true,
			changes: ["stateText"],
			post(prev, next, [text]: [string]) {
				return next.stateText === text;
			},
			run(next, [text]: [string]) {
				next.stateText = text;
			},
		},
		/** The newest first, up to 200. */
		note: {
			pure: true,
			changes: ["events"],
			run(next, [kind, text]: [string, string]) {
				const events: Event[] = [{ kind, text }];
				for (const e of this.events.slice(0, 199)) events.push(e);
				next.events = events;
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
		/** The draft to the model, told the conversation and the source as they are now; nothing
		 * while it's answering. The conversation is kept. */
		sendChat: {
			changes: ["transcript", "draft", "busy", "round", "chatNote"],
			run(next, [], ctx) {
				if (this.busy !== "" || this.draft === "") return;
				next.transcript.push({ role: "user", content: this.draft, timestamp: ctx.now() });
				ctx.ask("chat", [this.model, next.transcript, this.name, this.source]);
				ctx.ask("keepChat", [this.id, next.transcript]);
				next.draft = "";
				next.round = 0;
				next.chatNote = "";
				next.busy = "thinking…";
			},
		},
		stopChat: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("stopChat", []);
			},
		},
		clearChat: {
			changes: ["transcript", "chatNote"],
			run(next, [], ctx) {
				if (this.busy !== "") return;
				const none: unknown[] = [];
				ctx.ask("keepChat", [this.id, none]);
				next.transcript = [];
				next.chatNote = "";
			},
		},
		/** Each of the model's calls answered: a write_component with text (failed when it didn't
		 * build), another tool that there's none. Then its next turn when it failed and it has
		 * tries left, or the conversation waits. Sent by the answers that tell the model. */
		answerCalls: {
			changes: ["transcript", "calls", "busy", "round", "chatNote"],
			run(next, [text, failed]: [string, boolean], ctx) {
				for (const call of this.calls) {
					const other = call.name !== "write_component";
					next.transcript.push({
						role: "toolResult",
						toolCallId: call.id,
						toolName: call.name,
						content: [{ type: "text", text: other ? `There's no tool ${call.name}: use write_component.` : text }],
						isError: other || failed,
						timestamp: ctx.now(),
					});
				}
				next.calls = [];
				if (!failed) {
					ctx.ask("keepChat", [this.id, next.transcript]);
					next.busy = "";
					return;
				}
				// Four tries, or two in a row that left the same errors (in this turn: a new message
				// gets one try at least).
				const noProgress = this.stuck >= 2 && this.round >= 1;
				if (this.round >= 3 || noProgress) {
					ctx.ask("keepChat", [this.id, next.transcript]);
					next.chatNote = noProgress
						? "Stopped: the last two tries left the same errors where they were. The diagnostics are in the editor; say how to go on."
						: "Still not building after 4 tries: the diagnostics are in the editor. Say how to go on.";
					next.busy = "";
					return;
				}
				next.round = this.round + 1;
				ctx.ask("chat", [this.model, next.transcript, this.name, this.source]);
				ctx.ask("keepChat", [this.id, next.transcript]);
				next.busy = `fixing what didn't build (${this.round + 1} of 3)…`;
			},
		},
		togglePrompt: {
			changes: ["showPrompt", "promptText"],
			run(next, [], ctx) {
				if (!this.showPrompt) ctx.ask("prompt", [this.name, this.source]);
				next.showPrompt = !this.showPrompt;
			},
		},
	},
	answers: {
		/** The example's source, its name too for a new component, built. */
		example: {
			ok(next, [example]: [ExampleSource], ctx) {
				if (!example.ok) return;
				next.source = example.source;
				if (this.creating) next.name = example.name;
				const name = this.creating ? example.name : this.name;
				ctx.ask("build", [this.id, name, example.source]);
				next.building = true;
				next.status = `building ${name}…`;
			},
		},
		/** What it says, with the diagnostics shown when it didn't build; then the preview of the
		 * type picked, or of the first one a hole can make. And when it's what the assistant
		 * wrote, the model is told. */
		build: {
			ok(next, [built]: [Built], ctx) {
				const picked = built.makeable.find((m) => m.name === this.previewType)?.name;
				const type = picked ?? built.makeable.at(0)?.name ?? "";
				next.building = false;
				next.status = built.status;
				next.diagnostics = built.diagnostics;
				next.registers = built.registers;
				next.stuck = built.stuck;
				next.makeable = built.makeable;
				next.previewType = type;
				if (!built.ok) next.inspecting = "diagnostics";
				if (built.ok && type !== "") ctx.ask("preview", [this.id, type]);
				else next.preview = null;
				if (this.calls.length === 0) return;
				// The assistant's: what it built tells the model.
				if (built.ok) {
					const types = built.registers.map((r) => r.name).join(", ");
					const warnings = built.diagnostics.filter((d) => d.severity !== "error").map((d) => d.text);
					const said = `It built: ${this.name} registers ${types}.`;
					ctx.sendAt("answerCalls", [warnings.length > 0 ? `${said}\nWarnings:\n${warnings.join("\n")}` : said, false], SELF);
				} else {
					const why = built.diagnostics.map((d) => d.text).join("\n");
					ctx.sendAt("answerCalls", [`It didn't build. pure-tutuca's diagnostics:\n${why}`, true], SELF);
				}
			},
			error(next, [error]: [unknown], ctx) {
				next.building = false;
				next.status = tutuca.errorMessage(error);
				if (this.calls.length > 0) ctx.sendAt("answerCalls", ["The compiler failed; nothing was built.", true], SELF);
			},
		},
		preview: {
			ok(next, [preview]: [Component]) {
				next.preview = preview;
			},
			error(next, [error]: [unknown]) {
				next.preview = null;
				next.status = `can't preview it: ${tutuca.errorMessage(error)}`;
			},
		},
		saveComponent: {
			ok(next, [said]: [string], ctx) {
				ctx.notify("closeEditor", []);
			},
			error(next, [error]: [unknown]) {
				next.status = tutuca.errorMessage(error);
			},
		},
		confirm: {
			ok(next, [yes]: [boolean], ctx) {
				if (yes) ctx.ask("leaveEditor", [this.creating]);
			},
		},
		leaveEditor: {
			ok(next, [left]: [boolean], ctx) {
				ctx.notify("closeEditor", []);
			},
		},
		prompt: {
			ok(next, [text]: [string]) {
				next.promptText = text;
			},
			error(next, [error]: [unknown]) {
				next.promptText = tutuca.errorMessage(error);
			},
		},
		/** The model's message: kept, then what it asks for done. Its write_component calls write
		 * the source, which is built (the build's answer tells it what came of it); another tool
		 * is answered that it isn't one; none, and the conversation waits for the user. */
		chat: {
			ok(next, [reply]: [unknown], ctx) {
				next.transcript.push(reply);
				ctx.ask("keepChat", [this.id, next.transcript]);
				if (is(reply, "stopReason", "error") || is(reply, "stopReason", "aborted")) {
					next.busy = "";
					return;
				}
				const calls: Call[] = [];
				let source = this.source;
				let writes = 0;
				for (const block of itemsOf(get(reply, "content"))) {
					if (!is(block, "type", "toolCall")) continue;
					const id = get(block, "id");
					const name = get(block, "name");
					const callName = typeof name === "string" ? name : "";
					calls.push({ id: typeof id === "string" ? id : "", name: callName });
					if (callName === "write_component") {
						const written = get(get(block, "arguments"), "source");
						if (typeof written === "string") source = written;
						writes += 1;
					}
				}
				if (calls.length === 0) {
					next.busy = "";
					return;
				}
				next.calls = calls;
				if (writes === 0) {
					ctx.sendAt("answerCalls", ["", true], SELF);
					return;
				}
				next.source = source;
				next.busy = "building what it wrote…";
				ctx.ask("build", [this.id, this.name, source]);
				next.building = true;
				next.status = `building ${this.name}…`;
			},
			/** Stopped (the host answers "aborted"), or failed, saying why. */
			error(next, [error]: [unknown]) {
				const text = tutuca.errorMessage(error);
				next.busy = "";
				next.calls = [];
				if (text !== "aborted") next.chatNote = text;
			},
		},
	},
	loops: {
		diagnostics: {
			enrich(key: number, d: Diagnostic) {
				const color = d.severity === "error" ? "text-error" : d.severity === "warning" ? "text-warning" : "text-info";
				return { severityClass: `${color} font-semibold` };
			},
		},
		events: {
			enrich(key: number, e: Event) {
				return { eventClass: eventClass(e.kind) };
			},
		},
		bubbles: {
			enrich(key: number, b: Bubble) {
				return {
					isUser: b.kind === "user",
					isAssistant: b.kind === "assistant",
					isTool: b.kind === "tool",
					isOk: b.kind === "ok",
					isFailed: b.kind === "failed",
				};
			},
		},
	},
	view: section(
		{ class: "flex-1 min-h-0 flex flex-col" },
		div(
			{ class: "st-editor-bar flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-2 py-1" },
			button({ class: "btn btn-sm btn-ghost", title: "Back to the screen, without saving", "on:click": send("back") }, "← Back"),
			input({
				class: "input input-sm font-mono w-48",
				"aria-label": "Component name",
				value: field("name"),
				"on:change": send("rename", targetValue()),
			}),
			button({ class: "btn btn-sm", title: "Ctrl/Cmd-Enter", "on:click": send("build") }, "Build"),
			select(
				{
					class: "st-examples select select-sm w-40",
					"aria-label": "Start from an example",
					value: "",
					"on:change": send("loadExample", targetValue()),
				},
				option({ value: "", disabled: "disabled" }, "Start from…"),
				each(field("examples"), option({ value: field("name") }, field("name"))),
			),
			when(
				field("assistant"),
				button(
					{
						class: when(field("chatOpen"), "btn btn-sm btn-primary", "btn btn-sm"),
						title: "Ask a model to change this component",
						"on:click": send("toggleChat"),
					},
					"Assistant",
				),
			),
			span({ class: "flex-1" }),
			span({ class: "st-status text-xs opacity-70 truncate max-w-[40%]", title: field("status") }, field("status")),
			button(
				{ class: "btn btn-sm btn-primary", title: "Keep it and register it in the screen's scope", "on:click": send("save") },
				when(field("creating"), "Save & register", "Save"),
			),
		),
		div(
			{
				class: when(
					field("chatOpen"),
					"st-work flex-1 min-h-0 grid gap-2 p-2 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24rem]",
					"st-work flex-1 min-h-0 grid gap-2 p-2 grid-cols-1 lg:grid-cols-2",
				),
			},
			section(
				{ class: "card card-border bg-base-100 min-h-0 min-w-0 flex flex-col gap-2 p-2" },
				div({ class: "flex flex-wrap gap-1" }, span({ class: "btn btn-xs btn-active font-mono" }, field("file"))),
				h("tw-code-editor", {
					class: "st-editor block flex-1 min-h-0 border border-base-300 rounded-box overflow-hidden",
					name: field("name"),
					source: field("source"),
					diagnostics: field("diagnostics"),
					goto: field("gotoAt"),
					jumps: field("jumps"),
					"on:source-change": send("setSource", eventProperty("detail")),
					"on:run": send("build"),
				}),
			),
			section(
				{ class: "card card-border bg-base-100 min-h-0 min-w-0 flex flex-col gap-2 p-2" },
				div(
					{ class: "flex flex-wrap items-center gap-2" },
					span({ class: "text-xs uppercase tracking-wide opacity-60" }, "preview"),
					when(
						field("severalTypes"),
						select(
							{
								class: "select select-sm st-preview-type",
								"aria-label": "Type to preview",
								value: field("previewType"),
								"on:change": send("pickType", targetValue()),
							},
							each(field("makeable"), option({ value: field("name") }, field("name"))),
						),
					),
				),
				div(
					{ class: "st-preview min-h-40 max-h-[50%] overflow-auto rounded-box border border-dashed border-base-300 p-3" },
					when(
						field("preview"),
						render(field("preview")),
						span(
							{ class: "opacity-70" },
							when(field("building"), "building…", "nothing to preview: see the diagnostics"),
						),
					),
				),
				div(
					{ class: "tabs tabs-border tabs-sm", role: "tablist" },
					button(
						{
							class: when(query("inspectingIs", "diagnostics"), "st-inspector-tab tab tab-active", "st-inspector-tab tab"),
							role: "tab",
							"on:click": send("inspect", "diagnostics"),
						},
						"Diagnostics",
					),
					button(
						{
							class: when(query("inspectingIs", "registers"), "st-inspector-tab tab tab-active", "st-inspector-tab tab"),
							role: "tab",
							"on:click": send("inspect", "registers"),
						},
						"Registers",
					),
					button(
						{
							class: when(query("inspectingIs", "state"), "st-inspector-tab tab tab-active", "st-inspector-tab tab"),
							role: "tab",
							"on:click": send("inspect", "state"),
						},
						"State",
					),
					button(
						{
							class: when(query("inspectingIs", "events"), "st-inspector-tab tab tab-active", "st-inspector-tab tab"),
							role: "tab",
							"on:click": send("inspect", "events"),
						},
						"Events",
					),
				),
				div(
					{ class: "st-inspector flex-1 min-h-0 overflow-auto" },
					when(
						query("inspectingIs", "diagnostics"),
						div(
							{ class: "st-diagnostics font-mono text-xs flex flex-col" },
							each(
								field("diagnostics"),
								button(
									{
										class: "text-left px-2 py-1 border-b border-base-300 hover:bg-base-200 cursor-pointer",
										"on:click": send("goto", sourceKey()),
									},
									span({ class: lookupBind("severityClass") }, field("severity"), " "),
									field("file"),
									":",
									field("line"),
									":",
									field("col"),
									" ",
									field("message"),
								),
								"diagnostics",
							),
						),
					),
					when(
						query("inspectingIs", "registers"),
						table(
							{ class: "table table-sm" },
							tbody(
								{},
								each(
									field("registers"),
									tr(
										{},
										td({ class: "font-mono" }, field("name")),
										td({ class: when(field("ok"), "text-success", "text-error") }, field("note")),
									),
								),
							),
						),
					),
					when(
						query("inspectingIs", "state"),
						pre({ class: "st-state font-mono text-xs whitespace-pre-wrap" }, field("stateText")),
					),
					when(
						query("inspectingIs", "events"),
						div(
							{ class: "st-events font-mono text-xs flex flex-col" },
							each(field("events"), div({ class: lookupBind("eventClass") }, field("kind"), ": ", field("text")), "events"),
						),
					),
				),
			),
			when(
				field("chatOpen"),
				aside(
					{ class: "st-chat flex flex-col gap-2 min-h-0 rounded-box border border-base-300 bg-base-100 p-2" },
					div(
						{ class: "flex flex-wrap items-center gap-2" },
						span({ class: "text-xs uppercase tracking-wide opacity-60" }, "assistant"),
						select(
							{
								class: "st-model select select-sm",
								"aria-label": "Model",
								value: field("model"),
								"on:change": send("setModel", targetValue()),
							},
							each(
								field("models"),
								h(
									"optgroup",
									{ label: field("provider") },
									each(field("models"), option({ value: field("value") }, field("name"))),
								),
							),
						),
					),
					div(
						{ class: "st-chat-log flex flex-col gap-2 overflow-auto flex-1 min-h-24 text-sm", "aria-live": "polite" },
						each(
							field("bubbles"),
							when(
								lookupBind("isUser"),
								div(
									{ class: "st-chat-user self-end max-w-[90%] rounded-box bg-primary/10 px-3 py-2 whitespace-pre-wrap" },
									field("text"),
								),
								when(
									lookupBind("isAssistant"),
									div(
										{ class: "st-chat-assistant max-w-[90%] rounded-box bg-base-200 px-3 py-2 whitespace-pre-wrap" },
										field("text"),
									),
									when(
										lookupBind("isTool"),
										div({ class: "st-chat-tool text-xs font-mono opacity-70" }, field("text")),
										when(
											lookupBind("isOk"),
											div({ class: "st-chat-ok text-xs text-success" }, field("text")),
											when(
												lookupBind("isFailed"),
												div(
													{ class: "st-chat-error text-xs text-error" },
													details({}, summary({}, field("text")), pre({ class: "whitespace-pre-wrap" }, field("details"))),
												),
												div({ class: "st-chat-error text-xs text-error" }, field("text")),
											),
										),
									),
								),
							),
							"bubbles",
						),
						when(
							field("busy"),
							div(
								{
									class: "st-chat-thinking flex items-center gap-2 self-start rounded-box bg-base-200 px-3 py-2 text-sm opacity-80",
									role: "status",
								},
								span({ class: "loading loading-dots loading-sm" }),
								field("busy"),
							),
						),
						when(field("chatNote"), div({ class: "st-chat-error text-xs text-error" }, field("chatNote"))),
					),
					textarea({
						class: "st-chat-input textarea textarea-sm w-full h-20",
						placeholder: "Ask for a change (Ctrl/Cmd-Enter sends)",
						"aria-label": "Message to the assistant",
						value: field("draft"),
						autofocus: "autofocus",
						"on:input": send("setDraft", targetValue()),
						"on:keydown+enter+ctrl+prevent": send("sendChat"),
						"on:keydown+enter+meta+prevent": send("sendChat"),
					}),
					div(
						{ class: "flex flex-wrap items-center gap-2" },
						button({ class: "btn btn-sm btn-primary", disabled: field("sending"), "on:click": send("sendChat") }, "Send"),
						when(field("sending"), button({ class: "btn btn-sm", "on:click": send("stopChat") }, "Stop")),
						button({ class: "btn btn-sm", title: "Start the conversation over", "on:click": send("clearChat") }, "Clear"),
					),
					button(
						{ class: "btn btn-xs btn-ghost self-start text-xs uppercase tracking-wide opacity-60", "on:click": send("togglePrompt") },
						when(field("showPrompt"), "hide what the model is told", "what the model is told"),
					),
					when(
						field("showPrompt"),
						pre({ class: "font-mono text-xs whitespace-pre-wrap max-h-64 overflow-auto" }, field("promptText")),
					),
				),
			),
		),
	),
	examples: {
		typing: {
			start: { name: "tasks", source: "a", saved: { name: "tasks", source: "a" } },
			steps: [{ send: "setSource", args: ["c"] }, { expect: { source: "c", changed: true } }],
		},
		aMessageToTheModel: {
			start: { assistant: true, model: "faux/m", draft: "make it blue" },
			steps: [{ send: "sendChat" }, { expect: { draft: "", busy: "thinking…" } }],
		},
	},
};

/** The studio: a tab per screen and the one shown, the picker while a new screen is being made,
 * the editor while a component is written, the status line, the events, and the menu. */
export type Studio = {
	scopes: ScopeRecord[];
	/** The screens, in the order they were made. */
	screens: ScreenRecord[];
	/** The screen shown, by id; "" when none is. */
	active: string;
	/** The shown screen's component, as the host made it, and its id: none until it answers
	 * (sync none: the host keeps the layout). */
	shown: Component | null;
	shownId: string;
	/** Whether the shown screen's layout is being edited, as the screen last said: the bar's
	 * toggle shows it. */
	editing: boolean;
	/** The screen whose tab is being renamed, and the one asked about deleting, by id; "" when
	 * none is. */
	renaming: string;
	deleting: string;
	picker: ScopePicker | null;
	/** The editor, while a component is written: the page is it then. */
	editor: Editor | null;
	status: string;
	/** The models the assistant offers, and the one last picked. */
	models: ModelGroup[];
	model: string;
	/** The examples an editor can start from, by name. */
	examples: Named[];
	/** What the components reported, the newest first. */
	events: Event[];
	readonly eventsLabel: string;
	readonly hasShown: boolean;
	readonly hasActive: boolean;
};
export interface StudioAsks {
	/** The screen's component, made in its scope chain, with its id. */
	openScreen(id: string): Opened;
	/** The shown screen's layout edited, or used again: whether it's edited now. */
	toggleScreen(): boolean;
	saveScreen(id: string, name: string, scope: string, created: number): boolean;
	deleteScreen(id: string): boolean;
	/** Whether to delete the screen being deleted. */
	confirm(text: string): boolean;
	exportLibrary(): boolean;
	/** The library's components the shown screen's scopes register, each downloaded as its
	 * .wasm, which carries its sources. */
	exportComponents(): boolean;
	importLibrary(): boolean;
	editLayoutJson(id: string): boolean;
}

export const Studio = {
	meta: {
		// The classes its events loop's enrich computes.
		"https://tutuca.dev/meta/classes": { classes: "py-0.5 border-b border-base-300 text-error text-warning text-success" },
	},
	defaults: {
		scopes: [],
		screens: [],
		active: "",
		shown: null,
		shownId: "",
		editing: false,
		renaming: "",
		deleting: "",
		picker: null,
		editor: null,
		status: "",
		models: [],
		model: "",
		examples: [],
		events: [],
	},
	constraints: { events: { maxLength: 200 } },
	sync: {
		shown: "none",
		shownId: "none",
		editing: "none",
		renaming: "none",
		deleting: "none",
		picker: "none",
		editor: "none",
		status: "none",
		events: "none",
	},
	queries: {
		get eventsLabel(): string {
			return this.events.length === 0 ? "events" : `events (${this.events.length})`;
		},
		get hasShown(): boolean {
			return this.shownId !== "";
		},
		get hasActive(): boolean {
			return this.active !== "";
		},
	},
	on: {
		/** From the host at the start and after an import: the screen with id shown, asked for,
		 * the one shown until then dropped. */
		showScreen: {
			changes: ["active", "shown", "shownId", "renaming"],
			run(next, [id]: [string], ctx) {
				if (id !== "") ctx.ask("openScreen", [id]);
				next.active = id;
				next.shown = null;
				next.shownId = "";
				next.renaming = "";
			},
		},
		/** A tab's click: the screen at at shown. */
		showAt: {
			changes: ["active", "shown", "shownId", "renaming"],
			constraints: { at: { keyOf: "screens" } },
			run(next, [at]: [number | null], ctx) {
				const screen = at === null ? undefined : this.screens[at];
				if (screen === undefined) return;
				ctx.ask("openScreen", [screen.id]);
				next.active = screen.id;
				next.shown = null;
				next.shownId = "";
				next.renaming = "";
			},
		},
		/** From the host: a component the screen uses changed, so it's made again. The one shown
		 * stays until it arrives, so an answer to what's in it (the ask of the ✎ that opened the
		 * editor) still reaches it; shownId empty says it's no longer the one the page keeps. */
		reopen: {
			changes: ["shownId"],
			run(next, [], ctx) {
				if (this.active === "") return;
				ctx.ask("openScreen", [this.active]);
				next.shownId = "";
			},
		},
		toggleEditing: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("toggleScreen", []);
			},
		},
		startRename: {
			pure: true,
			changes: ["renaming"],
			constraints: { at: { keyOf: "screens" } },
			run(next, [at]: [number | null]) {
				const screen = at === null ? undefined : this.screens[at];
				if (screen !== undefined) next.renaming = screen.id;
			},
		},
		/** An empty name keeps the one it had. */
		rename: {
			changes: ["screens", "renaming"],
			constraints: { at: { keyOf: "screens" } },
			post(prev, next, [at, name]: [number | null, string]) {
				return next.screens.length === prev.screens.length;
			},
			run(next, [at, name]: [number | null, string], ctx) {
				next.renaming = "";
				const screen = at === null ? undefined : this.screens[at];
				if (at === null || screen === undefined) return;
				const named = name === "" ? screen.name : name;
				ctx.ask("saveScreen", [screen.id, named, screen.scope, screen.created]);
				next.screens[at] = { id: screen.id, name: named, scope: screen.scope, created: screen.created };
			},
		},
		cancelRename: {
			pure: true,
			changes: ["renaming"],
			post(prev, next, []: []) {
				return next.renaming === "";
			},
			run(next, []: []) {
				next.renaming = "";
			},
		},
		/** Asked first: confirm's answer deletes it. */
		removeScreen: {
			changes: ["deleting"],
			constraints: { at: { keyOf: "screens" } },
			run(next, [at]: [number | null], ctx) {
				const screen = at === null ? undefined : this.screens[at];
				if (screen === undefined) return;
				ctx.ask("confirm", [`Delete the screen ${screen.name}?`]);
				next.deleting = screen.id;
			},
		},
		/** Open on the scope of the screen shown, or the root, named after how many screens
		 * there are. */
		openPicker: {
			changes: ["picker"],
			run(next, [], ctx) {
				const shown = this.screens.find((s) => s.id === this.active);
				next.picker = ctx.make("ScopePicker", {
					scopes: this.scopes,
					selected: shown === undefined ? "root" : shown.scope,
					placeholder: `screen ${this.screens.length + 1}`,
				});
			},
		},
		/** The picker's notify. */
		closePicker: {
			pure: true,
			changes: ["picker"],
			run(next, []: []) {
				next.picker = null;
			},
		},
		/** The picker's notify: a new screen in scope, saved by the host and shown. */
		createScreen: {
			changes: ["picker", "screens", "active", "shown", "shownId", "renaming"],
			post(prev, next, [scope, name]: [string, string]) {
				return next.screens.length === prev.screens.length + 1;
			},
			run(next, [scope, name]: [string, string], ctx) {
				const id = ctx.uuid();
				const created = ctx.now();
				ctx.ask("saveScreen", [id, name, scope, created]);
				next.screens.push({ id, name, scope, created });
				next.picker = null;
				ctx.ask("openScreen", [id]);
				next.active = id;
				next.shown = null;
				next.shownId = "";
				next.renaming = "";
			},
		},
		/** The picker's notify: a scope was added. */
		scopeAdded: {
			pure: true,
			changes: ["scopes"],
			post(prev, next, [id, name, parent]: [string, string, string]) {
				return next.scopes.length === prev.scopes.length + 1;
			},
			run(next, [id, name, parent]: [string, string, string]) {
				next.scopes.push({ id, name, parent });
			},
		},
		/** From the host: a screen moved to another scope (one made for it). */
		screenMoved: {
			pure: true,
			changes: ["screens"],
			post(prev, next, [id, scope]: [string, string]) {
				return next.screens.length === prev.screens.length;
			},
			run(next, [id, scope]: [string, string]) {
				const at = this.screens.findIndex((s) => s.id === id);
				const screen = this.screens[at];
				if (screen !== undefined) next.screens[at] = { id, name: screen.name, scope, created: screen.created };
			},
		},
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
		/** The newest first, up to 200. */
		note: {
			pure: true,
			changes: ["events"],
			run(next, [kind, text]: [string, string]) {
				const events: Event[] = [{ kind, text }];
				for (const e of this.events.slice(0, 199)) events.push(e);
				next.events = events;
			},
		},
		/** A new library: the screen shown is dropped until the host shows one. */
		setLibrary: {
			changes: ["scopes", "screens", "active", "shown", "shownId", "renaming", "deleting", "picker"],
			run(next, [scopes, screens]: [ScopeRecord[], ScreenRecord[]]) {
				next.scopes = scopes;
				next.screens = screens;
				next.deleting = "";
				next.picker = null;
				next.active = "";
				next.shown = null;
				next.shownId = "";
				next.renaming = "";
			},
		},
		/** From the host: a hole asked for a new component, or a slot's ✎ for one of the
		 * library's; the editor opens on it and builds it. */
		openEditor: {
			changes: ["editor"],
			run(next, [creating, id, name, source, chat]: [boolean, string, string, string, unknown[]], ctx) {
				next.editor = ctx.make("Editor", {
					creating,
					id,
					name,
					source,
					saved: { name, source },
					assistant: this.models.length > 0,
					models: this.models,
					model: this.model,
					examples: this.examples,
					transcript: chat,
				});
				ctx.sendAt("build", [], "editor");
			},
		},
		/** The editor's notify. */
		closeEditor: {
			pure: true,
			changes: ["editor"],
			run(next, []: []) {
				next.editor = null;
			},
		},
		exportAll: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("exportLibrary", []);
			},
		},
		exportComponents: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("exportComponents", []);
			},
		},
		importAll: {
			changes: [],
			run(next, [], ctx) {
				ctx.ask("importLibrary", []);
			},
		},
		layoutJson: {
			changes: [],
			run(next, [], ctx) {
				if (this.active !== "") ctx.ask("editLayoutJson", [this.active]);
			},
		},
	},
	answers: {
		/** The screen's component, unless another was asked for since. */
		openScreen: {
			ok(next, [opened]: [Opened]) {
				if (opened.id !== this.active) return;
				next.shown = opened.screen;
				next.shownId = opened.id;
				next.editing = opened.editing;
			},
			error(next, [error]: [unknown]) {
				next.status = tutuca.errorMessage(error);
			},
		},
		toggleScreen: {
			ok(next, [editing]: [boolean]) {
				next.editing = editing;
			},
		},
		saveScreen: {
			error(next, [error]: [unknown]) {
				next.status = tutuca.errorMessage(error);
			},
		},
		/** Deleted when confirmed; when it was the one shown, the last one left is. */
		confirm: {
			ok(next, [yes]: [boolean], ctx) {
				const id = this.deleting;
				next.deleting = "";
				const at = this.screens.findIndex((s) => s.id === id);
				if (!yes || at < 0) return;
				ctx.ask("deleteScreen", [id]);
				const screens = this.screens.filter((s) => s.id !== id);
				next.screens = screens;
				if (id !== this.active) return;
				const last = screens.at(-1)?.id ?? "";
				if (last !== "") ctx.ask("openScreen", [last]);
				next.active = last;
				next.shown = null;
				next.shownId = "";
				next.renaming = "";
			},
		},
		deleteScreen: {
			error(next, [error]: [unknown]) {
				next.status = tutuca.errorMessage(error);
			},
		},
		importLibrary: {
			error(next, [error]: [unknown]) {
				next.status = tutuca.errorMessage(error);
			},
		},
	},
	loops: {
		/** The tabs: each screen, marked when it's shown or being renamed. */
		tabs: {
			enrich(key: number, screen: ScreenRecord) {
				return { isActive: screen.id === this.active, isRenaming: screen.id === this.renaming, closeLabel: `Delete ${screen.name}` };
			},
		},
		events: {
			enrich(key: number, e: Event) {
				return { eventClass: eventClass(e.kind) };
			},
		},
	},
	view: div(
		{ class: "st-studio h-screen flex flex-col" },
		when(
			field("editor"),
			render(field("editor")),
			div(
				{ class: "contents" },
				header(
					{ class: "st-bar flex items-center gap-2 border-b border-base-300 bg-base-100 px-2 py-1" },
					nav(
						{ class: "st-tabs flex items-center gap-1 overflow-x-auto min-w-0", role: "tablist" },
						each(
							field("screens"),
							div(
								{
									class: when(
										lookupBind("isActive"),
										"st-tab group flex items-center rounded-btn bg-base-200 font-semibold",
										"st-tab group flex items-center rounded-btn hover:bg-base-200",
									),
								},
								when(
									lookupBind("isRenaming"),
									input({
										class: "input input-xs w-32",
										"aria-label": "Screen name",
										value: field("name"),
										autofocus: "autofocus",
										"on:change": send("rename", sourceKey(), targetValue()),
										"on:keydown+escape+prevent": send("cancelRename"),
									}),
									button(
										{
											class: "px-3 py-1 text-sm whitespace-nowrap",
											role: "tab",
											"aria-selected": when(lookupBind("isActive"), "true", "false"),
											title: "Double-click to rename",
											"on:click": send("showAt", sourceKey()),
											"on:dblclick": send("startRename", sourceKey()),
										},
										field("name"),
									),
								),
								button(
									{
										class: "btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-60 hover:opacity-100",
										title: lookupBind("closeLabel"),
										"aria-label": lookupBind("closeLabel"),
										"on:click": send("removeScreen", sourceKey()),
									},
									"×",
								),
							),
							"tabs",
						),
					),
					button(
						{
							class: "st-new-screen btn btn-sm btn-ghost btn-square",
							title: "New screen",
							"aria-label": "New screen",
							"on:click": send("openPicker"),
						},
						"+",
					),
					span({ class: "flex-1" }),
					span({ class: "st-status text-xs opacity-70 truncate max-w-[40%]", title: field("status") }, field("status")),
					when(
						field("hasShown"),
						button(
							{
								type: "button",
								class: when(
									field("editing"),
									"screen-toggle btn btn-sm btn-square btn-active",
									"screen-toggle btn btn-sm btn-square btn-ghost",
								),
								title: when(field("editing"), "Use the layout", "Edit the layout"),
								"aria-label": when(field("editing"), "Use the layout", "Edit the layout"),
								"aria-pressed": when(field("editing"), "true", "false"),
								"on:click": send("toggleEditing"),
							},
							when(
								field("editing"),
								svg(
									{
										viewBox: "0 0 24 24",
										class: "size-4",
										fill: "none",
										stroke: "currentColor",
										"stroke-width": "2",
										"stroke-linecap": "round",
										"stroke-linejoin": "round",
									},
									path({ d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" }),
									circle({ cx: "12", cy: "12", r: "3" }),
								),
								svg(
									{
										viewBox: "0 0 24 24",
										class: "size-4",
										fill: "none",
										stroke: "currentColor",
										"stroke-width": "2",
										"stroke-linecap": "round",
										"stroke-linejoin": "round",
									},
									path({ d: "M12 20h9" }),
									path({ d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" }),
								),
							),
						),
					),
					div(
						{ class: "st-menu dropdown dropdown-end" },
						div(
							{ class: "btn btn-sm btn-ghost btn-square", role: "button", tabindex: "0", title: "More", "aria-label": "More" },
							"⋯",
						),
						ul(
							{
								class: "menu menu-sm dropdown-content z-20 w-48 rounded-box border border-base-300 bg-base-100 p-1 shadow",
								tabindex: "0",
							},
							li({}, button({ title: "The screen's layout as it's kept", "on:click": send("layoutJson") }, "Layout JSON")),
							li({}, button({ title: "Download the library as a bundle", "on:click": send("exportAll") }, "Export")),
							when(
								field("hasShown"),
								li(
									{},
									button(
										{
											title: "Download the components this screen's scopes register, each as its .wasm",
											"on:click": send("exportComponents"),
										},
										"Export components",
									),
								),
							),
							li(
								{},
								button(
									{
										title:
											"Add a bundle's components, scopes and screens, or components' .wasm files to this screen's scope (or drop them on it)",
										"on:click": send("importAll"),
									},
									"Import",
								),
							),
							li({}, a({ href: "../playground/" }, "Playground")),
							li({}, a({ href: "../demos/" }, "Demos")),
						),
					),
				),
				when(
					field("hasActive"),
					main(
						{ class: "flex-1 min-h-0 flex flex-col" },
						div({ class: "st-stage flex-1 min-h-0 overflow-auto p-4" }, render(field("shown"))),
						details(
							{ class: "st-events-box border-t border-base-300 bg-base-100 text-xs" },
							summary({ class: "cursor-pointer px-3 py-1 opacity-70" }, field("eventsLabel")),
							div(
								{ class: "st-events font-mono max-h-40 overflow-auto flex flex-col px-3 pb-2" },
								each(field("events"), div({ class: lookupBind("eventClass") }, field("kind"), ": ", field("text")), "events"),
							),
						),
					),
					main(
						{ class: "flex-1 flex flex-col items-center justify-center gap-3" },
						p(
							{ class: "text-sm opacity-70 max-w-prose text-center" },
							"A screen is a layout made in a scope: fill its holes with the components that scope can make, or write new ones. Everything stays in this browser; export a bundle to take it elsewhere.",
						),
						button({ class: "btn btn-primary", "on:click": send("openPicker") }, "+ New screen"),
					),
				),
				render(field("picker")),
			),
		),
	),
	examples: {
		renameATab: {
			start: { screens: [{ id: "a", name: "home", scope: "root", created: 1 }] },
			steps: [
				{ send: "startRename", args: [0] },
				{ expect: { renaming: "a" } },
				{ send: "rename", args: [0, "start"] },
				{ expect: { renaming: "", screens: [{ id: "a", name: "start", scope: "root", created: 1 }] } },
			],
		},
	},
};

export const register = { ScopePicker: "ScopePicker", Editor: "Editor", Studio: "Studio" };

/** The page's: openScreen, toggleScreen, saveScreen, saveScope, deleteScreen, confirm,
 * exportLibrary, exportComponents, importLibrary and editLayoutJson for the studio; build,
 * preview, saveComponent, leaveEditor, chat, stopChat, prompt, rememberModel, keepChat and
 * example for the editor. */
export const hostAsks = [
	"openScreen",
	"toggleScreen",
	"saveScreen",
	"saveScope",
	"deleteScreen",
	"confirm",
	"exportLibrary",
	"exportComponents",
	"importLibrary",
	"editLayoutJson",
	"build",
	"preview",
	"saveComponent",
	"leaveEditor",
	"chat",
	"stopChat",
	"prompt",
	"rememberModel",
	"keepChat",
	"example",
];

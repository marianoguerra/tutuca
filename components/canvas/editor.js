// A component editor on the canvas: a pure-tutuca module's source and the name of a component,
// with what checks the source where the editor is (the checkComponent ask), previews it,
// registers what it defines (defineComponent, src/pure/define.js) and puts one of the named
// component on the canvas, beside the editor's item. Registering a name that's there already
// gives it the new definition: what's on the canvas moves onto it with its state.
//
// A preview registers the source in scratch, a scope below the editor's that every editor
// shares, and shows one of its component in the editor: previewed again, it moves onto the new
// definition with its state. Register puts it where the editor's scope field says: its own
// scope ("", promoted: the canvas and its holes see it), or a scope below it by path. The
// scopes panel lists the scopes below the editor's with their components, and adds one to the
// canvas, removes a component or removes a scope; a removal is refused while something on the
// canvas (a preview too) is made of it, and says where.
//
// The canvas puts what's added there: the editor notifies placeComponent with the component,
// the canvas that holds it (index.js) adds an item beside the one it came through and replies
// placed. Once it registers in its own scope, it notifies componentsRegistered, and the canvas
// asks its kinds again. The asks are the host's: without them the editor says it can't.
//
// With a model, its item's 🤖 wraps it in an agent whose tools read and edit the source, set
// the name, check, preview, register, add one to the canvas and manage the scopes.
//
// A hole lists what was registered in the canvas's scope, beside its kinds: withDefinedKinds.

import {
	AGENT_META,
	agentTool,
	hasAgentMeta,
	pageOutline,
	pageOutlineText,
	planToolCall,
	reportType,
	settledText,
	toolsFor,
} from "../../src/meta/index.js";
import {
	checkReportText,
	defineReportText,
	removedText,
	scopesText,
} from "../../src/pure/define-text.js";
import { plainOf } from "../../src/tree/record.js";
import {
	$if,
	component,
	each,
	field,
	render,
	send,
	sourceKey,
	specOf,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { metaFor } from "../common/meta.js";

const { button, details, div, input, li, pre, span, summary, textarea, ul } = tag;

// The scope below the editor's that previews are registered in, shared by every editor there.
export const SCRATCH = "scratch";
// What c's page shows, for the agent that can't see it: preview and the tools that change the
// preview answer with it after its state. A view that fails to render says so.
const onThePage = (c) => {
	try {
		return `\nOn the page:\n${pageOutlineText(pageOutline(c))}`;
	} catch (error) {
		return `\nOn the page: its view failed to render: ${error?.message ?? error}`;
	}
};

// What a new editor starts with: a module that registers as it is.
export const EDITOR_STARTER = `import { button, div, field, send, span } from "tutuca/view";

/** Counts clicks. */
export type Counter = {
	/** What it counts. */
	label: string;
	count: number;
	/** What it says it's at. */
	readonly status: string;
};

export const Counter = {
	defaults: { label: "Clicks", count: 0 },
	on: {
		/** Count one more. */
		inc: {
			run(next) {
				next.count += 1;
			},
		},
		/**
		 * Count n more.
		 * @param n how many.
		 */
		add: {
			run(next, [n]: [number]) {
				next.count += n;
			},
		},
	},
	queries: {
		/**
		 * Where it's at, in words.
		 * @summary
		 */
		get status() {
			return \`\${this.label}: \${this.count}\`;
		},
	},
	view: div(
		{ class: "flex items-center gap-3 p-3" },
		span({ class: "text-sm opacity-70" }, field("label")),
		button({ class: "btn btn-sm btn-primary", "on:click": send("inc") }, field("count")),
		button({ class: "btn btn-sm", "on:click": send("add", 10) }, "+10"),
	),
	examples: {
		countsUp: {
			steps: [
				{ send: "inc" },
				{ send: "add", args: [10] },
				{ expect: { count: 11, status: "Clicks: 11" } },
			],
		},
	},
};
`;

const PROMPT = `A component editor on a canvas. It holds the source of a pure-tutuca module and the
name of a component to add to the canvas. A pure-tutuca module is TypeScript that exports, for
each component, a type and a const of the same name: the type says its fields (and its queries,
as readonly members), the const its defaults, its handlers (on), its queries and its view. A
handler reads this and changes next; it can't change this. View functions (div, span, button,
input, field, send, targetValue, each, when, ...) are imported from "tutuca/view"; classes are
Tailwind's and daisyUI's.

A handler's arguments come as an array, as send passes them: a handler that takes some
destructures them with a tuple type, run(next, [n]: [number]) for send("add", 10), and one that
takes none is run(next). A query is on queries, and a readonly member of the type: one that
takes no args is a getter, get score() { ... }, read as field("score") in the view and this.score
in handlers; one that takes args is a method, matches(q: string) { ... }, called in the view with
$query("matches", field("q")). field never calls anything: a field that names a method shows
its source on the page, and check reports it.

Examples and check see state, not the page: a view can be wrong while they all pass. Preview,
and try_preview of a message, answer with the page too, as an outline: each element, the text
it shows, its inputs' values and [event → message(args)] for what it sends. Read it as the user
will see it: text that is code, [object Object], ⚠ or missing values is a bug in the view. When
the user says what they see on the page, believe it and look for what in the view makes it.

What's added to the canvas can be driven by an agent of its own: each message and query is a
tool, typed by its arguments' types. Doc comments (/** ... */) describe them to it: on the type
(what the component is), on each field, handler and query; @param n says what an argument is,
@hidden keeps a message from it, @summary marks the query it reads in every step. A tag starts a
line of its own, after the text: on the same line it's read as text. Check, preview and register
say which tools its agent will have and what it sees every step: compare them with what you
meant.

Write what it should do as examples before you write how: examples: { name: { start: { fields },
steps: [{ send: "add", args: [2] }, { expect: { count: 2, status: "..." } }] } }, an expect
naming fields and queries. Check, preview and register run them, and one that fails says which
step, what it expected and what it got: one example per message, and one for each case that
matters (a limit, an empty list, a second call that builds on the first).

Work in steps: read_source, change it with replace_in_source (small edits) or set_source (all of
it), check until it has no errors, preview it (it registers it in the scratch scope, shared by
every editor, and shows one in the editor: preview answers with its state and its page),
try_preview each of its tools as its agent will call them and see that they do what you meant,
on the page too, and once it's right,
register it and add_to_canvas. Errors come with their line and column and often how to fix them.
To change a component, edit the source and preview or register it again under the same name:
what's there moves onto the new definition and keeps its state; a field the old one didn't have
needs a default.

Components live in scopes: register puts them in the editor's own scope (null), which the canvas
sees, or in a scope below it by name. set_name takes a path to add one from a scope below
("scratch/Counter"). list_scopes lists the scopes below with their components; unregister and
remove_scope take them away, and say what holds one when it's in use.`;

// The source with its lines numbered, as an agent reads it.
const numbered = (source) =>
	source
		.split("\n")
		.map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
		.join("\n");
const countOf = (text, find) => (find === "" ? 0 : text.split(find).length - 1);

// Makes one of the component name says with fields and notifies the canvas to place it, or
// says why it can't be made.
const placeOne = (next, name, fields, ctx) => {
	if (name === "") {
		next.report = "Can't add one: there's no component name. Register the source, or set one.";
		return;
	}
	const made = ctx.tryMake(name, fields);
	if (made.err !== undefined) {
		const names = ctx.componentNames(true).join(", ");
		next.report = `Can't add ${name}: ${made.err.error}. What can be made here: ${names}.`;
		return;
	}
	next.report = `Adding ${name}…`;
	ctx.notify("placeComponent", [made.ok, `🧩 ${name}`]);
};
const LIST_SCOPES = "listScopes";

export const ComponentEditor = component({
	name: "ComponentEditor",
	meta: {
		...metaFor(
			"Component editor",
			"🧩",
			"Write a component as a pure-tutuca module, check it, preview it, register it and add one to the canvas.",
			560,
		),
		[AGENT_META]: {
			prompt: PROMPT,
			summary: "summary",
			// Writing a component takes many turns: read, edit, check, preview, try each tool,
			// fix, register and add.
			maxSteps: 50,
			tools: [
				agentTool("read_source", "query", [], "The source, its lines numbered.", {
					target: "numberedSource",
				}),
				agentTool("set_source", "message", ["source"], "Replace the whole source.", {
					target: "setSource",
				}),
				agentTool(
					"replace_in_source",
					"message",
					["find", "replacement"],
					"Replace the one place find is in the source with replacement. find must be there exactly once: give more of the text around it when it's there more than once.",
					{ target: "replaceInSource" },
				),
				agentTool(
					"set_name",
					"message",
					["name"],
					"The name of the component add_to_canvas adds, or its path from a scope below (scratch/Counter).",
					{ target: "setName" },
				),
				agentTool(
					"check",
					"message",
					[],
					"Check the source where the editor is, registering nothing: every error and warning, with where it is and how to fix it.",
					{ result: "lastReport" },
				),
				agentTool(
					"preview",
					"message",
					[],
					"Register the source in the scratch scope and show one of the named component in the editor; answers with its state. Previewed again, it keeps its state.",
					{ result: "lastReport" },
				),
				agentTool(
					"try_preview",
					"message",
					["tool", "arguments"],
					"Call one of the preview's tools as its own agent will (by the tool's name, with its arguments as an object, null for none): answers with what it returns, or what the preview looks like after. A tool it doesn't have says which it has. Try each message, and twice where the second call depends on the first.",
					{ target: "tryPreview", result: "lastReport" },
				),
				agentTool("discard_preview", "message", [], "Take the preview away.", {
					target: "discardPreview",
				}),
				agentTool(
					"register",
					"message",
					["scope"],
					"Register the components the source defines, once it checks: in the editor's own scope (null), which the canvas sees, or in a scope below it by name. A name already there gets the new definition, and what's on the canvas moves onto it.",
					{ target: "registerIn", result: "lastReport" },
				),
				agentTool(
					"add_to_canvas",
					"message",
					["fields"],
					"Add one of the named component to the canvas, beside the editor, with fields (null for its defaults).",
					{ target: "instantiate", result: "lastReport" },
				),
				agentTool(
					"list_scopes",
					"message",
					[],
					"The scopes below the editor's, with their components and how many of each are in use.",
					{ target: "refreshScopes", result: "scopesReport" },
				),
				agentTool(
					"unregister",
					"message",
					["name", "scope"],
					"Take a component away from a scope below (or the editor's own, null), unless something is made of it.",
					{ target: "unregisterIn", result: "lastReport" },
				),
				agentTool(
					"remove_scope",
					"message",
					["scope"],
					"Take a scope below the editor's away, with what's in it, unless something is made of it.",
					{ target: "removeScopeNamed", result: "lastReport" },
				),
			],
		},
	},
	fields: {
		name: t.string(), // The component add puts on the canvas, or its path from a scope below.
		scope: t.string(), // Where register puts it: "" the editor's own scope, else one below.
		source: t.string({ default: EDITOR_STARTER }),
		report: t.string(), // What the last check, preview, register, add or removal said.
		defined: t.array(t.string()), // The names this editor registered in its own scope.
		// One of what was previewed, made in scratch: not part of what's saved, as scratch isn't.
		preview: t.option(t.component(), { sync: "none" }),
		// listScopes' answer, while the scopes panel is open.
		scopes: t.any({ default: [], sync: "none" }),
		// The tool try_preview is running in the preview: its job, and what answers it.
		trying: t.int({ min: 0, sync: "none" }),
		tryingResult: t.option(t.string(), { sync: "none" }),
	},
	queries: {
		get numberedSource() {
			return numbered(this.source);
		},
		get definedText() {
			return this.defined.length === 0 ? "none yet" : this.defined.join(", ");
		},
		// What answers check, preview, register, add_to_canvas and the removals.
		get lastReport() {
			return this.report;
		},
		get scopesReport() {
			return scopesText(this.scopes);
		},
		get hasReport() {
			return this.report !== "";
		},
		get hasPreview() {
			return this.preview !== null;
		},
		get previewName() {
			return this.preview === null ? "" : specOf(this.preview).name;
		},
		// The scopes panel, a row per scope and one per component in it.
		get scopeRows() {
			return this.scopes.flatMap(({ name, components }) => [
				{ isScope: true, scope: name, name: "", text: name },
				...components.map((c) => ({
					isScope: false,
					scope: name,
					name: c.name,
					text: `${c.name} · ${c.live} in use`,
				})),
			]);
		},
		get hasScopes() {
			return this.scopes.length > 0;
		},
		// What its agent is told after every step.
		get summary() {
			const lines = this.source.split("\n").length;
			return [
				`Source: ${lines} lines. Name to add: ${this.name === "" ? "none" : this.name}.`,
				`Registered in the editor's scope: ${this.definedText}.`,
				this.preview === null ? "No preview." : `Previewing ${this.previewName}.`,
				this.report === "" ? "" : `Last: ${this.report}`,
			]
				.filter((line) => line !== "")
				.join("\n");
		},
	},
	view: div(
		{ class: "flex flex-col gap-2 p-3" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			input({
				class: "input input-sm input-bordered w-48 font-mono",
				"aria-label": "Component name",
				placeholder: "Component name",
				value: field("name"),
				"on:input": send("setName", targetValue()),
			}),
			input({
				class: "input input-sm input-bordered w-36 font-mono",
				"aria-label": "Register in scope",
				title: "Where Register puts it: empty for this canvas, else a scope below it",
				placeholder: "scope: here",
				value: field("scope"),
				"on:input": send("setScope", targetValue()),
			}),
			span({ class: "text-xs opacity-60" }, "Registered: ", field("definedText")),
		),
		textarea({
			class: "textarea textarea-bordered h-72 w-full font-mono text-xs",
			"aria-label": "Component source",
			spellcheck: "false",
			value: field("source"),
			"on:input": send("setSource", targetValue()),
		}),
		div(
			{ class: "flex flex-wrap gap-2" },
			button({ class: "btn btn-sm", type: "button", "on:click": send("check") }, "Check"),
			button(
				{ class: "btn btn-sm btn-accent", type: "button", "on:click": send("preview") },
				"Preview",
			),
			button(
				{ class: "btn btn-sm btn-primary", type: "button", "on:click": send("register") },
				"Register",
			),
			button(
				{ class: "btn btn-sm btn-secondary", type: "button", "on:click": send("addToCanvas") },
				"Add to canvas",
			),
		),
		$if(
			field("hasPreview"),
			div(
				{
					class:
						"editor-preview flex flex-col gap-1 rounded-box border border-dashed border-accent p-2",
				},
				div(
					{ class: "flex items-center justify-between text-xs opacity-70" },
					span("Preview · ", field("previewName")),
					button(
						{ class: "btn btn-ghost btn-xs", type: "button", "on:click": send("discardPreview") },
						"Discard",
					),
				),
				render(field("preview")),
			),
			"",
		),
		$if(
			field("hasReport"),
			pre(
				{
					class:
						"editor-report max-h-72 overflow-auto whitespace-pre-wrap rounded-box bg-base-200 p-2 font-mono text-xs",
				},
				field("report"),
			),
			"",
		),
		details(
			{ class: "editor-scopes text-sm", "on:toggle": send("refreshScopes") },
			summary({ class: "cursor-pointer text-xs opacity-70" }, "Scopes below this one"),
			$if(
				field("hasScopes"),
				ul(
					{ class: "mt-1 flex flex-col gap-1" },
					each(
						field("scopeRows"),
						li(
							{ class: "flex items-center gap-2" },
							$if(
								field("isScope"),
								span({ class: "flex-1 font-mono font-bold" }, field("text")),
								span({ class: "flex-1 pl-4 font-mono" }, field("text")),
							),
							$if(
								field("isScope"),
								button(
									{
										class: "btn btn-ghost btn-xs",
										type: "button",
										title: "Remove this scope",
										"on:click": send("removeScopeRow", sourceKey()),
									},
									"Remove scope",
								),
								span(
									{ class: "flex gap-1" },
									button(
										{
											class: "btn btn-ghost btn-xs",
											type: "button",
											title: "Add one to the canvas",
											"on:click": send("addRow", sourceKey()),
										},
										"Add",
									),
									button(
										{
											class: "btn btn-ghost btn-xs",
											type: "button",
											title: "Remove it from its scope",
											"on:click": send("unregisterRow", sourceKey()),
										},
										"Remove",
									),
								),
							),
						),
					),
				),
				span({ class: "text-xs opacity-60" }, "None yet: Preview makes scratch."),
			),
		),
	),
	on: {
		setSource: {
			pure: true,
			args: [t.string()],
			run(next, [source]) {
				next.source = source;
			},
		},
		setName: {
			pure: true,
			args: [t.string()],
			run(next, [name]) {
				next.name = name.trim();
			},
		},
		setScope: {
			pure: true,
			args: [t.string()],
			run(next, [scope]) {
				next.scope = scope.trim();
			},
		},
		replaceInSource: {
			pure: true,
			args: [t.string({ minLength: 1 }), t.string()],
			pre: (self, [find]) => countOf(self.source, find) === 1,
			why(self, [find]) {
				const n = countOf(self.source, find);
				return n === 0
					? "That text isn't in the source: read_source shows it as it is now."
					: `That text is in the source ${n} times: give more of the text around the one to replace.`;
			},
			run(next, [find, replacement]) {
				next.source = this.source.replace(find, () => replacement);
			},
		},
		check: {
			args: [],
			emits: { ask: ["checkComponent"] },
			run(next, _args, ctx) {
				next.report = "Checking…";
				ctx.ask("checkComponent", [this.source, this.scope]);
			},
		},
		preview: {
			args: [],
			emits: { ask: ["defineComponent"] },
			run(next, _args, ctx) {
				next.report = "Previewing…";
				ctx.ask("defineComponent", [this.source, SCRATCH]);
			},
		},
		// Its agent's try_preview: tool, one of the preview's agent tools, called as its agent
		// would (planToolCall). One that runs as it's planned answers now; one that needs a
		// context is sent to the preview, and previewTried answers once it and what it caused
		// ran. No emits: what it sends is the preview's own message, named by the tool.
		tryPreview: {
			args: [t.string({ minLength: 1 }), t.option(t.any())],
			run(next, [tool, args], ctx) {
				if (this.preview === null) {
					next.report = "There's no preview to try: preview it first.";
					return;
				}
				if (!hasAgentMeta(this.preview)) {
					next.report = `${specOf(this.preview).name} has no agent meta, so its agent would have no tools.`;
					return;
				}
				const has = () =>
					`It has: ${toolsFor(this.preview)
						.map((tl) => tl.name)
						.join(", ")}.`;
				const plan = planToolCall(this.preview, { name: tool, arguments: args ?? {} });
				if (plan.done) {
					const { text, isError } = plan.done;
					next.report = isError ? `${tool} failed: ${text}\n${has()}` : `${tool}: ${text}`;
					if (plan.next !== this.preview) next.preview = plan.next;
					const kind = toolsFor(this.preview).find((tl) => tl.name === tool)?.kind;
					if (!isError && kind === "message") next.report += onThePage(plan.next);
					return;
				}
				next.report = `Trying ${tool}…`;
				next.tryingResult = plan.result ?? null;
				next.trying = ctx.sendAt(plan.send.name, plan.send.args, "preview", {
					settled: ["previewTried", [tool]],
				});
			},
		},
		previewTried: {
			args: [t.string(), reportType],
			run(next, [tool, report]) {
				if (report.id !== this.trying || this.preview === null) return;
				const { text, isError } = settledText(this.preview, this.tryingResult, report);
				next.report = `${isError ? `${tool} failed: ${text}` : `${tool}: ${text}`}${onThePage(this.preview)}`;
				next.trying = 0;
			},
		},
		discardPreview: {
			pure: true,
			args: [],
			run(next) {
				next.preview = null;
			},
		},
		register: {
			args: [],
			emits: { ask: ["defineComponent"] },
			run(next, _args, ctx) {
				next.report = "Registering…";
				ctx.ask("defineComponent", [this.source, this.scope]);
			},
		},
		// Its agent's register: in scope, null for the one the editor's scope field says.
		registerIn: {
			args: [t.option(t.string())],
			emits: { ask: ["defineComponent"] },
			run(next, [scope], ctx) {
				next.report = "Registering…";
				ctx.ask("defineComponent", [this.source, scope ?? this.scope]);
			},
		},
		// One of the named component, with fields (its defaults for what they leave out), for the
		// canvas to put beside the editor; it replies placed.
		instantiate: {
			args: [t.option(t.any())],
			emits: { notify: ["placeComponent"] },
			run(next, [fields], ctx) {
				placeOne(next, this.name, fields ?? {}, ctx);
			},
		},
		// The button's: one with its defaults.
		addToCanvas: {
			args: [],
			emits: { notify: ["placeComponent"] },
			run(next, _args, ctx) {
				placeOne(next, this.name, {}, ctx);
			},
		},
		// From the canvas: what it added, by its label and item key.
		placed: {
			args: [t.string(), t.string()],
			emits: { ask: [LIST_SCOPES] },
			run(next, [label, key], ctx) {
				next.report = `Added ${label} to the canvas, as item ${key}.`;
				ctx.ask(LIST_SCOPES);
			},
		},
		refreshScopes: {
			args: [],
			emits: { ask: [LIST_SCOPES] },
			run(_next, _args, ctx) {
				ctx.ask(LIST_SCOPES);
			},
		},
		// The scopes panel's buttons, by row.
		addRow: {
			args: [t.int({ min: 0 })],
			emits: { notify: ["placeComponent"] },
			run(next, [i], ctx) {
				const row = this.scopeRows[i];
				if (row === undefined || row.isScope) return;
				placeOne(next, `${row.scope}/${row.name}`, {}, ctx);
			},
		},
		unregisterRow: {
			args: [t.int({ min: 0 })],
			emits: { ask: ["unregisterComponent"] },
			run(next, [i], ctx) {
				const row = this.scopeRows[i];
				if (row === undefined || row.isScope) return;
				next.report = `Removing ${row.name}…`;
				ctx.ask("unregisterComponent", [row.name, row.scope]);
			},
		},
		removeScopeRow: {
			args: [t.int({ min: 0 })],
			emits: { ask: ["removeScope"] },
			run(next, [i], ctx) {
				const row = this.scopeRows[i];
				if (row === undefined || !row.isScope) return;
				next.report = `Removing scope ${row.scope}…`;
				ctx.ask("removeScope", [row.scope]);
			},
		},
		// Its agent's: name from scope (null: the editor's own).
		unregisterIn: {
			args: [t.string({ minLength: 1 }), t.option(t.string())],
			emits: { ask: ["unregisterComponent"] },
			run(next, [name, scope], ctx) {
				next.report = `Removing ${name}…`;
				ctx.ask("unregisterComponent", [name, scope ?? ""]);
			},
		},
		removeScopeNamed: {
			args: [t.string({ minLength: 1 })],
			emits: { ask: ["removeScope"] },
			run(next, [scope], ctx) {
				next.report = `Removing scope ${scope}…`;
				ctx.ask("removeScope", [scope]);
			},
		},
	},
	answers: {
		checkComponent: {
			ok(next, [report]) {
				next.report = checkReportText(report);
				if (report.ok && this.name === "") next.name = report.components[0] ?? "";
			},
			error(next, [error]) {
				next.report = `It wasn't checked: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.report = "It wasn't checked: this page can't check components.";
			},
		},
		// A preview's: one of the named component in the preview (one already there moved onto
		// the new definition). Registered in its own scope, it tells the canvas, whose kinds it
		// now is.
		defineComponent: {
			ok: {
				emits: { notify: ["componentsRegistered"], ask: [LIST_SCOPES] },
				run(next, [answer], ctx) {
					next.report = defineReportText(answer);
					if (!answer.ok) return;
					ctx.ask(LIST_SCOPES);
					// Where it went, from the editor's scope: "" its own, else a path below.
					const base = ctx.scope?.path.join("/") ?? "";
					const where =
						answer.scope === base ? "" : answer.scope.slice(base === "" ? 0 : base.length + 1);
					const last = this.name.split("/").at(-1);
					const own = answer.registered.includes(last) ? last : (answer.registered[0] ?? "");
					if (where === SCRATCH) {
						let shown = this.preview;
						if (shown === null || specOf(shown).name !== own) {
							const made = ctx.tryMake(`${SCRATCH}/${own}`);
							if (made.err !== undefined) {
								next.report += `\nNo preview: ${made.err.error}.`;
								return;
							}
							shown = made.ok;
							next.preview = shown;
						}
						if (this.name === "") next.name = own;
						next.report += `\nPreviewing ${own}: ${JSON.stringify(plainOf(shown))}${onThePage(shown)}`;
						return;
					}
					next.name = where === "" ? own : `${where}/${own}`;
					if (where !== "") return;
					for (const name of answer.registered) {
						if (!next.defined.includes(name)) next.defined.push(name);
					}
					ctx.notify("componentsRegistered");
				},
			},
			error(next, [error]) {
				next.report = `It wasn't registered: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.report = "It wasn't registered: this page can't register components.";
			},
		},
		listScopes: {
			ok(next, [scopes]) {
				next.scopes = Array.isArray(scopes) ? scopes : [];
			},
		},
		unregisterComponent: {
			ok: {
				emits: { ask: [LIST_SCOPES] },
				run(next, [answer], ctx) {
					next.report = removedText(answer);
					if (answer.ok && answer.scope === "") {
						next.defined = this.defined.filter((name) => name !== answer.name);
					}
					ctx.ask(LIST_SCOPES);
				},
			},
			unhandled(next) {
				next.report = "It wasn't removed: this page can't manage scopes.";
			},
		},
		removeScope: {
			ok: {
				emits: { ask: [LIST_SCOPES] },
				run(next, [answer], ctx) {
					next.report = removedText(answer);
					ctx.ask(LIST_SCOPES);
				},
			},
			unhandled(next) {
				next.report = "It wasn't removed: this page can't manage scopes.";
			},
		},
	},
});

// A hole's kinds with the components registered at runtime beside them: defined is a Set of
// names (what an editor registered, which the page adds to as defineComponent answers). Each
// is listed as defined:<name> while the asker's scope finds it, and made with its defaults.
const DEFINED = "defined:";
export const withDefinedKinds = (handlers, defined) => {
	const definedKinds = ([meta = ""] = [], read) =>
		[...defined].flatMap((name) => {
			const spec = read.scope.lookupSpec(name);
			if (spec === null) return [];
			const says = (uri) => Object.hasOwn(spec.meta ?? {}, uri);
			if (meta !== "" && !says(meta)) return [];
			return [
				{
					id: `${DEFINED}${name}`,
					label: `🧩 ${name}`,
					blurb: "Registered on this page",
					choices: [],
					agent: says(AGENT_META),
					samples: [],
				},
			];
		});
	return {
		...handlers,
		componentKinds: (args, read) => {
			const base = handlers.componentKinds(args, read);
			const add = (kinds) => [...kinds, ...definedKinds(args, read)];
			return base instanceof Promise ? base.then(add) : add(base);
		},
		makeComponent: ([id, choice], read) => {
			if (!id.startsWith(DEFINED)) return handlers.makeComponent([id, choice], read);
			const name = id.slice(DEFINED.length);
			return { content: read.scope.make(name, {}), label: `🧩 ${name}`, width: 0 };
		},
	};
};

export const editorComponents = { ComponentEditor };

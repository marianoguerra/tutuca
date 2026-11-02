// The UI the shell and the agents share (agents get it as kit.ui and list kit.ui.components
// among their own): the data views from components/data-views (JsonView, DataTable, List, the
// pager), ToolCall, which shows a tool call and its result collapsed to a line, and a few view
// fragments that keep the agents' pages alike.
import { components as dataViews, jsonViewArgs } from "../../components/data-views/index.js";
import {
	$if,
	apply,
	button,
	component,
	each,
	field,
	lookupBind,
	render,
	send,
	sourceKey,
	t,
	tag,
} from "../../src/tutuca.js";
import { clip, parse, preview } from "./lib/json.js";

export * from "../../components/data-views/index.js";

const { details, div, h2, h3, li, span, summary, ul } = tag;

const KIND_BADGE = {
	message: "badge-primary",
	view: "badge-info",
	module: "badge-accent",
	shared: "badge-secondary",
};
// The kind's badge: soft, all the same width, before the tool's name.
export const kindBadge = (kind) =>
	`badge badge-soft badge-sm me-2 w-20 shrink-0 justify-center ${KIND_BADGE[kind] ?? "badge-secondary"}`;
// A tool result's text, and its JSON (null when it isn't).
export const resultText = (result) => (result?.content ?? []).map((b) => b.text ?? "").join("\n");
export const resultJson = (result) => {
	const { value, error } = parse(resultText(result));
	return error === "" ? value : null;
};
// running, failed, changed the data or ok, for a tool call's result (null while it runs).
export const callState = (result) =>
	result === null || result === undefined
		? "running"
		: result.isError
			? "failed"
			: result.details?.changed
				? "changed the data"
				: "ok";
// The state badge's classes; bad marks a result the agent judges wrong although it ran.
export const callStateClass = (result, bad = false) => {
	const s = callState(result);
	const color =
		s === "running" ? "badge-ghost" : s === "failed" || bad ? "badge-error" : "badge-success";
	return `badge badge-soft badge-sm shrink-0 ${color}`;
};
// What a custom tool view needs to look like the generic one: its fields and queries (spread them
// into the component's) and its frame, a details whose summary is the kind badge, the tool's name,
// the glimpse getter and the state getter, opening to body.
export const toolCallFields = { call: t.any(), result: t.any(), kind: t.string("message") };
export const toolCallQueries = {
	get kindClass() {
		return kindBadge(this.kind);
	},
	get toolName() {
		return this.call?.name ?? "?";
	},
	get resultText() {
		return resultText(this.result);
	},
	get resultJson() {
		return resultJson(this.result);
	},
	get state() {
		return callState(this.result);
	},
	get stateClass() {
		return callStateClass(this.result);
	},
};
// toolCallQueries plus a view's own queries (getters stay getters).
export const toolCallQueriesWith = (extra = {}) =>
	Object.defineProperties(
		{},
		{
			...Object.getOwnPropertyDescriptors(toolCallQueries),
			...Object.getOwnPropertyDescriptors(extra),
		},
	);
export const toolCallFrame = (glimpse, ...body) =>
	details(
		{ class: "collapse collapse-arrow rounded-box border border-base-300 bg-base-100" },
		// The row is a div of its own: collapse styles a summary's display, which beats flex.
		summary(
			{ class: "collapse-title min-h-0 py-2 text-sm" },
			div(
				{ class: "flex min-w-0 items-center gap-2" },
				span({ class: field("kindClass") }, field("kind")),
				span({ class: "shrink-0 font-mono font-semibold" }, field("toolName")),
				span(
					{ class: "min-w-0 flex-1 truncate font-mono text-xs text-base-content/60" },
					field(glimpse),
				),
				span({ class: field("stateClass") }, field("state")),
			),
		),
		div({ class: "collapse-content flex flex-col gap-1 text-sm" }, ...body),
	);

// A call's arguments on one line, as name: value pairs; a string shows as itself, its line
// breaks as spaces.
export const argsGlimpse = (args) =>
	clip(
		Object.entries(args)
			.map(([k, v]) => `${k}: ${typeof v === "string" ? v.replace(/\s+/g, " ") : preview(v, 60)}`)
			.join(" · "),
		160,
	);

// A tool call with its result: one line (kind, name, a glimpse of the arguments, how it went)
// that opens to the arguments and the result, each a JsonView. call is pi's toolCall block,
// result its toolResult message (null while it runs).
export const ToolCall = component({
	name: "ToolCall",
	fields: {
		...toolCallFields,
		args: t.component("JsonView"),
		output: t.option(t.component("JsonView")),
	},
	queries: toolCallQueriesWith({
		get name() {
			return this.toolName;
		},
		get glimpse() {
			return argsGlimpse(this.call?.arguments ?? {});
		},
		get hasOutput() {
			return this.output !== null;
		},
	}),
	view: toolCallFrame(
		"glimpse",
		render(field("args")),
		$if(field("hasOutput"), render(field("output")), ""),
	),
});

// Keeps a map of derived JsonViews in step with wanted ({ key: text }): views whose text changed
// get the new text (keeping their mode and folds), missing ones are made with make(key, text),
// ones no longer wanted go. views is the draft's map field.
export const syncViews = (views, wanted, make) => {
	for (const key of Object.keys(views)) if (!(key in wanted)) delete views[key];
	for (const [key, text] of Object.entries(wanted)) {
		if (views[key] === undefined) views[key] = make(key, text);
		else if (views[key].text !== text) views[key] = apply(views[key], "set_text", text);
	}
};

// The generic ToolCall for call and result, made with C (components that include ToolCall
// and JsonView).
export const toolCallView = (C, call, result, kind = "message") =>
	C.ToolCall({
		call,
		result,
		kind,
		args: C.JsonView(jsonViewArgs(call?.arguments ?? {}, { label: "Arguments" })),
		output: result
			? C.JsonView(jsonViewArgs(resultText(result), { label: result.isError ? "Error" : "Result" }))
			: null,
	});

// --- view fragments ------------------------------------------------------------------------------

// An agent's page title, with its headline getter on the right.
export const labHeader = (title, headline = "headline") =>
	div(
		{ class: "flex items-center justify-between gap-2" },
		h2({ class: "text-lg font-semibold" }, title),
		span({ class: "text-sm opacity-70" }, field(headline)),
	);
// A section heading.
export const section = (text, ...extra) =>
	h3({ class: "text-sm font-semibold uppercase opacity-60" }, text, ...extra);
// A "+ thing" button sending handler(...args).
export const addButton = (label, handler, ...args) =>
	button({ class: "btn btn-sm self-start", "on:click": send(handler, ...args) }, `+ ${label}`);
// The strings of a list getter, one per line, in cls (text-error, text-warning, …).
export const messageList = (listField, cls = "text-error") =>
	ul(
		{ class: `flex flex-col gap-0.5 text-xs ${cls}` },
		each(field(listField), li(lookupBind("value"))),
	);
// A status grid (lib/grid.js) from a getter giving { cells, gridStyle }: clicking a cell sends
// handler(index).
export const gridView = (gridField = "grid", handler = "cycle_cell") =>
	div(
		{ class: "grid items-center gap-1 text-sm", style: field(`${gridField}Style`) },
		each(
			field(`${gridField}Cells`),
			button(
				{
					class: field("cls"),
					title: field("title"),
					disabled: field("fixed"),
					"on:click": send(handler, sourceKey()),
				},
				field("label"),
			),
		),
	);

export const components = { ...dataViews, ToolCall };

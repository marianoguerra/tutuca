// A conversation with a model as pi-ai keeps it (its transcript: user messages, the model's
// messages with their text and tool calls, and tool results), shown as it reads: who says what,
// each tool call with its arguments and each result under it, a failed one in red. An agent
// keeps its conversation in one and appends to it; its messages are plain JSON, so they can be
// sent as is. Each message's rows are entries beside them, a tool call's arguments a JSON tree.

import { CLASSES_META } from "../../src/meta/index.js";
import {
	$if,
	apply,
	component,
	field,
	render,
	renderEach,
	scopeOf,
	send,
	specOf,
	t,
	tag,
} from "../../src/tutuca.js";
import { dataMeta } from "../common/data.js";
import { metaFor } from "../common/meta.js";
import { jsonComponents, jsonRoot } from "../json/index.js";
import { MD_VIEW } from "../markdown/element.js";

const { button, div, p, pre, span } = tag;

const textOf = (content) =>
	typeof content === "string"
		? content
		: (content ?? [])
				.filter((b) => b?.type === "text")
				.map((b) => b.text)
				.join("\n");
const pretty = (v) => {
	try {
		return JSON.stringify(v ?? {}, null, 2);
	} catch {
		return String(v);
	}
};
// Results that are JSON read better indented.
const prettyText = (text) => {
	try {
		const v = JSON.parse(text);
		return typeof v === "object" && v !== null ? JSON.stringify(v, null, 2) : text;
	} catch {
		return text;
	}
};
// Every entry is a card as wide as the transcript: a sequence of cards, not a chat. Its border's
// color says what it is; the background is the same for all.
const ROW = "w-full rounded-box border bg-base-100 px-3 py-2 text-sm";
const STYLE = {
	user: `${ROW} border-primary/60`,
	assistant: `${ROW} border-base-300`,
	call: `${ROW} border-info/60`,
	result: `${ROW} border-success/60`,
	error: `${ROW} border-error/60`,
	group: `${ROW} border-info/60`,
};
// Every class an entry's or a group's card can have.
const STYLE_CLASSES = Object.values(STYLE).join(" ");
const TOGGLE = "btn btn-ghost btn-xs ml-auto h-5 min-h-0 px-1";
// The rows a message shows as: one for its text, one per tool call.
export const transcriptRows = (messages) =>
	messages.flatMap((m, i) => {
		const row = (kind, label, text, mono = false, more = {}) => ({
			key: `${i}`,
			kind,
			label,
			text,
			mono,
			cls: STYLE[kind],
			...more,
		});
		if (m?.role === "user") return [row("user", "User", textOf(m.content))];
		if (m?.role === "toolResult") {
			const label = `${m.isError ? "✗" : "✓"} ${m.toolName}`;
			const text = prettyText(textOf(m.content));
			const more = { callId: m.toolCallId ?? "", isError: Boolean(m.isError) };
			return [row(m.isError ? "error" : "result", label, text, true, more)];
		}
		if (m?.role === "assistant") {
			const rows = [];
			for (const b of Array.isArray(m.content) ? m.content : []) {
				if (b?.type === "text" && b.text.trim() !== "")
					rows.push(row("assistant", "Assistant", b.text));
				if (b?.type === "toolCall")
					rows.push(
						row("call", `📞 ${b.name}`, pretty(b.arguments), true, {
							args: b.arguments ?? {},
							callId: b.id ?? "",
						}),
					);
			}
			if (m.stopReason === "error" || m.stopReason === "aborted") {
				rows.push(row("error", "Model error", m.errorMessage ?? m.stopReason));
			}
			return rows;
		}
		return [];
	});

// What an entry says under its header: a call's arguments and its result (or that it's still
// running), else its text: the assistant's rendered as markdown.
const entryBody = () =>
	$if(
		field("hasArgs"),
		div(
			{ class: "flex flex-col gap-1.5" },
			div({ class: "font-mono text-xs" }, render(field("args"))),
			$if(
				field("hasResult"),
				div(
					{ class: "border-t border-base-300 pt-1.5" },
					span({ class: "block text-xs font-semibold opacity-70" }, field("resultLabel")),
					pre({ class: "overflow-x-auto whitespace-pre-wrap font-mono text-xs" }, field("result")),
				),
				p({ class: "text-xs italic opacity-60" }, "Running…"),
			),
		),
		$if(
			field("mono"),
			pre({ class: "overflow-x-auto whitespace-pre-wrap font-mono text-xs" }, field("text")),
			$if(
				field("isMarkdown"),
				tag[MD_VIEW]({ class: "block min-w-0", content: field("text") }),
				p({ class: "whitespace-pre-wrap" }, field("text")),
			),
		),
	);
// A call's border says how it went: running, done or failed.
const CALL_STYLE = { none: STYLE.call, running: STYLE.call, ok: STYLE.result, failed: STYLE.error };
const MARKS = { none: "", running: "…", ok: "✓", failed: "✗" };

// A row of a transcript: who says it and what. A tool call is one card with its result: its
// header says the tool and how it went (… running, ✓ done, ✗ failed), and its toggle shows its
// arguments, as a JSON tree, and what running it gave back.
export const TranscriptEntry = component({
	name: "TranscriptEntry",
	meta: { [CLASSES_META]: { classes: STYLE_CLASSES } },
	fields: {
		kind: t.enum("user", "assistant", "call", "result", "error"),
		label: t.string(),
		text: t.string(),
		mono: t.boolean(),
		args: t.option(t.component("JsonRoot")),
		open: t.boolean(false), // Whether a tool call shows its arguments: it starts collapsed.
		// A call's: the id its result answers, how it went, and what it gave back.
		callId: t.string(),
		status: t.enum("none", "running", "ok", "failed"), // none: not a call.
		result: t.string(),
	},
	queries: {
		get cls() {
			return this.kind === "call" ? CALL_STYLE[this.status] : STYLE[this.kind];
		},
		get hasArgs() {
			return this.args !== null;
		},
		// Whether its text is the model's, which writes markdown.
		get isMarkdown() {
			return this.kind === "assistant";
		},
		get isClosed() {
			return this.hasArgs && !this.open;
		},
		get hasResult() {
			return this.status === "ok" || this.status === "failed";
		},
		get mark() {
			return this.kind === "call" ? MARKS[this.status] : "";
		},
		get resultLabel() {
			return this.status === "failed" ? "Failed" : "Result";
		},
		get toggleIcon() {
			return this.open ? "▾" : "▸";
		},
		get toggleTitle() {
			return this.open ? "Hide the call" : "Show the call";
		},
	},
	view: div(
		{ class: field("cls"), "data-kind": field("kind"), "data-status": field("status") },
		div(
			{ class: "flex items-center gap-1" },
			span({ class: "text-xs font-semibold opacity-70" }, field("label"), " ", field("mark")),
			$if(
				field("hasArgs"),
				button(
					{
						class: TOGGLE,
						title: field("toggleTitle"),
						"aria-expanded": $if(field("open"), "true", "false"),
						"on:click": send("toggle"),
					},
					field("toggleIcon"),
				),
				"",
			),
		),
		$if(field("isClosed"), "", div({ class: "mt-1.5" }, entryBody())),
	),
	on: {
		toggle: {
			pure: true,
			args: [],
			run(next) {
				next.open = !this.open;
			},
		},
		// What running the call gave back.
		setResult: {
			pure: true,
			args: [t.string(), t.boolean()],
			run(next, [result, isError]) {
				next.result = result;
				next.status = isError ? "failed" : "ok";
			},
		},
	},
});
// Consecutive tool calls, as one card: collapsed, how many and which tools; expanded, each call.
export const MessageGroup = component({
	name: "MessageGroup",
	meta: { [CLASSES_META]: { classes: STYLE_CLASSES } },
	fields: {
		entries: t.array(t.component("TranscriptEntry")),
		open: t.boolean(false),
	},
	queries: {
		// Its border says how its calls went: one failed, all done, or some still running.
		get cls() {
			if (this.entries.some((e) => e.status === "failed")) return STYLE.error;
			return this.entries.every((e) => e.status === "ok") ? STYLE.result : STYLE.group;
		},
		get summary() {
			const calls = this.entries.map((e) => `${e.label.replace(/^📞 /, "")} ${e.mark}`);
			return `📞 ${this.entries.length} tool calls: ${calls.join(", ")}`;
		},
		get toggleIcon() {
			return this.open ? "▾" : "▸";
		},
		get toggleTitle() {
			return this.open ? "Hide the tool calls" : "Show the tool calls";
		},
	},
	view: div(
		{ class: field("cls"), "data-kind": "group" },
		div(
			{ class: "flex items-center gap-1" },
			span({ class: "text-xs font-semibold opacity-70" }, field("summary")),
			button(
				{
					class: TOGGLE,
					title: field("toggleTitle"),
					"aria-expanded": $if(field("open"), "true", "false"),
					"on:click": send("toggle"),
				},
				field("toggleIcon"),
			),
		),
		$if(
			field("open"),
			div({ class: "mt-1.5 flex flex-col gap-2" }, renderEach(field("entries"))),
			"",
		),
	),
	on: {
		toggle: {
			pure: true,
			args: [],
			run(next) {
				next.open = !this.open;
			},
		},
		add: {
			pure: true,
			args: [t.component("TranscriptEntry")],
			run(next, [entry]) {
				next.entries.push(entry);
			},
		},
		// The result of its call callId.
		setResult: {
			pure: true,
			args: [t.string(), t.string(), t.boolean()],
			run(next, [callId, result, isError]) {
				const at = this.entries.findIndex((e) => e.callId === callId);
				if (at !== -1) next.entries[at] = apply(next.entries[at], "setResult", result, isError);
			},
		},
	},
});
const isCall = (e) => specOf(e).name === "TranscriptEntry" && e.kind === "call";
const isGroup = (e) => specOf(e).name === "MessageGroup";
// Where in entries the call callId waiting for its result is, alone or in a group; -1 if not.
const callAt = (entries, callId) =>
	entries.findLastIndex((e) =>
		isGroup(e)
			? e.entries.some((c) => c.callId === callId && c.status === "running")
			: isCall(e) && e.callId === callId && e.status === "running",
	);
// entries with a result: on its call's card, or a card of its own when its call isn't here.
const withResult = (C, entries, { callId, label, text, isError }) => {
	const at = callId === "" ? -1 : callAt(entries, callId);
	if (at === -1) {
		const kind = isError ? "error" : "result";
		return [...entries, C.TranscriptEntry({ kind, label, text, mono: true, args: null })];
	}
	const entry = entries[at];
	const done = isGroup(entry)
		? apply(entry, "setResult", callId, text, isError)
		: apply(entry, "setResult", text, isError);
	return entries.with(at, done);
};
// entries with entry after them: a tool call right after another joins it in a group.
const withEntry = (C, entries, entry) => {
	const last = entries.at(-1);
	if (!isCall(entry) || last === undefined) return [...entries, entry];
	if (isGroup(last)) return [...entries.slice(0, -1), apply(last, "add", entry)];
	if (isCall(last)) return [...entries.slice(0, -1), C.MessageGroup({ entries: [last, entry] })];
	return [...entries, entry];
};

// What a transcript loads: pi-ai messages.
const TRANSCRIPT_SCHEMA = {
	type: "array",
	description:
		"pi-ai messages, in order: { role: user, content }, { role: assistant, content: [text and toolCall blocks] }, { role: toolResult, toolCallId, toolName, content, isError }.",
	items: {
		type: "object",
		properties: { role: { enum: ["user", "assistant", "toolResult"] } },
		required: ["role"],
	},
};
export const Transcript = component({
	name: "Transcript",
	meta: metaFor(
		"Transcript",
		"💬",
		"A conversation with a model: messages, tool calls and their results.",
		460,
		dataMeta(TRANSCRIPT_SCHEMA),
	),
	fields: {
		messages: t.array(t.any()),
		// What the messages show as, made as they're appended: consecutive tool calls grouped.
		entries: t.array(t.component(["TranscriptEntry", "MessageGroup"])),
	},
	queries: {
		get rows() {
			return transcriptRows(this.messages);
		},
		get isEmpty() {
			return this.messages.length === 0;
		},
		get count() {
			return this.messages.length;
		},
		// The messages, what load takes back.
		get asJson() {
			return this.messages;
		},
	},
	view: div(
		{ class: "transcript flex flex-col gap-2" },
		$if(
			field("isEmpty"),
			p({ class: "text-sm italic opacity-50" }, "Nothing said yet."),
			renderEach(field("entries")),
		),
	),
	on: {
		append: {
			pure: true,
			args: [t.array(t.any())],
			run(next, [messages]) {
				const C = scopeOf(this).components;
				let entries = this.entries;
				for (const row of transcriptRows(messages)) {
					const { kind, label, text, mono, args, callId = "" } = row;
					if (row.isError !== undefined) {
						entries = withResult(C, entries, row);
						continue;
					}
					const json = args === undefined ? null : jsonRoot(C, args);
					const status = kind === "call" ? "running" : "none";
					const entry = C.TranscriptEntry({ kind, label, text, mono, args: json, callId, status });
					entries = withEntry(C, entries, entry);
				}
				next.entries = entries;
				next.messages.push(...messages);
			},
		},
		clear: {
			pure: true,
			args: [],
			run(next) {
				next.messages = [];
				next.entries = [];
			},
		},
		// The messages replace the conversation.
		load: {
			pure: true,
			args: [t.array(t.any())],
			run(next, [messages]) {
				apply(apply(next, "clear"), "append", messages);
			},
		},
	},
});

export const transcriptComponents = {
	...jsonComponents,
	Transcript,
	TranscriptEntry,
	MessageGroup,
};

// A conversation to show one with: a prompt, two tool calls (one fails) and the answer.
export const SAMPLE_TRANSCRIPT = [
	{ role: "user", content: "Move the docs card to Done, and drop the old one." },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Moving it, then removing the old card." },
			{
				type: "toolCall",
				id: "call-1",
				name: "move_card",
				arguments: { id: "c00", column: 2, at: 0 },
			},
			{ type: "toolCall", id: "call-2", name: "remove_card", arguments: { id: "c99" } },
		],
		stopReason: "toolUse",
	},
	{
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "move_card",
		content: [
			{
				type: "text",
				text: '0. To do (1): c01 "Port the touch support"\n1. Doing (0): empty\n2. Done (1): c00 "Write the docs"',
			},
		],
		isError: false,
	},
	{
		role: "toolResult",
		toolCallId: "call-2",
		toolName: "remove_card",
		content: [{ type: "text", text: "it can't run with these arguments now: there's no card c99" }],
		isError: true,
	},
	{
		role: "assistant",
		content: [{ type: "text", text: "The docs card is in Done. There's no card c99 to remove." }],
		stopReason: "stop",
	},
];
// A transcript of messages, their entries made.
export const transcript = (C, messages = SAMPLE_TRANSCRIPT) =>
	apply(C.Transcript({}), "append", messages);

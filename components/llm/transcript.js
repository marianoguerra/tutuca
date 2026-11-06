// A conversation with a model as pi-ai keeps it (its transcript: user messages, the model's
// messages with their text and tool calls, and tool results), shown as it reads: who says what,
// each tool call with its arguments and each result under it, a failed one in red. An agent
// keeps its conversation in one and appends to it; its messages are plain JSON, so they can be
// sent as is. Each message's rows are entries beside them, a tool call's arguments a JSON tree.
import {
	$if,
	apply,
	component,
	DATA_META,
	DISPLAY_META,
	field,
	render,
	renderEach,
	scopeOf,
	send,
	specOf,
	t,
	tag,
} from "../../src/tutuca.js";
import { CANVAS_META } from "../canvas/layout.js";
import { jsonComponents, jsonRoot } from "../json/index.js";

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
// Every entry is a card as wide as the transcript: a sequence of cards, not a chat.
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
const TOGGLE = "btn btn-ghost btn-xs ml-auto h-5 min-h-0 px-1";
// The rows a message shows as: one for its text, one per tool call.
export const transcriptRows = (messages) =>
	messages.flatMap((m, i) => {
		const row = (kind, label, text, mono = false, args = undefined) => ({
			key: `${i}`,
			kind,
			label,
			text,
			mono,
			cls: STYLE[kind],
			...(args === undefined ? {} : { args }),
		});
		if (m?.role === "user") return [row("user", "User", textOf(m.content))];
		if (m?.role === "toolResult") {
			const label = `${m.isError ? "✗" : "✓"} ${m.toolName}`;
			return [row(m.isError ? "error" : "result", label, prettyText(textOf(m.content)), true)];
		}
		if (m?.role === "assistant") {
			const rows = [];
			for (const b of Array.isArray(m.content) ? m.content : []) {
				if (b?.type === "text" && b.text.trim() !== "")
					rows.push(row("assistant", "Assistant", b.text));
				if (b?.type === "toolCall")
					rows.push(row("call", `📞 ${b.name}`, pretty(b.arguments), true, b.arguments ?? {}));
			}
			if (m.stopReason === "error" || m.stopReason === "aborted") {
				rows.push(row("error", "Model error", m.errorMessage ?? m.stopReason));
			}
			return rows;
		}
		return [];
	});

// What an entry says under its header: a call's arguments, else its text.
const entryBody = () =>
	$if(
		field("showsArgs"),
		div({ class: "font-mono text-xs" }, render(field("args"))),
		$if(
			field("mono"),
			pre({ class: "overflow-x-auto whitespace-pre-wrap font-mono text-xs" }, field("text")),
			p({ class: "whitespace-pre-wrap" }, field("text")),
		),
	);

// A row of a transcript: who says it and what, a tool call's arguments as a JSON tree, which
// its header's toggle hides and shows.
export const TranscriptEntry = component({
	name: "TranscriptEntry",
	fields: {
		kind: t.enum("user", "assistant", "call", "result", "error"),
		label: t.string(),
		text: t.string(),
		mono: t.boolean(),
		args: t.option(t.component("JsonRoot")),
		open: t.boolean(false), // Whether a tool call shows its arguments: it starts collapsed.
	},
	queries: {
		get cls() {
			return STYLE[this.kind];
		},
		get hasArgs() {
			return this.args !== null;
		},
		get showsArgs() {
			return this.hasArgs && this.open;
		},
		get isClosed() {
			return this.hasArgs && !this.open;
		},
		get toggleIcon() {
			return this.open ? "▾" : "▸";
		},
		get toggleTitle() {
			return this.open ? "Hide the arguments" : "Show the arguments";
		},
	},
	view: div(
		{ class: field("cls"), "data-kind": field("kind") },
		div(
			{ class: "flex items-center gap-1" },
			span({ class: "text-xs font-semibold opacity-70" }, field("label")),
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
	},
});
// Consecutive tool calls, as one card: collapsed, how many and which tools; expanded, each call.
export const MessageGroup = component({
	name: "MessageGroup",
	fields: {
		entries: t.array(t.component("TranscriptEntry")),
		open: t.boolean(false),
	},
	queries: {
		get cls() {
			return STYLE.group;
		},
		get summary() {
			const names = [...new Set(this.entries.map((e) => e.label.replace(/^📞 /, "")))];
			return `📞 ${this.entries.length} tool calls: ${names.join(", ")}`;
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
	},
});
const isCall = (e) => specOf(e).name === "TranscriptEntry" && e.kind === "call";
const isGroup = (e) => specOf(e).name === "MessageGroup";
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
	meta: {
		[DISPLAY_META]: {
			title: "Transcript",
			icon: "💬",
			description: "A conversation with a model: messages, tool calls and their results.",
		},
		[CANVAS_META]: { width: 460 },
		[DATA_META]: { load: "load", data: "asJson", schema: TRANSCRIPT_SCHEMA },
	},
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
				for (const { kind, label, text, mono, args } of transcriptRows(messages)) {
					const json = args === undefined ? null : jsonRoot(C, args);
					entries = withEntry(
						C,
						entries,
						C.TranscriptEntry({ kind, label, text, mono, args: json }),
					);
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

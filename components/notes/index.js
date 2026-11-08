// A notes list for the sync demos. Each field shows a sync level: the title and notes are
// shared (replicated and persisted), the filter is local (kept on this device only) and the
// draft is none (lost on reload).

import { AGENT_META, agentTool, DISPLAY_META } from "../../src/meta/index.js";
import {
	$if,
	apply,
	component,
	each,
	field,
	renderIt,
	scopeOf,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

const { button, div, form, input, label, option, p, select, span } = tag;

export const Note = component({
	name: "Note",
	fields: { text: t.string(), done: t.boolean() },
	view: div(
		{ class: "group flex items-center gap-3 py-1" },
		input({
			type: "checkbox",
			class: "checkbox checkbox-sm",
			"aria-label": "Done",
			checked: field("done"),
			"on:change": send("toggle"),
		}),
		input({
			class: "input input-sm input-ghost flex-1",
			"aria-label": "Note",
			value: field("text"),
			"on:input": send("setText", targetValue()),
		}),
		button(
			{
				class: "btn btn-ghost btn-xs opacity-0 group-hover:opacity-100",
				"aria-label": "Remove note",
				"on:click": send("remove"),
			},
			"✕",
		),
	),
	on: {
		toggle(next) {
			next.done = !this.done;
		},
		setText: {
			pure: true,
			args: [t.string()],
			run(next, [text]) {
				next.text = text;
			},
		},
		setDone: {
			pure: true,
			args: [t.boolean()],
			run(next, [done]) {
				next.done = done;
			},
		},
		remove: {
			emits: { notify: ["removeNote"] },
			run(_next, _args, ctx) {
				ctx.notify("removeNote");
			},
		},
	},
});

const FILTERS = { all: () => true, open: (n) => !n.done, done: (n) => n.done };
const hasNote = (self, i) => Number.isInteger(i) && i >= 0 && i < self.notes.length;
const noNote = (self, [i]) => `there's no note ${i}; they go from 0 to ${self.notes.length - 1}`;

export const Notes = component({
	name: "Notes",
	meta: {
		[DISPLAY_META]: {
			title: "Notes",
			icon: "📝",
			description: "A list of short notes to tick off.",
		},
		// An agent adds, edits, ticks off and removes notes by their index (in the outline).
		[AGENT_META]: {
			prompt:
				"A list of short notes, each open or done, by index from 0 (indexes move when a note is removed: read them from the outline each time).",
			summary: "outline",
			tools: [
				agentTool("add_notes", "message", ["texts"], "Add notes at the end, one per text."),
				agentTool("set_note", "message", ["index", "text"], "Change a note's text."),
				agentTool("set_done", "message", ["index", "done"], "Tick a note off, or open it again."),
				agentTool("remove_note", "message", ["index"], "Remove a note."),
				agentTool("set_title", "message", ["title"], "Change the list's title.", {
					target: "setTitle",
				}),
			],
		},
	},
	fields: {
		title: t.string("Shared notes"),
		notes: t.array(t.component("Note")),
		filter: t.enum("all", "open", "done").sync("local"),
		draft: t.string().sync("none"),
	},
	queries: {
		get summary() {
			const open = this.notes.filter(FILTERS.open).length;
			return `${open} open of ${this.notes.length}`;
		},
		// The title and each note, by index, for an agent.
		get outline() {
			const lines = this.notes.map((n, i) => `${i}. [${n.done ? "x" : " "}] ${n.text}`);
			return `${this.title} (${this.summary})\n${lines.join("\n") || "No notes."}`;
		},
		get isEmpty() {
			return !this.notes.some(FILTERS[this.filter]);
		},
	},
	loops: {
		visible: {
			*iter(items) {
				yield* [...items.entries()].filter(([, note]) => FILTERS[this.filter](note));
			},
		},
	},
	view: div(
		{ class: "mx-auto flex max-w-xl flex-col gap-4 p-4" },
		input({
			class: "input input-lg input-ghost w-full font-semibold",
			"aria-label": "Title",
			value: field("title"),
			"on:input": send("setTitle", targetValue()),
		}),
		form(
			{ class: "flex gap-2", "on:submit": send("add") },
			input({
				class: "input input-sm input-bordered flex-1",
				"aria-label": "New note",
				placeholder: "A new note (not saved until added)",
				value: field("draft"),
				"on:input": send("setDraft", targetValue()),
			}),
			button({ type: "submit", class: "btn btn-sm btn-primary" }, "Add"),
		),
		div(
			{ class: "flex items-center justify-between text-sm" },
			span({ class: "opacity-70" }, field("summary")),
			label(
				{ class: "flex items-center gap-2" },
				"Show (this device only)",
				select(
					{
						class: "select select-sm select-bordered",
						value: field("filter"),
						"on:change": send("setFilter", targetValue()),
					},
					option({ value: "all" }, "All"),
					option({ value: "open" }, "Open"),
					option({ value: "done" }, "Done"),
				),
			),
		),
		div({ class: "flex flex-col" }, each(field("notes"), renderIt(), "visible")),
		$if(field("isEmpty"), p({ class: "py-6 text-center text-sm opacity-60" }, "No notes"), ""),
	),
	on: {
		setTitle: {
			args: [t.string()],
			run(next, [title]) {
				next.title = title;
			},
		},
		setDraft: {
			args: [t.string()],
			run(next, [text]) {
				next.draft = text;
			},
		},
		setFilter: {
			args: [t.enum("all", "open", "done")],
			run(next, [filter]) {
				next.filter = filter;
			},
		},
		add: {
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				const text = this.draft.trim();
				if (text === "") return;
				next.notes.push(ctx.scope.make("Note", { text }));
				next.draft = "";
			},
		},
		add_notes: {
			pure: true,
			args: [t.array(t.string().len(1))],
			run(next, [texts]) {
				const scope = scopeOf(this);
				for (const text of texts) next.notes.push(scope.make("Note", { text }));
			},
		},
		set_note: {
			pure: true,
			args: [t.number().int(), t.string().len(1)],
			pre: (self, [i]) => hasNote(self, i),
			why: noNote,
			run(next, [i, text]) {
				next.notes[i] = apply(next.notes[i], "setText", text);
			},
		},
		set_done: {
			pure: true,
			args: [t.number().int(), t.boolean()],
			pre: (self, [i]) => hasNote(self, i),
			why: noNote,
			run(next, [i, done]) {
				next.notes[i] = apply(next.notes[i], "setDone", done);
			},
		},
		remove_note: {
			pure: true,
			args: [t.number().int()],
			pre: (self, [i]) => hasNote(self, i),
			why: noNote,
			run(next, [i]) {
				next.notes.splice(i, 1);
			},
		},
		removeNote: {
			sourceKey: t.index("notes"),
			run(next, _args, ctx) {
				ctx.stopNext(); // The notes may be inside another component.
				next.notes.splice(ctx.sourceKey, 1);
			},
		},
	},
});

export const notesComponents = { Notes, Note };

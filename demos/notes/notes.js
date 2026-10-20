// A notes list for the sync demos. Each field shows a sync level: the title and notes are
// shared (replicated and persisted), the filter is local (kept on this device only) and the
// draft is none (lost on reload).
import {
	$if,
	component,
	each,
	field,
	renderIt,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";

const { button, div, form, input, label, option, p, select, span } = tag;

export const Note = component({
	name: "Note",
	fields: (t) => ({ text: t.string(), done: t.boolean() }),
	view: div(
		{ class: "group flex items-center gap-3 py-1" },
		input({
			type: "checkbox",
			class: "checkbox checkbox-sm",
			"aria-label": "Done",
			checked: field("done"),
			"@on.change": send("toggle"),
		}),
		input({
			class: "input input-sm input-ghost flex-1",
			"aria-label": "Note",
			value: field("text"),
			"@on.input": send("setText", targetValue()),
		}),
		button(
			{
				class: "btn btn-ghost btn-xs opacity-0 group-hover:opacity-100",
				"aria-label": "Remove note",
				"@on.click": send("remove"),
			},
			"✕",
		),
	),
	on: {
		toggle(draft) {
			draft.done = !this.done;
		},
		setText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.text = text;
			},
		},
		remove: {
			emits: { notify: ["removeNote"] },
			run(_draft, _args, ctx) {
				ctx.notify("removeNote");
			},
		},
	},
});

const FILTERS = { all: () => true, open: (n) => !n.done, done: (n) => n.done };

export const Notes = component({
	name: "Notes",
	fields: (t) => ({
		title: t.string("Shared notes"),
		notes: t.array(t.component("Note")),
		filter: t.enum("all", "open", "done").sync("local"),
		draft: t.string().sync("none"),
	}),
	methods: {
		get summary() {
			const open = this.notes.filter(FILTERS.open).length;
			return `${open} open of ${this.notes.length}`;
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
			"@on.input": send("setTitle", targetValue()),
		}),
		form(
			{ class: "flex gap-2", "@on.submit": send("add") },
			input({
				class: "input input-sm input-bordered flex-1",
				"aria-label": "New note",
				placeholder: "A new note (not saved until added)",
				value: field("draft"),
				"@on.input": send("setDraft", targetValue()),
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
						"@on.change": send("setFilter", targetValue()),
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
			run(draft, [title]) {
				draft.title = title;
			},
		},
		setDraft: {
			args: [t.string()],
			run(draft, [text]) {
				draft.draft = text;
			},
		},
		setFilter: {
			args: [t.enum("all", "open", "done")],
			run(draft, [filter]) {
				draft.filter = filter;
			},
		},
		add: {
			run(draft, _args, ctx) {
				ctx.event?.preventDefault();
				const text = this.draft.trim();
				if (text === "") return;
				draft.notes.push(ctx.scope.make("Note", { text }));
				draft.draft = "";
			},
		},
		removeNote: {
			sourceKey: t.index("notes"),
			run(draft, _args, ctx) {
				draft.notes.splice(ctx.sourceKey, 1);
			},
		},
	},
});

export const notesComponents = { Notes, Note };

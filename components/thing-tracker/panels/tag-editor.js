// Creates or edits a tag and the things in it.

import {
	$if,
	button,
	component,
	each,
	field,
	render,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../../src/tutuca.js";
import { MUTED } from "../common.js";
import { filterThings } from "../model.js";
import { always, closing, panel } from "../panel.js";

const { div, input, label, li, p, span, ul } = tag;

export const TagEditor = component({
	name: "TagEditor",
	fields: {
		mode: t.enum("create", "edit"),
		tagId: t.string(),
		emoji: t.string(),
		title: t.string(),
		pickerOpen: t.boolean(),
		picker: t.component("EmojiPicker"),
		query: t.string(),
		members: t.array(
			t.record({ id: t.string(), emoji: t.string(), title: t.string(), checked: t.boolean() }),
		),
		confirming: t.boolean(),
	},
	methods: {
		get heading() {
			return this.mode === "edit" ? "Edit tag" : "New tag";
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get emojiText() {
			return this.emoji || "＋";
		},
		get selectedText() {
			return `${this.members.filter((m) => m.checked).length} selected`;
		},
		get isEmpty() {
			return this.members.length === 0;
		},
		get cannotSave() {
			return this.title.trim() === "";
		},
		get confirmTitle() {
			return this.isEdit ? "Discard changes?" : "Discard this tag?";
		},
		confirmText: "Nothing has been saved yet.",
		keepLabel: "Keep editing",
	},
	loops: {
		// Alphabetical, by relevance while searching; ticking never reorders.
		members: {
			*iter(items) {
				const entries = [...items.entries()];
				if (this.query.trim() === "") yield* entries;
				else {
					const kept = new Set(filterThings(items, this.query));
					yield* entries.filter(([, m]) => kept.has(m));
				}
			},
		},
	},
	view: panel({
		title: field("heading"),
		description: "Pick which things this tag collects.",
		body: div(
			{ class: "flex flex-col gap-3" },
			div(
				{ class: "flex items-center gap-3" },
				button(
					{
						class:
							"emoji flex size-11 items-center justify-center rounded-xl border border-base-300 text-2xl",
						"aria-label": "Choose an emoji",
						"on:click": send("togglePicker"),
					},
					field("emojiText"),
				),
				input({
					class: "input h-11 flex-1",
					placeholder: "Morning routine",
					"aria-label": "Tag name",
					value: field("title"),
					"on:input": send("setTitle", targetValue()),
				}),
			),
			$if(field("pickerOpen"), render(field("picker")), ""),
			div(
				{ class: "flex items-center justify-between" },
				label({ class: "text-sm font-medium" }, "Things"),
				span({ class: `text-xs ${MUTED}` }, field("selectedText")),
			),
			input({
				type: "search",
				class: "input input-sm w-full",
				placeholder: "Search things…",
				"aria-label": "Search things",
				value: field("query"),
				"on:input": send("setQuery", targetValue()),
			}),
			$if(
				field("isEmpty"),
				p({ class: `text-sm ${MUTED}` }, "No things to add yet."),
				ul(
					{ class: "flex flex-col" },
					each(
						field("members"),
						li(
							{},
							label(
								{ class: "flex items-center gap-3 py-2 text-sm" },
								input({
									type: "checkbox",
									class: "checkbox checkbox-sm",
									checked: field("checked"),
									"on:change": send("toggleMember", sourceKey()),
								}),
								span({ class: "emoji" }, field("emoji")),
								field("title"),
							),
						),
						"members",
					),
				),
			),
		),
		foot: [
			$if(
				field("isEdit"),
				button({ class: "btn btn-outline h-12 text-error", "on:click": send("remove") }, "Delete"),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1",
					disabled: field("cannotSave"),
					"on:click": send("save"),
				},
				$if(field("isEdit"), "Save", "Create"),
			),
		],
	}),
	on: {
		...closing(always),
		togglePicker: {
			args: [],
			run(next) {
				next.pickerOpen = !this.pickerOpen;
			},
		},
		emojiPicked: {
			args: [t.string()],
			run(next, [emoji], ctx) {
				next.emoji = emoji;
				next.pickerOpen = false;
				ctx.stopNext();
			},
		},
		setTitle: {
			args: [t.string()],
			run(next, [title]) {
				next.title = title;
			},
		},
		setQuery: {
			args: [t.string()],
			run(next, [query]) {
				next.query = query;
			},
		},
		toggleMember: {
			args: [t.index("members")],
			run(next, [i]) {
				next.members[i].checked = !this.members[i].checked;
			},
		},
		save: {
			args: [],
			emits: { notify: ["saveTag"] },
			run(_next, _args, ctx) {
				if (this.cannotSave) return;
				const thingIds = this.members.filter((m) => m.checked).map((m) => m.id);
				const tag = { id: this.tagId, title: this.title.trim(), emoji: this.emoji, thingIds };
				ctx.notify("saveTag", [this.mode, tag]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["deleteTag"] },
			run(_next, _args, ctx) {
				ctx.notify("deleteTag", [this.tagId]);
			},
		},
	},
});

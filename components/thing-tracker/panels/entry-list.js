// The entries of a thing, a tag or a day, to open one in the event editor.

import {
	$if,
	button,
	component,
	each,
	field,
	send,
	sourceKey,
	t,
	tag,
} from "../../../src/tutuca.js";
import { MUTED } from "../common.js";
import { closing, panel } from "../panel.js";

const { div, li, span, ul } = tag;

const entryRow = () =>
	t.record({
		id: t.string(),
		head: t.string(),
		line: t.string(),
		notes: t.string(),
		recorded: t.string(),
	});
// A list of entries: of one thing in one bucket, or all of them.
export const EntryList = component({
	name: "EntryList",
	fields: {
		heading: t.string("All entries"),
		subtitle: t.string(),
		rows: t.array(entryRow()),
		remaining: t.number().int().min(0),
		confirming: t.boolean(),
	},
	methods: {
		get isEmpty() {
			return this.rows.length === 0;
		},
		get hasMore() {
			return this.remaining > 0;
		},
		get moreText() {
			return `Show ${Math.min(this.remaining, 200)} more (${this.remaining} left)`;
		},
		confirmTitle: "",
		confirmText: "",
		keepLabel: "",
	},
	view: panel({
		title: field("heading"),
		description: field("subtitle"),
		body: div(
			{},
			ul(
				{ class: "divide-y divide-base-300/60" },
				$if(field("isEmpty"), li({ class: `py-4 text-sm ${MUTED}` }, "No entries."), ""),
				each(
					field("rows"),
					li(
						{ class: "flex items-center gap-2 py-2.5" },
						button(
							{ class: "min-w-0 flex-1 text-left", "@on.click": send("open", sourceKey()) },
							$if(field("head"), div({ class: "text-sm font-medium" }, field("head")), ""),
							div({ class: "text-sm tabular-nums" }, field("line")),
							$if(field("notes"), div({ class: `truncate text-xs ${MUTED}` }, field("notes")), ""),
							$if(
								field("recorded"),
								div({ class: "text-[0.6875rem] opacity-50" }, field("recorded")),
								"",
							),
						),
						span({ class: "opacity-40" }, "›"),
						button(
							{
								class: "btn btn-ghost btn-square btn-sm",
								"aria-label": "Delete entry",
								"@on.click": send("remove", sourceKey()),
							},
							"🗑",
						),
					),
				),
			),
			$if(
				field("hasMore"),
				button(
					{ class: "btn btn-outline mt-3 w-full", "@on.click": send("more") },
					field("moreText"),
				),
				"",
			),
		),
		foot: button(
			{ class: "btn btn-outline h-12 flex-1", "@on.click": send("requestClose") },
			"Close",
		),
	}),
	on: {
		...closing(() => false),
		open: {
			args: [t.index("rows")],
			emits: { notify: ["editEntry"] },
			run(_draft, [i], ctx) {
				ctx.notify("editEntry", [this.rows[i].id]);
			},
		},
		remove: {
			args: [t.index("rows")],
			emits: { notify: ["deleteEntry"] },
			run(_draft, [i], ctx) {
				ctx.notify("deleteEntry", [this.rows[i].id]);
			},
		},
		more: {
			args: [],
			emits: { notify: ["moreEntries"] },
			run(_draft, _args, ctx) {
				ctx.notify("moreEntries");
			},
		},
	},
});

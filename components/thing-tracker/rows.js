// The small components the app lists: a thing, a tag, a section of Track and a bucket of Insights.

import {
	$if,
	button,
	component,
	each,
	field,
	provided,
	renderIt,
	send,
	sourceKey,
	t,
	tag,
} from "../../src/tutuca.js";
import { MUTED, measureRef, plural } from "./common.js";

const { div, h2, li, p, section, span } = tag;

// One thing: a button on Track, a row in Manage.
export const Thing = component({
	name: "Thing",
	fields: (t) => ({
		id: t.string(),
		emoji: t.string("⭐").len(1, 16),
		title: t.string().len(0, 120),
		description: t.string(),
		measurements: t.array(measureRef(t)),
		color: t.string(),
		archived: t.boolean(),
		bundleId: t.string(),
		// Kept by the app from the events.
		total: t.number().int().min(0),
		lastText: t.string("never"),
		tagsText: t.string("No tags"),
	}),
	methods: {
		get hasMeasurements() {
			return this.measurements.length > 0;
		},
		get ariaLabel() {
			return this.total === 0
				? `Log ${this.title}, never logged`
				: `Log ${this.title}, logged ${this.total} times, last ${this.lastText}`;
		},
		get hint() {
			return `${this.title} — tap to log now, hold to pick a time`;
		},
		get borderStyle() {
			return this.color === "" ? "" : `border-color: ${this.color}`;
		},
	},
	views: {
		main: button(
			{
				class:
					"flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-base-300 bg-base-100 px-1 py-2 select-none transition-transform active:scale-95",
				style: field("borderStyle"),
				title: field("hint"),
				"aria-label": field("ariaLabel"),
				"@on.click": send("tap"),
				"@on.contextmenu": send("hold"),
			},
			span(
				{ class: "emoji relative text-3xl leading-none" },
				field("emoji"),
				$if(
					field("hasMeasurements"),
					span({ class: "absolute -top-0.5 -right-2 text-[0.5rem] opacity-60" }, "📏"),
					"",
				),
			),
			span(
				{ class: "w-full truncate text-center text-[0.6875rem] leading-tight font-medium" },
				field("title"),
			),
			span({ class: `text-[0.625rem] leading-none tabular-nums ${MUTED}` }, field("lastText")),
		),
		compact: button(
			{
				class:
					"flex aspect-square items-center justify-center rounded-xl border border-base-300 bg-base-100 select-none transition-transform active:scale-95",
				style: field("borderStyle"),
				title: field("hint"),
				"aria-label": field("ariaLabel"),
				"@on.click": send("tap"),
				"@on.contextmenu": send("hold"),
			},
			span({ class: "emoji text-3xl leading-none" }, field("emoji")),
		),
		row: li(
			{},
			button(
				{ class: "flex w-full items-center gap-3 py-2.5 text-left", "@on.click": send("edit") },
				span({ class: "emoji text-2xl" }, field("emoji")),
				span(
					{ class: "min-w-0 flex-1" },
					span({ class: "block truncate text-sm font-medium" }, field("title")),
					span({ class: `block truncate text-xs ${MUTED}` }, field("tagsText")),
				),
			),
		),
	},
	on: {
		tap: {
			args: [],
			emits: { notify: ["logThing"] },
			run(_draft, _args, ctx) {
				ctx.notify("logThing", [this.id]);
			},
		},
		// A long press on touch, a right click with a mouse.
		hold: {
			args: [],
			emits: { notify: ["backdateThing"] },
			run(_draft, _args, ctx) {
				ctx.event?.preventDefault();
				ctx.notify("backdateThing", [this.id]);
			},
		},
		edit: {
			args: [],
			emits: { notify: ["editThing"] },
			run(_draft, _args, ctx) {
				ctx.notify("editThing", [this.id]);
			},
		},
	},
});

// A tag ("group" in the data).
export const Tag = component({
	name: "Tag",
	fields: (t) => ({
		id: t.string(),
		title: t.string().len(0, 120),
		emoji: t.string(),
		description: t.string(),
		sortOrder: t.number().int().min(0).max(1000000),
		thingIds: t.array(t.string()),
		bundleId: t.string(),
	}),
	methods: {
		get countText() {
			return plural(this.thingIds.length, "thing");
		},
		get shareLabel() {
			return `Share ${this.title}`;
		},
	},
	views: {
		main: span({ class: "inline-flex items-center gap-1" }, field("emoji"), field("title")),
		row: li(
			{ class: "flex items-center gap-2" },
			button(
				{
					class: "flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left",
					"@on.click": send("edit"),
				},
				span({ class: "emoji text-xl" }, field("emoji")),
				span({ class: "min-w-0 flex-1 truncate text-sm font-medium" }, field("title")),
				span({ class: `text-xs ${MUTED}` }, field("countText")),
			),
			button(
				{
					class: "btn btn-ghost btn-square btn-sm",
					"aria-label": field("shareLabel"),
					"@on.click": send("share"),
				},
				"⇪",
			),
		),
	},
	on: {
		edit: {
			args: [],
			emits: { notify: ["editTag"] },
			run(_draft, _args, ctx) {
				ctx.notify("editTag");
			},
		},
		share: {
			args: [],
			emits: { notify: ["shareTag"] },
			run(_draft, _args, ctx) {
				ctx.notify("shareTag");
			},
		},
	},
});

// A collapsible section of Track; its members are the app's things it names.
export const Section = component({
	name: "Section",
	fields: (t) => ({
		id: t.string(),
		title: t.string(),
		emoji: t.string(),
		memberIds: t.array(t.string()),
		isOpen: t.boolean(true),
		compact: t.boolean(),
	}),
	methods: {
		get count() {
			return this.memberIds.length;
		},
		get chevron() {
			return this.isOpen ? "▾" : "▸";
		},
		get gridClass() {
			return this.compact
				? "grid grid-cols-6 gap-2 px-4 pt-1 pb-2 min-[480px]:grid-cols-8"
				: "grid grid-cols-4 gap-2 px-4 pt-1 pb-2 min-[480px]:grid-cols-6";
		},
	},
	loops: {
		members: {
			prepare(items) {
				return new Map(items.map((thing, i) => [thing.id, i]));
			},
			*iter(items, index) {
				for (const id of this.memberIds) {
					const i = index.get(id);
					if (i !== undefined) yield [i, items[i]];
				}
			},
		},
	},
	view: section(
		{ class: "py-1" },
		h2(
			{},
			button(
				{
					class: `flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase select-none ${MUTED}`,
					"aria-expanded": $if(field("isOpen"), "true", "false"),
					"@on.click": send("toggle"),
					"@on.contextmenu": send("toggleAll"),
				},
				span({ class: "w-3" }, field("chevron")),
				span({ class: "emoji" }, field("emoji")),
				span({ class: "truncate" }, field("title")),
				span({ class: "font-normal tabular-nums opacity-60" }, field("count")),
			),
		),
		// The members are the app's things, so a section alone shows only its header.
		$if(
			field("isOpen"),
			$if(
				provided("things"),
				div({ class: field("gridClass") }, each(provided("things"), renderIt(), "members")),
				"",
			),
			"",
		),
	),
	on: {
		toggle: {
			args: [],
			emits: { notify: ["toggleSection"] },
			run(_draft, _args, ctx) {
				ctx.notify("toggleSection", [this.id]);
			},
		},
		// From its members, on their way to the app.
		logThing: { args: [t.string()], run() {} },
		backdateThing: { args: [t.string()], run() {} },
		toggleAll: {
			args: [],
			emits: { notify: ["toggleAllSections"] },
			run(_draft, _args, ctx) {
				ctx.event?.preventDefault();
				ctx.notify("toggleAllSections");
			},
		},
	},
});

// A bucket of Insights, or the quiet days between two.
export const Bucket = component({
	name: "Bucket",
	fields: (t) => ({
		label: t.string(),
		start: t.number().int(),
		end: t.number().int(),
		total: t.number().int().min(0),
		gap: t.number().int().min(0),
		chips: t.array(
			t.record({
				thingId: t.string(),
				emoji: t.string(),
				aria: t.string(),
				tip: t.string(),
				mark: t.string(),
			}),
		),
	}),
	methods: {
		get isGap() {
			return this.gap > 0;
		},
		get gapText() {
			return `· ${plural(this.gap, "quiet day")} ·`;
		},
	},
	view: $if(
		field("isGap"),
		p({ class: "px-4 py-2 text-center text-xs opacity-60" }, field("gapText")),
		section(
			{ class: "border-b border-base-300/60 px-4 py-3" },
			h2(
				{
					class: `mb-2 flex items-baseline gap-2 text-xs font-semibold tracking-wide uppercase ${MUTED}`,
				},
				span(field("label")),
				span({ class: "font-normal tabular-nums opacity-60" }, field("total")),
			),
			div(
				{ class: "flex flex-wrap gap-1.5" },
				each(
					field("chips"),
					button(
						{
							class:
								"flex items-center gap-0.5 rounded-lg border border-base-300/60 bg-base-100 py-1.5 pr-1.5 pl-2 active:bg-base-200",
							"aria-label": field("aria"),
							title: field("tip"),
							"@on.click": send("open", sourceKey()),
						},
						span({ class: "emoji text-xl" }, field("emoji")),
						span({ class: `text-xs ${MUTED}` }, field("mark")),
					),
				),
			),
		),
	),
	on: {
		open: {
			args: [t.index("chips")],
			emits: { notify: ["openChip"] },
			run(_draft, [i], ctx) {
				const { start, end, label } = this;
				ctx.notify("openChip", [this.chips[i].thingId, start, end, label]);
			},
		},
	},
});

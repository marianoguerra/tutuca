// A story in the sidebar list.

import { $if, component, field, send, t, tag } from "../../tutuca.js";
import { title } from "./common.js";

const { button, li, span } = tag;

export const StoryLink = component({
	name: "StoryLink",
	fields: {
		id: t.string(),
		group: t.string(),
		name: t.string(),
		showGroup: t.boolean(), // The first of its group shows the group's header.
		groupSize: t.number().int().min(0),
		isGenerated: t.boolean(),
		isSelected: t.boolean(),
		isCollapsed: t.boolean(), // Its group is, and no filter shows it anyway.
	},
	methods: {
		matches(text) {
			return this.id.toLowerCase().includes(text.toLowerCase());
		},
	},
	queries: {
		// Characters, not a rotated one: no class to compile.
		get chevron() {
			return this.isCollapsed ? "▸" : "▾";
		},
	},
	view: li(
		{ class: "flex flex-col" },
		$if(
			field("showGroup"),
			button(
				{
					type: "button",
					class: `${title} mt-3 mb-1 flex items-center gap-1 text-left`,
					"aria-expanded": $if(field("isCollapsed"), "false", "true"),
					"on:click": send("toggleGroup"),
				},
				span({ class: "w-3" }, field("chevron")),
				span({ class: "flex-1" }, field("group")),
				span({ class: "font-normal opacity-60" }, field("groupSize")),
			),
			"",
		),
		$if(
			field("isCollapsed"),
			"",
			button(
				{
					type: "button",
					class: $if(
						field("isSelected"),
						"btn btn-sm btn-primary justify-start font-normal",
						"btn btn-sm btn-ghost justify-start font-normal",
					),
					title: field("id"),
					"on:click": send("select"),
				},
				field("name"),
			),
		),
	),
	on: {
		// What its storybook changes.
		setCollapsed: {
			pure: true,
			args: [t.boolean()],
			run(next, [isCollapsed]) {
				next.isCollapsed = isCollapsed;
			},
		},
		setSelected: {
			pure: true,
			args: [t.boolean()],
			run(next, [isSelected]) {
				next.isSelected = isSelected;
			},
		},
		toggleGroup: {
			args: [],
			emits: { notify: ["groupToggled"] },
			// With Ctrl (⌘ on a Mac), every group does as this one.
			run(_next, _args, ctx) {
				const all = Boolean(ctx.event?.ctrlKey || ctx.event?.metaKey);
				ctx.notify("groupToggled", [this.group, all]);
			},
		},
		select: {
			args: [],
			emits: { notify: ["storySelected"] },
			run(_next, _args, ctx) {
				ctx.notify("storySelected", [this.id]);
			},
		},
	},
});

// A project: a named, colored list of tasks.

import { $if, button, component, field, send, t, tag, targetValue } from "../../src/tutuca.js";
import { COLORS } from "./common.js";

const { div, h2, input, option, select, span } = tag;

export const TodoProject = component({
	name: "TodoProject",
	fields: {
		id: t.string("inbox"),
		name: t.string("Inbox"),
		color: t.enum(...Object.keys(COLORS)),
		isEditing: t.boolean(),
	},
	methods: {
		get dotClass() {
			return `size-3 shrink-0 rounded-full ${COLORS[this.color]}`;
		},
		get canEdit() {
			return this.id !== "inbox";
		},
	},
	view: div(
		{ class: "flex flex-wrap items-center gap-2" },
		span({ class: field("dotClass") }),
		$if(
			field("isEditing"),
			div(
				{ class: "flex flex-wrap items-center gap-2" },
				input({
					class: "input input-sm text-xl font-bold",
					"aria-label": "Project name",
					value: field("name"),
					"on:input": send("setName", targetValue()),
				}),
				select(
					{
						class: "select select-sm w-auto",
						"aria-label": "Color",
						value: field("color"),
						"on:change": send("setColor", targetValue()),
					},
					...Object.keys(COLORS).map((c) => option({ value: c }, c)),
				),
				button({ class: "btn btn-sm btn-primary", "on:click": send("endRename") }, "Done"),
			),
			h2(
				{
					class: "text-xl font-bold",
					title: "Double-click to rename",
					"on:dblclick": send("beginRename"),
				},
				field("name"),
			),
		),
		$if(
			field("canEdit"),
			div(
				{ class: "ml-auto flex gap-1" },
				button({ class: "btn btn-xs btn-ghost", "on:click": send("beginRename") }, "Rename"),
				button({ class: "btn btn-xs btn-ghost text-error", "on:click": send("remove") }, "Delete"),
			),
			"",
		),
	),
	on: {
		beginRename: {
			args: [],
			run(next) {
				if (this.id !== "inbox") next.isEditing = true;
			},
		},
		setName: {
			args: [t.string()],
			run(next, [name]) {
				next.name = name;
			},
		},
		setColor: {
			args: [t.string()],
			run(next, [color]) {
				if (Object.hasOwn(COLORS, color)) next.color = color;
			},
		},
		endRename: {
			args: [],
			run(next) {
				next.isEditing = false;
				next.name = this.name.trim() || "Untitled";
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeProject"] },
			run(_next, _args, ctx) {
				ctx.notify("removeProject");
			},
		},
	},
});

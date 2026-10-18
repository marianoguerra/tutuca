// A task with its subtasks, due date, priority and labels, shown as a row or edited in place.

import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	provided,
	renderEach,
	scopeOf,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { CHECKS, DUES, dueType, ICON_BTN, labelsOf, setDeep, swap, todayType } from "./common.js";
import { dueLabel, dueTone } from "./dates.js";

const { div, form, input, option, p, select, span, textarea } = tag;

export const TodoTask = component({
	name: "TodoTask",
	fields: (t) => ({
		id: t.string(),
		title: t.string(),
		description: t.string(),
		projectId: t.string("inbox"),
		due: dueType(),
		priority: t.enum(4, 1, 2, 3),
		labels: t.array(t.string()),
		isCompleted: t.boolean(),
		isEditing: t.boolean(),
		isExpanded: t.boolean(true),
		subtasks: t.array(t.component("TodoTask")),
		newSubtask: t.string(),
		today: todayType(),
	}),
	methods: {
		matches(query) {
			const q = query.toLowerCase();
			return `${this.title} ${this.description}`.toLowerCase().includes(q);
		},
		get hasDue() {
			return this.due !== "";
		},
		get dueText() {
			return dueLabel(this.due, this.today);
		},
		get dueClass() {
			return `flex items-center gap-1 ${DUES[dueTone(this.due, this.today)]}`;
		},
		get checkClass() {
			return CHECKS[this.priority];
		},
		get titleClass() {
			return this.isCompleted ? "break-words line-through opacity-50" : "break-words";
		},
		get hasDescription() {
			return this.description !== "";
		},
		get hasSubtasks() {
			return this.subtasks.length > 0;
		},
		get showSubtasks() {
			return this.isExpanded && this.subtasks.length > 0;
		},
		get subtaskProgress() {
			const done = this.subtasks.filter((s) => s.isCompleted).length;
			return `${this.isExpanded ? "▾" : "▸"} ${done}/${this.subtasks.length}`;
		},
		get labelsText() {
			return this.labels.map((l) => `@${l}`).join(" ");
		},
	},
	view: div(
		{ class: "flex flex-col border-b border-base-200 last:border-0" },
		$if(
			field("isEditing"),
			div(
				{ class: "my-2 flex flex-col gap-2 rounded-box border border-base-300 p-3" },
				input({
					class: "input input-sm input-ghost w-full text-base font-medium",
					"aria-label": "Task name",
					value: field("title"),
					"@on.input": send("setTitle", targetValue()),
				}),
				textarea({
					class: "textarea textarea-ghost textarea-sm w-full",
					"aria-label": "Description",
					placeholder: "Description",
					value: field("description"),
					"@on.input": send("setDescription", targetValue()),
				}),
				div(
					{ class: "flex flex-wrap items-center gap-2" },
					input({
						type: "date",
						class: "input input-xs w-auto",
						"aria-label": "Due date",
						value: field("due"),
						"@on.change": send("setDue", targetValue()),
					}),
					select(
						{
							class: "select select-xs w-auto",
							"aria-label": "Priority",
							value: field("priority"),
							"@on.change": send("setPriority", targetValue()),
						},
						...[1, 2, 3, 4].map((n) => option({ value: String(n) }, `Priority ${n}`)),
					),
					input({
						class: "input input-xs w-40",
						"aria-label": "Labels",
						placeholder: "@label",
						value: field("labelsText"),
						"@on.change": send("setLabelsText", targetValue()),
					}),
					// Only inside an app, which provides its projects.
					$if(
						provided("projects"),
						select(
							{
								class: "select select-xs w-auto",
								"aria-label": "Project",
								value: field("projectId"),
								"@on.change": send("setProject", targetValue()),
							},
							each(provided("projects"), option({ value: field("id") }, field("name"))),
						),
						"",
					),
				),
				form(
					{ class: "flex gap-2", "@on.submit": send("addSubtask") },
					input({
						class: "input input-xs flex-1",
						"aria-label": "New subtask",
						placeholder: "Add a subtask",
						value: field("newSubtask"),
						"@on.input": send("setNewSubtask", targetValue()),
					}),
					button({ type: "submit", class: "btn btn-xs" }, "Add subtask"),
				),
				div(
					{ class: "flex justify-end" },
					button({ class: "btn btn-sm btn-primary", "@on.click": send("endEdit") }, "Done"),
				),
			),
			div(
				{ class: "group flex items-start gap-3 py-2" },
				input({
					type: "checkbox",
					class: field("checkClass"),
					"aria-label": "Complete task",
					checked: field("isCompleted"),
					"@on.change": send("toggle"),
				}),
				div(
					{ class: "flex min-w-0 flex-1 flex-col gap-0.5" },
					span({ class: field("titleClass"), "@on.dblclick": send("beginEdit") }, field("title")),
					$if(
						field("hasDescription"),
						p({ class: "truncate text-xs text-base-content/60" }, field("description")),
						"",
					),
					div(
						{ class: "flex flex-wrap items-center gap-2 text-xs" },
						$if(field("hasDue"), span({ class: field("dueClass") }, "📅 ", field("dueText")), ""),
						each(
							field("labels"),
							span({ class: "badge badge-ghost badge-xs" }, "@", lookupBind("value")),
						),
						$if(
							field("hasSubtasks"),
							button(
								{ class: "link link-hover opacity-60", "@on.click": send("toggleExpand") },
								field("subtaskProgress"),
							),
							"",
						),
					),
				),
				div(
					{ class: "flex shrink-0 gap-0.5" },
					button({ class: ICON_BTN, title: "Move up", "@on.click": send("moveUp") }, "↑"),
					button({ class: ICON_BTN, title: "Move down", "@on.click": send("moveDown") }, "↓"),
					button({ class: ICON_BTN, title: "Edit", "@on.click": send("beginEdit") }, "✎"),
					button(
						{ class: `${ICON_BTN} text-error`, title: "Delete", "@on.click": send("remove") },
						"🗑",
					),
				),
			),
		),
		$if(field("showSubtasks"), div({ class: "ml-8" }, renderEach(field("subtasks"))), ""),
	),
	on: {
		toggle: {
			args: [],
			post: (prev, next) => next.isCompleted !== prev.isCompleted,
			run(draft) {
				// Completing a task completes its subtasks; reopening it leaves them.
				if (this.isCompleted) draft.isCompleted = false;
				else setDeep(draft, "isCompleted", true);
			},
		},
		setTitle: {
			args: [t.string()],
			run(draft, [title]) {
				draft.title = title;
			},
		},
		setDescription: {
			args: [t.string()],
			run(draft, [description]) {
				draft.description = description;
			},
		},
		setDue: {
			args: [dueType()],
			run(draft, [due]) {
				draft.due = due;
			},
		},
		// From a select: values it doesn't offer are ignored.
		setPriority: {
			args: [t.string()],
			run(draft, [priority]) {
				if (["1", "2", "3", "4"].includes(priority)) draft.priority = Number(priority);
			},
		},
		setLabelsText: {
			args: [t.string()],
			emits: { notify: ["labelsChanged"] },
			run(draft, [text], ctx) {
				draft.labels = labelsOf(text);
				ctx.notify("labelsChanged", [[...draft.labels]]);
			},
		},
		setProject: {
			args: [t.string()],
			run(draft, [projectId]) {
				setDeep(draft, "projectId", projectId);
			},
		},
		beginEdit: {
			args: [],
			run(draft) {
				draft.isEditing = true;
			},
		},
		endEdit: {
			args: [],
			run(draft) {
				draft.isEditing = false;
				draft.title = this.title.trim() || "Untitled";
			},
		},
		toggleExpand: {
			args: [],
			run(draft) {
				draft.isExpanded = !this.isExpanded;
			},
		},
		setNewSubtask: {
			args: [t.string()],
			run(draft, [text]) {
				draft.newSubtask = text;
			},
		},
		addSubtask: {
			args: [],
			post: (prev, next) =>
				prev.newSubtask.trim() === "" || next.subtasks.length === prev.subtasks.length + 1,
			run(draft, _args, ctx) {
				ctx.event?.preventDefault();
				const title = this.newSubtask.trim();
				if (title === "") return;
				const { projectId, today } = this;
				const sub = scopeOf(this).make("TodoTask", {
					id: ctx.uuid(),
					title,
					projectId,
					today,
				});
				draft.subtasks.push(sub);
				draft.newSubtask = "";
				draft.isExpanded = true;
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeTask"] },
			run(_draft, _args, ctx) {
				ctx.notify("removeTask");
			},
		},
		moveUp: {
			args: [],
			emits: { notify: ["moveTask"] },
			run(_draft, _args, ctx) {
				ctx.notify("moveTask", [-1]);
			},
		},
		moveDown: {
			args: [],
			emits: { notify: ["moveTask"] },
			run(_draft, _args, ctx) {
				ctx.notify("moveTask", [1]);
			},
		},
		// From a subtask, which ctx.sourceKey points at.
		removeTask: {
			args: [],
			sourceKey: t.index("subtasks"),
			post: (prev, next) => next.subtasks.length === prev.subtasks.length - 1,
			run(draft, _args, ctx) {
				draft.subtasks.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
		moveTask: {
			args: [t.enum(-1, 1)],
			sourceKey: t.index("subtasks"),
			run(draft, [delta], ctx) {
				const j = ctx.sourceKey + delta;
				if (j >= 0 && j < this.subtasks.length) swap(draft.subtasks, ctx.sourceKey, j);
				ctx.stopNext();
			},
		},
		// The app keeps the list of labels; a subtask's pass through its parents to it.
		labelsChanged: {
			args: [t.array(t.string())],
			run() {},
		},
	},
});

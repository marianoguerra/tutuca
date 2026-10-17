// The core of todoist.com: projects with tasks that have due dates, priorities, labels and
// subtasks; inbox, today, upcoming, project, label and search views; quick add that parses
// "Buy milk tomorrow p1 #Errands @shop".

import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	provided,
	render,
	renderEach,
	renderIt,
	scope,
	scopeOf,
	send,
	seqItem,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { addDays, dayHeader, dueLabel, dueTone, isIso, isoToday } from "./dates.js";
import { parseQuickAdd } from "./quickadd.js";

const { aside, div, form, h2, h3, input, label, main, option, p, select, span, textarea } = tag;

// Dates in a two year window, for generated states.
const isoArb = (fc) => fc.integer({ min: 0, max: 730 }).map((n) => addDays("2026-01-01", n));
const dueType = () =>
	t
		.string()
		.where((d) => d === "" || isIso(d), "isoOrEmpty")
		.arb((fc) => fc.oneof(fc.constant(""), isoArb(fc)));
// The app's date, copied into every task so they can label their due dates.
const todayType = () =>
	t
		.string(() => isoToday())
		.where(isIso, "iso")
		.arb(isoArb);

const CHECKS = {
	1: "checkbox checkbox-sm checkbox-error rounded-full",
	2: "checkbox checkbox-sm checkbox-warning rounded-full",
	3: "checkbox checkbox-sm checkbox-info rounded-full",
	4: "checkbox checkbox-sm rounded-full",
};
const DUES = {
	overdue: "text-error",
	today: "text-success",
	tomorrow: "text-warning",
	week: "text-secondary",
	later: "text-base-content/60",
	none: "",
};
export const COLORS = {
	grey: "bg-neutral",
	red: "bg-error",
	orange: "bg-warning",
	green: "bg-success",
	blue: "bg-info",
	violet: "bg-secondary",
};
const NAV = "btn btn-sm btn-ghost w-full justify-start font-normal";
const NAV_ACTIVE = `${NAV} btn-active`;
const ICON_BTN =
	"btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-70 hover:opacity-100 focus:opacity-100";

const labelsOf = (text) => [
	...new Set(
		text
			.split(/[\s,]+/)
			.map((w) => w.replace(/^@/, "").toLowerCase())
			.filter(Boolean),
	),
];
const setDeep = (draft, key, value) => {
	draft[key] = value;
	for (const sub of draft.subtasks) setDeep(sub, key, value);
};
const allTasks = (tasks) => tasks.flatMap((task) => [task, ...allTasks(task.subtasks)]);
// The index of the next task after i in direction delta that passes keep, or -1.
const neighbor = (items, i, delta, keep) => {
	for (let j = i + delta; j >= 0 && j < items.length; j += delta) {
		if (keep(items[j])) return j;
	}
	return -1;
};
const swap = (items, i, j) => {
	[items[i], items[j]] = [items[j], items[i]];
};

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
		nextSubId: t.number(1).int().min(1),
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
				const { id, projectId, today, nextSubId } = this;
				const sub = scopeOf(this).make("TodoTask", {
					id: `${id}.${nextSubId}`,
					title,
					projectId,
					today,
				});
				draft.subtasks.push(sub);
				draft.nextSubId = nextSubId + 1;
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

export const TodoProject = component({
	name: "TodoProject",
	fields: (t) => ({
		id: t.string("inbox"),
		name: t.string("Inbox"),
		color: t.enum(...Object.keys(COLORS)),
		isEditing: t.boolean(),
	}),
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
					"@on.input": send("setName", targetValue()),
				}),
				select(
					{
						class: "select select-sm w-auto",
						"aria-label": "Color",
						value: field("color"),
						"@on.change": send("setColor", targetValue()),
					},
					...Object.keys(COLORS).map((c) => option({ value: c }, c)),
				),
				button({ class: "btn btn-sm btn-primary", "@on.click": send("endRename") }, "Done"),
			),
			h2(
				{
					class: "text-xl font-bold",
					title: "Double-click to rename",
					"@on.dblclick": send("beginRename"),
				},
				field("name"),
			),
		),
		$if(
			field("canEdit"),
			div(
				{ class: "ml-auto flex gap-1" },
				button({ class: "btn btn-xs btn-ghost", "@on.click": send("beginRename") }, "Rename"),
				button({ class: "btn btn-xs btn-ghost text-error", "@on.click": send("remove") }, "Delete"),
			),
			"",
		),
	),
	on: {
		beginRename: {
			args: [],
			run(draft) {
				if (this.id !== "inbox") draft.isEditing = true;
			},
		},
		setName: {
			args: [t.string()],
			run(draft, [name]) {
				draft.name = name;
			},
		},
		setColor: {
			args: [t.string()],
			run(draft, [color]) {
				if (Object.hasOwn(COLORS, color)) draft.color = color;
			},
		},
		endRename: {
			args: [],
			run(draft) {
				draft.isEditing = false;
				draft.name = this.name.trim() || "Untitled";
			},
		},
		remove: {
			args: [],
			emits: { notify: ["removeProject"] },
			run(_draft, _args, ctx) {
				ctx.notify("removeProject");
			},
		},
	},
});

export const QuickAdd = component({
	name: "QuickAdd",
	fields: (t) => ({ text: t.string() }),
	methods: {
		get parsed() {
			return parseQuickAdd(this.text);
		},
		get hasPreview() {
			return this.text.trim() !== "";
		},
		get previewTitle() {
			return this.parsed.title || "(no title)";
		},
		get previewDue() {
			return this.parsed.dueText;
		},
		get previewPriority() {
			const { priority } = this.parsed;
			return priority < 4 ? `p${priority}` : "";
		},
		get previewProject() {
			const { project } = this.parsed;
			return project === null ? "" : `#${project}`;
		},
		get previewLabels() {
			return this.parsed.labels.map((l) => `@${l}`);
		},
	},
	view: form(
		{ class: "flex flex-col gap-1", "aria-label": "Quick add task", "@on.submit": send("submit") },
		div(
			{ class: "join w-full" },
			input({
				class: "input input-sm join-item flex-1",
				"aria-label": "Quick add",
				placeholder: "e.g. Buy milk tomorrow p1 #Errands @shop",
				value: field("text"),
				"@on.input": send("setText", targetValue()),
			}),
			button({ type: "submit", class: "btn btn-sm btn-primary join-item" }, "Add task"),
		),
		$if(
			field("hasPreview"),
			div(
				{ class: "flex flex-wrap items-center gap-1 text-xs" },
				span({ class: "font-medium" }, field("previewTitle")),
				$if(
					field("previewDue"),
					span({ class: "badge badge-success badge-xs" }, "📅 ", field("previewDue")),
					"",
				),
				$if(
					field("previewPriority"),
					span({ class: "badge badge-error badge-xs" }, field("previewPriority")),
					"",
				),
				$if(
					field("previewProject"),
					span({ class: "badge badge-info badge-xs" }, field("previewProject")),
					"",
				),
				each(
					field("previewLabels"),
					span({ class: "badge badge-ghost badge-xs" }, lookupBind("value")),
				),
			),
			"",
		),
	),
	on: {
		setText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.text = text;
			},
		},
		submit: {
			args: [],
			emits: { notify: ["addTask"] },
			post: (prev, next) => prev.text.trim() === "" || next.text === "",
			run(draft, _args, ctx) {
				ctx.event?.preventDefault();
				if (this.text.trim() === "") return;
				ctx.notify("addTask", [this.text]);
				draft.text = "";
			},
		},
	},
});

const VIEWS = ["inbox", "today", "upcoming", "project", "label", "search"];
const EMPTY = {
	inbox: "Your inbox is clear. Add a task above.",
	today: "Nothing due today. Enjoy!",
	upcoming: "Nothing scheduled.",
	project: "No tasks in this project yet.",
	label: "No tasks with this label.",
	search: "No tasks match your search.",
};

export const TodoApp = component({
	name: "TodoApp",
	fields: (t) => ({
		today: todayType(),
		projects: t.array(t.component("TodoProject")).len(1),
		labels: t.array(t.string()),
		tasks: t.array(t.component("TodoTask")),
		view: t.enum(...VIEWS),
		projectIndex: t.index("projects"),
		labelIndex: t.option(t.index("labels")),
		search: t.string(),
		showCompleted: t.boolean(),
		quickAdd: t.component("QuickAdd"),
		newProject: t.string(),
		nextTaskId: t.number(1).int().min(1),
		nextProjectId: t.number(1).int().min(1),
	}),
	invariants: {
		inboxFirst() {
			return this.projects[0].id === "inbox";
		},
		uniqueProjectIds() {
			return new Set(this.projects.map((p) => p.id)).size === this.projects.length;
		},
		tasksInProjects() {
			const ids = new Set(this.projects.map((p) => p.id));
			return allTasks(this.tasks).every((task) => ids.has(task.projectId));
		},
		tasksKnowToday() {
			return allTasks(this.tasks).every((task) => task.today === this.today);
		},
		labelViewHasLabel() {
			return this.view !== "label" || this.labelIndex !== null;
		},
	},
	provides: {
		projects(b) {
			b.field("projects");
		},
	},
	methods: {
		get currentProject() {
			return this.projects[this.projectIndex];
		},
		get currentLabel() {
			return this.labelIndex === null ? null : this.labels[this.labelIndex];
		},
		inView(task) {
			if (!this.showCompleted && task.isCompleted) return false;
			switch (this.view) {
				case "inbox":
					return task.projectId === "inbox";
				case "project":
					return task.projectId === this.currentProject.id;
				case "today":
					return task.hasDue && task.due <= this.today;
				case "upcoming":
					return task.hasDue && task.due >= this.today;
				case "label":
					return task.labels.includes(this.currentLabel);
				default:
					return this.search.trim() !== "" && task.matches(this.search.trim());
			}
		},
		openCount(keep) {
			return this.tasks.filter((task) => !task.isCompleted && keep(task)).length;
		},
		get isDated() {
			return this.view === "today" || this.view === "upcoming";
		},
		groupOf(task) {
			if (this.view === "upcoming") return dayHeader(task.due, this.today);
			return task.due < this.today ? "Overdue" : "Today";
		},
		pageBinds() {
			const visible = this.tasks.filter((task) => this.inView(task)).length;
			const navClass = (active) => (active ? NAV_ACTIVE : NAV);
			const titles = {
				inbox: "Inbox",
				today: "Today",
				upcoming: "Upcoming",
				project: this.currentProject.name,
				label: `@${this.currentLabel}`,
				search: `Search: ${this.search.trim()}`,
			};
			const count = (n) => (n === 0 ? "" : n);
			return {
				title: titles[this.view],
				isProject: this.view === "project",
				isEmpty: visible === 0,
				emptyText: EMPTY[this.view],
				inboxCount: count(this.openCount((task) => task.projectId === "inbox")),
				todayCount: count(this.openCount((task) => task.hasDue && task.due <= this.today)),
				inboxClass: navClass(this.view === "inbox"),
				todayClass: navClass(this.view === "today"),
				upcomingClass: navClass(this.view === "upcoming"),
				hasCompleted: this.tasks.some((task) => task.isCompleted),
			};
		},
	},
	scopes: {
		page: {
			bind() {
				return this.pageBinds();
			},
		},
	},
	loops: {
		navProjects: {
			// The inbox has its own entry.
			filter(key) {
				return key !== 0;
			},
			enrich({ value, key }) {
				const active = this.view === "project" && this.projectIndex === key;
				const n = this.openCount((task) => task.projectId === value.id);
				return { count: n || "", navClass: active ? NAV_ACTIVE : NAV, dot: value.dotClass };
			},
		},
		navLabels: {
			enrich({ value, key }) {
				const active = this.view === "label" && this.labelIndex === key;
				const n = this.openCount((task) => task.labels.includes(value));
				return { count: n || "", navClass: active ? NAV_ACTIVE : NAV };
			},
		},
		// The tasks of the view; dated views sort by due date and head each group.
		visible: {
			prepare() {
				return { last: null };
			},
			*iter(items) {
				const entries = [...items.entries()].filter(([, task]) => this.inView(task));
				if (this.isDated) {
					entries.sort(([, a], [, b]) => a.due.localeCompare(b.due) || a.priority - b.priority);
				}
				yield* entries;
			},
			key(_index, task) {
				return task.id;
			},
			enrich({ value }, state) {
				if (!this.isDated) return { showHeader: false, header: "" };
				const header = this.groupOf(value);
				const showHeader = header !== state.last;
				state.last = header;
				return { showHeader, header };
			},
		},
	},
	view: scope(
		"page",
		div(
			{
				class:
					"flex min-h-[32rem] flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 md:flex-row",
			},
			aside(
				{ class: "flex w-full shrink-0 flex-col gap-1 bg-base-200 p-3 md:w-64" },
				input({
					class: "input input-sm mb-2 w-full",
					type: "search",
					"aria-label": "Search",
					placeholder: "Search",
					value: field("search"),
					"@on.input": send("setSearch", targetValue()),
				}),
				button(
					{ class: lookupBind("inboxClass"), "@on.click": send("openView", "inbox") },
					"📥 Inbox",
					span({ class: "ml-auto text-xs opacity-60" }, lookupBind("inboxCount")),
				),
				button(
					{ class: lookupBind("todayClass"), "@on.click": send("openView", "today") },
					"📅 Today",
					span({ class: "ml-auto text-xs opacity-60" }, lookupBind("todayCount")),
				),
				button(
					{ class: lookupBind("upcomingClass"), "@on.click": send("openView", "upcoming") },
					"🗓 Upcoming",
				),
				h3({ class: "mt-3 px-3 text-xs font-semibold uppercase opacity-60" }, "Projects"),
				each(
					field("projects"),
					button(
						{ class: lookupBind("navClass"), "@on.click": send("openProject", sourceKey()) },
						span({ class: lookupBind("dot") }),
						field("name"),
						span({ class: "ml-auto text-xs opacity-60" }, lookupBind("count")),
					),
					"navProjects",
				),
				form(
					{
						class: "flex gap-1 px-1",
						"aria-label": "Add project",
						"@on.submit": send("addProject"),
					},
					input({
						class: "input input-xs flex-1",
						"aria-label": "New project",
						placeholder: "New project",
						value: field("newProject"),
						"@on.input": send("setNewProject", targetValue()),
					}),
					button({ type: "submit", class: "btn btn-xs" }, "+"),
				),
				h3({ class: "mt-3 px-3 text-xs font-semibold uppercase opacity-60" }, "Labels"),
				each(
					field("labels"),
					button(
						{ class: lookupBind("navClass"), "@on.click": send("openLabel", sourceKey()) },
						"@",
						lookupBind("value"),
						span({ class: "ml-auto text-xs opacity-60" }, lookupBind("count")),
					),
					"navLabels",
				),
			),
			main(
				{ class: "flex min-w-0 flex-1 flex-col gap-3 p-4" },
				$if(
					lookupBind("isProject"),
					render(seqItem("projects", "projectIndex")),
					h2({ class: "text-xl font-bold" }, lookupBind("title")),
				),
				render(field("quickAdd")),
				div(
					{ class: "flex flex-col" },
					each(
						field("tasks"),
						div(
							{},
							$if(
								lookupBind("showHeader"),
								h3(
									{ class: "mt-3 border-b border-base-300 pb-1 text-sm font-semibold" },
									lookupBind("header"),
								),
								"",
							),
							renderIt(),
						),
						"visible",
					),
				),
				$if(
					lookupBind("isEmpty"),
					p({ class: "py-8 text-center text-sm opacity-60" }, lookupBind("emptyText")),
					"",
				),
				div(
					{
						class:
							"mt-auto flex flex-wrap items-center gap-3 border-t border-base-200 pt-3 text-xs",
					},
					label(
						{ class: "flex items-center gap-1" },
						input({
							type: "checkbox",
							class: "checkbox checkbox-xs",
							checked: field("showCompleted"),
							"@on.change": send("setShowCompleted", targetValue()),
						}),
						"Show completed",
					),
					$if(
						lookupBind("hasCompleted"),
						button(
							{ class: "btn btn-xs btn-ghost", "@on.click": send("clearCompleted") },
							"Clear completed",
						),
						"",
					),
				),
			),
		),
	),
	on: {
		openView: {
			args: [t.enum("inbox", "today", "upcoming")],
			run(draft, [view]) {
				draft.view = view;
			},
		},
		openProject: {
			args: [t.index("projects")],
			run(draft, [key]) {
				draft.projectIndex = key;
				draft.view = key === 0 ? "inbox" : "project";
			},
		},
		openLabel: {
			args: [t.index("labels")],
			run(draft, [key]) {
				draft.labelIndex = key;
				draft.view = "label";
			},
		},
		setSearch: {
			args: [t.string()],
			run(draft, [search]) {
				draft.search = search;
				if (search.trim() !== "") draft.view = "search";
				else if (this.view === "search") draft.view = "inbox";
			},
		},
		setShowCompleted: {
			args: [t.boolean()],
			run(draft, [show]) {
				draft.showCompleted = show;
			},
		},
		clearCompleted: {
			args: [],
			post: (_prev, next) => next.tasks.every((task) => !task.isCompleted),
			run(draft) {
				draft.tasks = draft.tasks.filter((task) => !task.isCompleted);
			},
		},
		setNewProject: {
			args: [t.string()],
			run(draft, [name]) {
				draft.newProject = name;
			},
		},
		addProject: {
			args: [],
			run(draft, _args, ctx) {
				ctx.event?.preventDefault();
				const name = this.newProject.trim();
				if (name === "") return;
				const id = `p${this.nextProjectId}`;
				const color = Object.keys(COLORS)[this.projects.length % 6];
				draft.projects.push(scopeOf(this).make("TodoProject", { id, name, color }));
				draft.nextProjectId = this.nextProjectId + 1;
				draft.newProject = "";
				draft.projectIndex = this.projects.length;
				draft.view = "project";
			},
		},
		// From the shown project's header; its tasks move to the inbox.
		removeProject: {
			args: [],
			sourceKey: t.index("projects"),
			run(draft, _args, ctx) {
				ctx.stopNext();
				const key = ctx.sourceKey;
				if (key === 0) return;
				const { id } = this.projects[key];
				for (const task of draft.tasks)
					if (task.projectId === id) setDeep(task, "projectId", "inbox");
				draft.projects.splice(key, 1);
				draft.projectIndex = 0;
				if (this.view === "project") draft.view = "inbox";
			},
		},
		// From QuickAdd: parses text against today and the project names.
		addTask: {
			args: [t.string()],
			run(draft, [text], ctx) {
				ctx.stopNext();
				const names = this.projects.map((p) => p.name);
				const parsed = parseQuickAdd(text, { today: this.today, projects: names });
				if (parsed.title === "") return;
				const named = this.projects.find((p) => p.name === parsed.project);
				const here = this.view === "project" ? this.currentProject : this.projects[0];
				const due = parsed.due || (this.view === "today" ? this.today : "");
				const task = scopeOf(this).make("TodoTask", {
					id: `t${this.nextTaskId}`,
					title: parsed.title,
					projectId: (named ?? here).id,
					due,
					priority: parsed.priority,
					labels: parsed.labels,
					today: this.today,
				});
				draft.tasks.push(task);
				draft.nextTaskId = this.nextTaskId + 1;
				for (const l of parsed.labels) if (!draft.labels.includes(l)) draft.labels.push(l);
			},
		},
		removeTask: {
			args: [],
			sourceKey: t.index("tasks"),
			post: (prev, next) => next.tasks.length === prev.tasks.length - 1,
			run(draft, _args, ctx) {
				draft.tasks.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
		// Moves past the next task in the same project.
		moveTask: {
			args: [t.enum(-1, 1)],
			sourceKey: t.index("tasks"),
			run(draft, [delta], ctx) {
				ctx.stopNext();
				const i = ctx.sourceKey;
				const { projectId } = this.tasks[i];
				const j = neighbor(this.tasks, i, delta, (task) => task.projectId === projectId);
				if (j >= 0) swap(draft.tasks, i, j);
			},
		},
		labelsChanged: {
			args: [t.array(t.string())],
			run(draft, [labels], ctx) {
				ctx.stopNext();
				for (const l of labels) if (!draft.labels.includes(l)) draft.labels.push(l);
			},
		},
		setToday: {
			args: [todayType()],
			run(draft, [today]) {
				draft.today = today;
				for (const task of draft.tasks) setDeep(task, "today", today);
			},
		},
		// Asks the host for the real date.
		syncToday: {
			args: [],
			emits: { ask: ["today"] },
			run(_draft, _args, ctx) {
				ctx.ask("today");
			},
		},
		todayReplyOk(draft, [today]) {
			if (!isIso(today)) return;
			draft.today = today;
			for (const task of draft.tasks) setDeep(task, "today", today);
		},
		todayReplyError() {},
		todayHandlerNotFound() {},
	},
});

export const todoComponents = { TodoApp, TodoProject, TodoTask, QuickAdd };

// A task described by { title, due (days from today, or an ISO date), priority, labels,
// done, description, project (name), subtasks }, for stories and tests.
const makeTask = (C, today, projects, spec, id) => {
	const { title, due = "", priority = 4, labels = [], done = false, description = "" } = spec;
	const project = projects.find((p) => p.name === spec.project) ?? projects[0];
	const subtasks = (spec.subtasks ?? []).map((sub, i) =>
		makeTask(C, today, projects, { ...sub, project: project.name }, `${id}.${i + 1}`),
	);
	return C.TodoTask({
		id,
		title,
		description,
		projectId: project.id,
		due: typeof due === "number" ? addDays(today, due) : due,
		priority,
		labels,
		isCompleted: done,
		subtasks,
		nextSubId: subtasks.length + 1,
		today,
	});
};
export const todoTask = (C, today, spec, id = "t1") =>
	makeTask(C, today, [C.TodoProject()], spec, id);

// An app from { today, projects: [{ name, color }], tasks: [task spec], view, ... }.
export const todoApp = (C, { today, projects = [], tasks = [], ...rest }) => {
	const all = [
		C.TodoProject(),
		...projects.map(({ name, color = "blue" }, i) =>
			C.TodoProject({ id: `p${i + 1}`, name, color }),
		),
	];
	const made = tasks.map((spec, i) => makeTask(C, today, all, spec, `t${i + 1}`));
	const labels = [...new Set(allTasks(made).flatMap((task) => task.labels))].sort();
	return C.TodoApp({
		today,
		projects: all,
		labels,
		tasks: made,
		nextTaskId: made.length + 1,
		nextProjectId: all.length,
		...rest,
	});
};

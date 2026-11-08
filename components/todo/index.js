// The core of todoist.com: projects with tasks that have due dates, priorities, labels and
// subtasks; inbox, today, upcoming, project, label and search views; quick add that parses
// "Buy milk tomorrow p1 #Errands @shop".

import { AGENT_META, agentTool } from "../../src/meta/index.js";
import {
	$if,
	apply,
	button,
	component,
	each,
	field,
	lookupBind,
	render,
	renderIt,
	scope,
	send,
	seqItem,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { setField } from "../common/card.js";
import { metaFor } from "../common/meta.js";
import {
	allTasks,
	applyEach,
	COLORS,
	dueType,
	hasTaskId,
	NAV,
	NAV_ACTIVE,
	neighbor,
	swap,
	todayType,
} from "./common.js";
import { addDays, dayHeader, isIso } from "./dates.js";
import { TodoProject } from "./project.js";
import { parseQuickAdd } from "./quickadd.js";
import { TodoTask } from "./task.js";

const { aside, div, form, h2, h3, input, label, main, p, span } = tag;

export const QuickAdd = component({
	name: "QuickAdd",
	fields: { text: t.string() },
	queries: {
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
		{ class: "flex flex-col gap-1", "aria-label": "Quick add task", "on:submit": send("submit") },
		div(
			{ class: "join w-full" },
			input({
				class: "input input-sm join-item flex-1",
				"aria-label": "Quick add",
				placeholder: "e.g. Buy milk tomorrow p1 #Errands @shop",
				value: field("text"),
				"on:input": send("setText", targetValue()),
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
		setText: setField("text"),
		submit: {
			args: [],
			emits: { notify: ["addTask"] },
			post: (prev, next) => prev.text.trim() === "" || next.text === "",
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				if (this.text.trim() === "") return;
				ctx.notify("addTask", [this.text]);
				next.text = "";
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

// What an agent does to a task by its id, at any depth: the pure message name(...args).
const onTask = (self, next, id, name, args = []) => {
	self.tasks.forEach((task, i) => {
		if (task.id === id) next.tasks[i] = apply(next.tasks[i], name, ...args);
		else if (hasTaskId(task, id)) next.tasks[i] = apply(next.tasks[i], "applyDeep", id, name, args);
	});
};
const hasTask = (self, id) => allTasks(self.tasks).some((task) => task.id === id);
const noTask = (_self, [id]) => `there's no task ${id}`;
// An agent tool on one task: the app's message name, pure, applying the task's message.
const taskTool = (message, args = [], { pre, why } = {}) => ({
	pure: true,
	args: [t.string(), ...args],
	pre: (self, values) => hasTask(self, values[0]) && (pre?.(self, values) ?? true),
	why: (self, values) =>
		hasTask(self, values[0]) ? (why?.(self, values) ?? "") : noTask(self, values),
	run(next, [id, ...values]) {
		onTask(this, next, id, message, values);
	},
});
const projectNamed = (self, name) =>
	self.projects.find((p) => p.name.toLowerCase() === String(name).toLowerCase());
const taskLine = (task, projects, depth) => {
	const project = projects.find((p) => p.id === task.projectId)?.name ?? task.projectId;
	const parts = [
		`${"  ".repeat(depth)}- [${task.isCompleted ? "x" : " "}] ${task.id} "${task.title}"`,
		task.due === "" ? "" : `due ${task.due}`,
		task.priority < 4 ? `p${task.priority}` : "",
		`#${project}`,
		...task.labels.map((l) => `@${l}`),
	];
	return [
		parts.filter(Boolean).join(" "),
		...task.subtasks.map((s) => taskLine(s, projects, depth + 1)),
	].join("\n");
};
const AGENT = {
	prompt:
		"A todo list like Todoist: projects (Inbox first), labels, and tasks with subtasks, each with an id, a title, an optional due date (YYYY-MM-DD), a priority (1 highest, 4 none) and labels. add_task takes a quick-add line: 'Buy milk tomorrow p1 #Errands @shop' is the task Buy milk, due tomorrow, priority 1, in Errands, labelled shop (due words: today, tomorrow, weekday names, next week, 'in 3 days', 'jan 5'). Everything else names a task by its id from the outline.",
	summary: "outline",
	tools: [
		agentTool("add_task", "message", ["text"], "Add a task from a quick-add line.", {
			target: "addTask",
		}),
		agentTool("complete_task", "message", ["id"], "Complete a task, and its subtasks."),
		agentTool("reopen_task", "message", ["id"], "Open a completed task again."),
		agentTool("rename_task", "message", ["id", "title"], "Change a task's title."),
		agentTool("set_description", "message", ["id", "description"], "Change a task's description."),
		agentTool(
			"set_due",
			"message",
			["id", "due"],
			'Set a task\'s due date, YYYY-MM-DD, or "" for none.',
		),
		agentTool(
			"set_priority",
			"message",
			["id", "priority"],
			"Set a task's priority: 1 highest, 4 none.",
		),
		agentTool("set_labels", "message", ["id", "labels"], "Set a task's labels."),
		agentTool(
			"move_task",
			"message",
			["id", "project"],
			"Move a task, with its subtasks, to a project by name.",
		),
		agentTool("remove_task", "message", ["id"], "Remove a task, with its subtasks."),
		agentTool("add_project", "message", ["name"], "Add a project."),
		agentTool("clear_completed", "message", [], "Remove every completed task.", {
			target: "clearCompleted",
		}),
	],
	skills: {
		"planning.md":
			"Due dates are relative to today, in the outline. Overdue means due before today and not completed. Priority 1 is for what can't wait; most tasks have none (4). Put a task in a project when its name says where it belongs; else leave it in the Inbox.",
	},
};

export const TodoApp = component({
	name: "TodoApp",
	meta: metaFor("Todos", "✅", "Projects, labels and due dates.", null, {
		[AGENT_META]: AGENT,
	}),
	fields: {
		today: todayType(),
		projects: t.array(t.component("TodoProject")).len(1),
		labels: t.array(t.string()),
		tasks: t.array(t.component("TodoTask")),
		view: t.enum(...VIEWS).sync("local"),
		projectIndex: t.index("projects").sync("local"),
		labelIndex: t.option(t.index("labels")).sync("local"),
		search: t.string().sync("none"),
		showCompleted: t.boolean().sync("local"),
		quickAdd: t.component("QuickAdd"),
		newProject: t.string().sync("none"),
	},
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
	queries: {
		// Today, the projects and labels, and every task with its id, for an agent.
		get outline() {
			const tasks = this.tasks.map((task) => taskLine(task, this.projects, 0)).join("\n");
			const labels = this.labels.map((l) => `@${l}`).join(" ") || "none";
			return `Today is ${this.today}. Projects: ${this.projects.map((p) => p.name).join(", ")}. Labels: ${labels}.\n${tasks || "No tasks."}`;
		},
		get currentProject() {
			return this.projects[this.projectIndex];
		},
		get currentLabel() {
			return this.labelIndex === null ? null : this.labels[this.labelIndex];
		},
		get isDated() {
			return this.view === "today" || this.view === "upcoming";
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
					"on:input": send("setSearch", targetValue()),
				}),
				button(
					{ class: lookupBind("inboxClass"), "on:click": send("openView", "inbox") },
					"📥 Inbox",
					span({ class: "ml-auto text-xs opacity-60" }, lookupBind("inboxCount")),
				),
				button(
					{ class: lookupBind("todayClass"), "on:click": send("openView", "today") },
					"📅 Today",
					span({ class: "ml-auto text-xs opacity-60" }, lookupBind("todayCount")),
				),
				button(
					{ class: lookupBind("upcomingClass"), "on:click": send("openView", "upcoming") },
					"🗓 Upcoming",
				),
				h3({ class: "mt-3 px-3 text-xs font-semibold uppercase opacity-60" }, "Projects"),
				each(
					field("projects"),
					button(
						{ class: lookupBind("navClass"), "on:click": send("openProject", sourceKey()) },
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
						"on:submit": send("addProject"),
					},
					input({
						class: "input input-xs flex-1",
						"aria-label": "New project",
						placeholder: "New project",
						value: field("newProject"),
						"on:input": send("setNewProject", targetValue()),
					}),
					button({ type: "submit", class: "btn btn-xs" }, "+"),
				),
				h3({ class: "mt-3 px-3 text-xs font-semibold uppercase opacity-60" }, "Labels"),
				each(
					field("labels"),
					button(
						{ class: lookupBind("navClass"), "on:click": send("openLabel", sourceKey()) },
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
							"on:change": send("setShowCompleted", targetValue()),
						}),
						"Show completed",
					),
					$if(
						lookupBind("hasCompleted"),
						button(
							{ class: "btn btn-xs btn-ghost", "on:click": send("clearCompleted") },
							"Clear completed",
						),
						"",
					),
				),
			),
		),
	),
	on: {
		openView: setField("view", t.enum("inbox", "today", "upcoming")),
		openProject: {
			args: [t.index("projects")],
			run(next, [key]) {
				next.projectIndex = key;
				next.view = key === 0 ? "inbox" : "project";
			},
		},
		openLabel: {
			args: [t.index("labels")],
			run(next, [key]) {
				next.labelIndex = key;
				next.view = "label";
			},
		},
		setSearch: {
			args: [t.string()],
			run(next, [search]) {
				next.search = search;
				if (search.trim() !== "") next.view = "search";
				else if (this.view === "search") next.view = "inbox";
			},
		},
		setShowCompleted: setField("showCompleted", t.boolean()),
		clearCompleted: {
			args: [],
			post: (_prev, next) => next.tasks.every((task) => !task.isCompleted),
			run(next) {
				next.tasks = next.tasks.filter((task) => !task.isCompleted);
			},
		},
		setNewProject: setField("newProject"),
		addProject: {
			args: [],
			run(next, _args, ctx) {
				ctx.event?.preventDefault();
				const name = this.newProject.trim();
				if (name === "") return;
				const id = ctx.uuid();
				const color = Object.keys(COLORS)[this.projects.length % 6];
				next.projects.push(ctx.scope.make("TodoProject", { id, name, color }));
				next.newProject = "";
				next.projectIndex = this.projects.length;
				next.view = "project";
			},
		},
		// From the shown project's header; its tasks move to the inbox.
		removeProject: {
			args: [],
			sourceKey: t.index("projects"),
			run(next, _args, ctx) {
				ctx.stopNext();
				const key = ctx.sourceKey;
				if (key === 0) return;
				const { id } = this.projects[key];
				next.tasks.forEach((task, i) => {
					if (task.projectId === id) next.tasks[i] = apply(task, "setProject", "inbox");
				});
				next.projects.splice(key, 1);
				next.projectIndex = 0;
				if (this.view === "project") next.view = "inbox";
			},
		},
		// The agent's, on a task by its id.
		complete_task: taskTool("complete"),
		reopen_task: taskTool("reopen"),
		rename_task: taskTool("setTitle", [t.string().len(1)]),
		set_description: taskTool("setDescription", [t.string()]),
		set_due: taskTool("setDue", [dueType()]),
		set_priority: taskTool("setPriorityLevel", [t.enum(1, 2, 3, 4)]),
		set_labels: {
			...taskTool("setLabels", [t.array(t.string())]),
			run(next, [id, labels]) {
				onTask(this, next, id, "setLabels", [labels]);
				for (const l of labels) if (!next.labels.includes(l)) next.labels.push(l);
			},
		},
		move_task: {
			...taskTool("setProject", [t.string()], {
				pre: (self, [, project]) => projectNamed(self, project) !== undefined,
				why: (self, [, project]) =>
					`there's no project ${project}; there are ${self.projects.map((p) => p.name).join(", ")}`,
			}),
			run(next, [id, project]) {
				onTask(this, next, id, "setProject", [projectNamed(this, project).id]);
			},
		},
		remove_task: {
			pure: true,
			args: [t.string()],
			pre: (self, [id]) => hasTask(self, id),
			why: noTask,
			run(next, [id]) {
				const at = this.tasks.findIndex((task) => task.id === id);
				if (at !== -1) next.tasks.splice(at, 1);
				else {
					this.tasks.forEach((task, i) => {
						if (hasTaskId(task, id)) next.tasks[i] = apply(next.tasks[i], "removeDeep", id);
					});
				}
			},
		},
		add_project: {
			args: [t.string().len(1)],
			pre: (self, [name]) => projectNamed(self, name) === undefined,
			why: (_self, [name]) => `there's a project ${name} already`,
			run(next, [name], ctx) {
				const color = Object.keys(COLORS)[this.projects.length % 6];
				next.projects.push(ctx.scope.make("TodoProject", { id: ctx.uuid(), name, color }));
			},
		},
		// From QuickAdd: parses text against today and the project names.
		addTask: {
			args: [t.string()],
			run(next, [text], ctx) {
				ctx.stopNext();
				const names = this.projects.map((p) => p.name);
				const parsed = parseQuickAdd(text, { today: this.today, projects: names });
				if (parsed.title === "") return;
				const named = this.projects.find((p) => p.name === parsed.project);
				const here = this.view === "project" ? this.currentProject : this.projects[0];
				const due = parsed.due || (this.view === "today" ? this.today : "");
				const task = ctx.scope.make("TodoTask", {
					id: ctx.uuid(),
					title: parsed.title,
					projectId: (named ?? here).id,
					due,
					priority: parsed.priority,
					labels: parsed.labels,
					today: this.today,
				});
				next.tasks.push(task);
				for (const l of parsed.labels) if (!next.labels.includes(l)) next.labels.push(l);
			},
		},
		removeTask: {
			args: [],
			sourceKey: t.index("tasks"),
			post: (prev, next) => next.tasks.length === prev.tasks.length - 1,
			run(next, _args, ctx) {
				next.tasks.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
		// Moves past the next task in the same project.
		moveTask: {
			args: [t.enum(-1, 1)],
			sourceKey: t.index("tasks"),
			run(next, [delta], ctx) {
				ctx.stopNext();
				const i = ctx.sourceKey;
				const { projectId } = this.tasks[i];
				const j = neighbor(this.tasks, i, delta, (task) => task.projectId === projectId);
				if (j >= 0) swap(next.tasks, i, j);
			},
		},
		labelsChanged: {
			args: [t.array(t.string())],
			run(next, [labels], ctx) {
				ctx.stopNext();
				for (const l of labels) if (!next.labels.includes(l)) next.labels.push(l);
			},
		},
		setToday: {
			args: [todayType()],
			run(next, [today]) {
				next.today = today;
				applyEach(next.tasks, "setToday", today);
			},
		},
		// Asks the host for the real date.
		syncToday: {
			args: [],
			emits: { ask: ["today"] },
			run(_next, _args, ctx) {
				ctx.ask("today");
			},
		},
	},
	answers: {
		today: {
			ok(next, [today]) {
				if (!isIso(today)) return;
				next.today = today;
				applyEach(next.tasks, "setToday", today);
			},
			error() {},
			unhandled() {},
		},
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
		...rest,
	});
};

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
import { allTasks, COLORS, NAV, NAV_ACTIVE, neighbor, setDeep, swap, todayType } from "./common.js";
import { addDays, dayHeader, isIso } from "./dates.js";
import { TodoProject } from "./project.js";
import { parseQuickAdd } from "./quickadd.js";
import { TodoTask } from "./task.js";

const { aside, div, form, h2, h3, input, label, main, p, span } = tag;

export const QuickAdd = component({
	name: "QuickAdd",
	fields: { text: t.string() },
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
		setText: {
			args: [t.string()],
			run(next, [text]) {
				next.text = text;
			},
		},
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

export const TodoApp = component({
	name: "TodoApp",
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
		openView: {
			args: [t.enum("inbox", "today", "upcoming")],
			run(next, [view]) {
				next.view = view;
			},
		},
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
		setShowCompleted: {
			args: [t.boolean()],
			run(next, [show]) {
				next.showCompleted = show;
			},
		},
		clearCompleted: {
			args: [],
			post: (_prev, next) => next.tasks.every((task) => !task.isCompleted),
			run(next) {
				next.tasks = next.tasks.filter((task) => !task.isCompleted);
			},
		},
		setNewProject: {
			args: [t.string()],
			run(next, [name]) {
				next.newProject = name;
			},
		},
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
				for (const task of next.tasks)
					if (task.projectId === id) setDeep(task, "projectId", "inbox");
				next.projects.splice(key, 1);
				next.projectIndex = 0;
				if (this.view === "project") next.view = "inbox";
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
				for (const task of next.tasks) setDeep(task, "today", today);
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
		todayReplyOk(next, [today]) {
			if (!isIso(today)) return;
			next.today = today;
			for (const task of next.tasks) setDeep(task, "today", today);
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

import { step, stories } from "../../src/storybook/index.js";
import { addDays } from "./dates.js";
import { todoApp, todoComponents, todoTask } from "./index.js";

// Stories run on a fixed date, so due labels and views don't change from day to day.
export const TODAY = "2026-10-16"; // A Friday.

const sampleApp = (C, rest = {}) =>
	todoApp(C, {
		today: TODAY,
		projects: [
			{ name: "Work", color: "blue" },
			{ name: "Home", color: "green" },
		],
		tasks: [
			{ title: "Reply to Ada", due: -1, priority: 1, labels: ["email"] },
			{ title: "Water the plants", due: 0, project: "Home", labels: ["chores"] },
			{
				title: "Ship the storybook",
				due: 0,
				priority: 2,
				project: "Work",
				description: "Stories, sequences and stress tests",
				subtasks: [{ title: "Write stories", done: true }, { title: "Stress test them" }],
			},
			{ title: "Plan the week", due: 3, priority: 3, project: "Work" },
			{ title: "Buy carrots", due: 1, labels: ["shop", "chores"] },
			{ title: "Read a paper" },
			{ title: "Book flights", due: 12, project: "Home" },
			{ title: "Old done task", done: true },
		],
		...rest,
	});

// Generated apps keep the app's invariants: the inbox first, tasks in known projects and
// every task on the app's date.
export const todoAppArb = (A) => {
	const { fc } = A;
	const names = ["Work", "Home", "Errands", "Ideas"];
	const taskArb = fc.record({
		title: fc.constantFrom("Buy milk", "Call mom", "Write docs", "Fix bug", "Run"),
		due: fc.option(fc.integer({ min: -5, max: 14 }), { nil: undefined }),
		priority: fc.constantFrom(1, 2, 3, 4),
		labels: fc.subarray(["home", "urgent", "shop"]),
		project: fc.constantFrom(...names, "Inbox"),
		done: fc.boolean(),
		subtasks: fc.array(fc.record({ title: fc.constantFrom("a", "b"), done: fc.boolean() }), {
			maxLength: 2,
		}),
	});
	return fc
		.record({
			days: fc.integer({ min: 0, max: 365 }),
			projects: fc.subarray(names),
			tasks: fc.array(taskArb, { maxLength: 6 }),
			view: fc.constantFrom("inbox", "today", "upcoming"),
		})
		.map(({ days, projects, tasks, view }) =>
			todoApp(A.scope.components, {
				today: addDays("2026-01-01", days),
				projects: projects.map((name) => ({ name })),
				tasks,
				view,
			}),
		);
};

const atTask = (i) => (b) => b.item("tasks", i);
const appMessages = [
	"TodoApp.openView",
	"TodoApp.openProject",
	"TodoApp.openLabel",
	"TodoApp.setSearch",
	"TodoApp.setShowCompleted",
	"TodoApp.clearCompleted",
	"TodoApp.setToday",
	"TodoTask.toggle",
	"TodoTask.setTitle",
	"TodoTask.setDue",
	"TodoTask.setPriority",
	"TodoTask.setLabelsText",
	"TodoTask.toggleExpand",
	"TodoTask.remove",
	"TodoTask.moveUp",
	"TodoTask.moveDown",
	"TodoProject.setName",
	"TodoProject.setColor",
	"QuickAdd.setText",
	"QuickAdd.submit",
];

export default stories({
	title: "Todo",
	components: todoComponents,
	askHandlers: { today: () => "2026-12-24" },
	overrides: { TodoApp: todoAppArb },
	stories: {
		// Tasks alone, in each state.
		"Task/Plain": { make: (C) => todoTask(C, TODAY, { title: "Read a paper" }) },
		"Task/Due today, priority 1": {
			make: (C) => todoTask(C, TODAY, { title: "Reply to Ada", due: 0, priority: 1 }),
		},
		"Task/Overdue with labels": {
			make: (C) =>
				todoTask(C, TODAY, { title: "Pay rent", due: -2, priority: 2, labels: ["home", "money"] }),
		},
		"Task/Upcoming with description": {
			make: (C) =>
				todoTask(C, TODAY, {
					title: "Dentist",
					due: 9,
					priority: 3,
					description: "Bring the insurance card",
				}),
		},
		"Task/Completed": { make: (C) => todoTask(C, TODAY, { title: "Done thing", done: true }) },
		"Task/Editing": {
			make: (C) => {
				const task = todoTask(C, TODAY, { title: "Edit me", due: 1, labels: ["x"] });
				return C.TodoTask({ ...task, isEditing: true });
			},
			sequences: {
				"edit every field": [
					step.event("input", '[aria-label="Task name"]', { value: "Edited" }),
					step.event("input", '[aria-label="Description"]', { value: "More details" }),
					step.event("change", '[aria-label="Due date"]', { value: "2026-10-20" }),
					step.event("change", '[aria-label="Priority"]', { value: "1" }),
					step.event("change", '[aria-label="Labels"]', { value: "@a @b" }),
					step.event("click", "button.btn-primary"),
					step.check("edited", (s) => s.title === "Edited" && s.description === "More details"),
					step.check("due Tuesday", (s) => s.due === "2026-10-20" && s.dueText === "Tuesday"),
					step.check(
						"priority 1, labels a b",
						(s) => s.priority === 1 && s.labels.join() === "a,b",
					),
				],
			},
			pbt: { events: true, maxCommands: 10 },
		},
		// A task with subtasks: messages from subtasks reach their parent.
		"Task/With subtasks": {
			make: (C) =>
				todoTask(C, TODAY, {
					title: "Move house",
					due: 4,
					subtasks: [
						{ title: "Pack books" },
						{ title: "Rent a van", done: true },
						{ title: "Clean" },
					],
				}),
			sequences: {
				"complete, reorder and remove subtasks": [
					step.send("toggle", [], { at: (b) => b.item("subtasks", 0) }),
					step.check("2/3 done", (s) => s.subtaskProgress === "▾ 2/3"),
					step.send("moveTask", [1], { from: (b) => b.item("subtasks", 0) }),
					step.check("Pack books second", (s) => s.subtasks[1].title === "Pack books"),
					step.send("remove", [], { at: (b) => b.item("subtasks", 2) }),
					step.check("two left", (s) => s.subtasks.length === 2),
					step.send("toggle"),
					step.check("completing completes all", (s) => s.subtasks.every((x) => x.isCompleted)),
					step.send("toggleExpand"),
					step.check("collapsed", (s) => !s.showSubtasks),
				],
				"add a subtask": [
					step.send("beginEdit"),
					step.event("input", '[aria-label="New subtask"]', { value: "Label boxes" }),
					step.event("submit", "form"),
					step.check("added", (s) => s.subtasks.at(-1).title === "Label boxes"),
					step.check("with a nested id", (s) => s.subtasks.at(-1).id === "t1.4"),
				],
			},
			pbt: {
				include: [
					"TodoTask.toggle",
					"TodoTask.toggleExpand",
					"TodoTask.remove",
					"TodoTask.moveUp",
					"TodoTask.moveDown",
					"TodoTask.removeTask",
					"TodoTask.moveTask",
					"TodoTask.setNewSubtask",
					"TodoTask.addSubtask",
				],
			},
		},
		"Task/Generated": { arbitrary: (A) => A.instance("TodoTask") },
		// Projects and quick add alone.
		"Project/Inbox": { make: (C) => C.TodoProject() },
		"Project/Work": {
			make: (C) => C.TodoProject({ id: "p1", name: "Work", color: "blue" }),
			sequences: {
				rename: [
					step.event("click", "button"),
					step.event("input", '[aria-label="Project name"]', { value: "Office" }),
					step.event("change", '[aria-label="Color"]', { value: "red" }),
					step.send("endRename"),
					step.check("renamed and red", (s) => s.name === "Office" && s.color === "red"),
				],
			},
			pbt: { events: true },
		},
		"Quick add/Empty": { make: (C) => C.QuickAdd() },
		"Quick add/Preview": {
			make: (C) => C.QuickAdd({ text: "Buy milk tomorrow p1 #Errands @shop @home" }),
			sequences: {
				"type and submit": [
					step.event("input", '[aria-label="Quick add"]', { value: "Call mom next week p2" }),
					step.check("previews the date", (s) => s.previewDue === "next week"),
					step.check("and the priority", (s) => s.previewPriority === "p2"),
					step.event("submit", "form"),
					step.check("cleared", (s) => s.text === ""),
				],
			},
		},
		// The app, in each view.
		"App/Inbox": { make: (C) => sampleApp(C) },
		"App/Today": {
			make: (C) => sampleApp(C, { view: "today" }),
			sequences: {
				"complete and add for today": [
					step.check("overdue and today", (s) => s.pageBinds().todayCount === 3),
					step.send("toggle", [], { at: atTask(0) }),
					step.check("one less", (s) => s.pageBinds().todayCount === 2),
					step.send("setText", ["Stretch"], { at: (b) => b.field("quickAdd") }),
					step.send("submit", [], { at: (b) => b.field("quickAdd") }),
					step.check("due today", (s) => s.tasks.at(-1).due === TODAY),
				],
			},
			pbt: { include: appMessages, maxCommands: 15 },
		},
		"App/Upcoming": { make: (C) => sampleApp(C, { view: "upcoming" }) },
		"App/Project": {
			make: (C) => sampleApp(C, { view: "project", projectIndex: 1 }),
			sequences: {
				"rename, then delete the project": [
					step.event("dblclick", 'h2[title="Double-click to rename"]'),
					step.event("input", '[aria-label="Project name"]', { value: "Job" }),
					step.send("endRename", [], { at: (b) => b.item("projects", 1) }),
					step.check("renamed", (s) => s.projects[1].name === "Job"),
					step.send("remove", [], { at: (b) => b.item("projects", 1) }),
					step.check("gone", (s) => s.projects.length === 2 && s.view === "inbox"),
					step.check("its tasks in the inbox", (s) => s.tasks[2].projectId === "inbox"),
				],
			},
		},
		"App/Label": {
			make: (C) => sampleApp(C, { view: "label", labelIndex: 0 }),
		},
		"App/Search": { make: (C) => sampleApp(C, { search: "the", view: "search" }) },
		"App/Empty": { make: (C) => todoApp(C, { today: TODAY }) },
		"App/Quick add": {
			make: (C) => sampleApp(C),
			sequences: {
				"parse a task into its project": [
					step.event("input", '[aria-label="Quick add"]', {
						value: "Prepare slides fri p1 #Work @talk",
					}),
					step.event("submit", '[aria-label="Quick add task"]'),
					step.check("parsed", (s) => {
						const task = s.tasks.at(-1);
						return (
							task.title === "Prepare slides" &&
							task.due === "2026-10-16" &&
							task.priority === 1 &&
							task.projectId === "p1" &&
							task.labels.join() === "talk"
						);
					}),
					step.check("new label listed", (s) => s.labels.includes("talk")),
					step.event("click", "aside button:nth-of-type(2)"),
					step.check("today view", (s) => s.view === "today"),
				],
				"add a project": [
					step.event("input", '[aria-label="New project"]', { value: "Garden" }),
					step.event("submit", '[aria-label="Add project"]'),
					step.check("opened", (s) => s.view === "project" && s.currentProject.name === "Garden"),
				],
				"edit a task's labels": [
					step.send("beginEdit", [], { at: atTask(5) }),
					step.send("setLabelsText", ["@deep @work"], { at: atTask(5) }),
					step.check(
						"labels listed",
						(s) => s.labels.includes("deep") && s.labels.includes("work"),
					),
					step.send("setProject", ["p2"], { at: atTask(5) }),
					step.check("moved to Home", (s) => s.tasks[5].projectId === "p2"),
				],
			},
			pbt: { include: appMessages, maxCommands: 15 },
		},
		"App/Sync date": {
			make: (C) => sampleApp(C),
			sequences: {
				"ask the host for today": [
					step.send("syncToday"),
					step.check("Christmas eve", (s) => s.today === "2026-12-24"),
					step.check("tasks know", (s) => s.tasks.every((task) => task.today === "2026-12-24")),
				],
			},
		},
		"App/Generated": {
			arbitrary: (A) => A.instance("TodoApp"),
			pbt: { include: appMessages, maxCommands: 15 },
		},
		"App/DOM events": {
			make: (C) => sampleApp(C),
			pbt: { events: true, maxCommands: 15 },
		},
	},
});

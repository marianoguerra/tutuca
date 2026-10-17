// Sample todo apps for stories, tests and the demo.
import { addDays } from "./dates.js";
import { todoApp } from "./index.js";

// Stories run on a fixed date, so due labels and views don't change from day to day.
export const TODAY = "2026-10-16"; // A Friday.

// A small app on TODAY; rest overrides its fields.
export const sampleApp = (C, rest = {}) =>
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

// A week of plans, due relative to today so the today and upcoming views have something.
export const weekOfPlans = (C, today) =>
	todoApp(C, {
		today,
		view: "today",
		projects: [
			{ name: "Work", color: "blue" },
			{ name: "Home", color: "green" },
			{ name: "Errands", color: "orange" },
		],
		tasks: [
			{ title: "Reply to the design review", due: -1, priority: 1, labels: ["email"] },
			{
				title: "Prepare the quarterly report",
				due: 0,
				priority: 2,
				project: "Work",
				description: "Numbers from finance, charts from the dashboard",
				subtasks: [
					{ title: "Collect the numbers", done: true },
					{ title: "Draft the summary" },
					{ title: "Send for review" },
				],
			},
			{ title: "Water the plants", due: 0, project: "Home", labels: ["chores"] },
			{ title: "Buy carrots and coffee", due: 1, project: "Errands", labels: ["shop"] },
			{ title: "Pick up the parcel", due: 2, project: "Errands", priority: 3 },
			{ title: "Plan next sprint", due: 4, priority: 3, project: "Work", labels: ["meeting"] },
			{ title: "Fix the leaking tap", due: 6, project: "Home", labels: ["chores"] },
			{ title: "Book flights for the holidays", due: 20, project: "Home" },
			{ title: "Read the paper Ada sent" },
			{ title: "Renew the library card", done: true },
		],
	});

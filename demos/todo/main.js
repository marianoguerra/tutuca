import { todoApp, todoComponents } from "../../components/todo/index.js";
import { boot, browserHandlers } from "../boot.js";

// A week of plans, due relative to today so the today and upcoming views have something.
const sample = (C, today) =>
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

export const start = (document = globalThis.document, today = browserHandlers.today()) =>
	boot({
		document,
		components: todoComponents,
		askHandlers: { today: browserHandlers.today },
		make: (C) => sample(C, today),
	});

if (globalThis.document?.getElementById("app")) start();

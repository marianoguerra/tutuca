// What the todo components share: date and app types, priorities, colors, nav styles and list
// helpers.

import { canApply, checkCall, specOf, t } from "../../src/tutuca.js";
import { addDays, isIso, isoToday } from "./dates.js";

// Dates in a two year window, for generated states.
const isoArb = (fc) => fc.integer({ min: 0, max: 730 }).map((n) => addDays("2026-01-01", n));
// A component with these types has dateChecks in its checks.
export const dueType = () => t.string({ check: "isoOrEmpty" });
// The app's date, copied into every task so they can label their due dates: the day the
// component is defined, until the app's today ask says what it is.
export const todayType = () => t.string({ default: isoToday(), check: "iso" });
export const dateChecks = {
	isoOrEmpty: {
		test: (d) => d === "" || isIso(d),
		description: "an ISO date like 2026-01-31, or empty",
		arb: (fc) => fc.oneof(fc.constant(""), isoArb(fc)),
	},
	iso: { test: isIso, description: "an ISO date like 2026-01-31", arb: isoArb },
};

export const CHECKS = {
	1: "checkbox checkbox-sm checkbox-error rounded-full",
	2: "checkbox checkbox-sm checkbox-warning rounded-full",
	3: "checkbox checkbox-sm checkbox-info rounded-full",
	4: "checkbox checkbox-sm rounded-full",
};
export const DUES = {
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
export const NAV = "btn btn-sm btn-ghost w-full justify-start font-normal";
export const NAV_ACTIVE = `${NAV} btn-active`;
export const ICON_BTN =
	"btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-70 hover:opacity-100 focus:opacity-100";

export const labelsOf = (text) => [
	...new Set(
		text
			.split(/[\s,]+/)
			.map((w) => w.replace(/^@/, "").toLowerCase())
			.filter(Boolean),
	),
];
export const allTasks = (tasks) => tasks.flatMap((task) => [task, ...allTasks(task.subtasks)]);
// Whether task's subtasks hold the task id, at any depth.
export const hasTaskId = (task, id) => allTasks(task.subtasks).some((sub) => sub.id === id);
// Whether apply(task, name, ...args) would take the call: name is a pure message of task's,
// args fit it and its pre holds.
export const takesCall = (task, name, args) => {
	if (!canApply(task, name) || !Array.isArray(args)) return false;
	const spec = specOf(task);
	try {
		checkCall(spec, name, spec.on[name], task, args);
		return true;
	} catch {
		return false;
	}
};
// The index of the next task after i in direction delta that passes keep, or -1.
export const neighbor = (items, i, delta, keep) => {
	for (let j = i + delta; j >= 0 && j < items.length; j += delta) {
		if (keep(items[j])) return j;
	}
	return -1;
};
export const swap = (items, i, j) => {
	[items[i], items[j]] = [items[j], items[i]];
};

// Example: a field with a few values (a union of strings), a number, a computed property, and
// a component that opts in to layout editing. In a studio screen being edited, the Screen pushes
// the layoutEdit view, so stat shows inputs for its label and unit; while the screen is used it
// shows main.
import { button, div, field, input, send, span, targetValue } from "tutuca/view";

/** Which way the value went last. */
export type Trend = "flat" | "up" | "down";

/** The trend as an arrow. */
function arrowOf(trend: Trend): string {
	if (trend === "up") return "↑";
	if (trend === "down") return "↓";
	return "→";
}

/** A number with a label, as a dashboard shows it. */
export type Stat = {
	label: string;
	value: number;
	unit: string;
	trend: Trend;
	/** The trend as an arrow. */
	readonly arrow: string;
};

export const Stat = {
	defaults: { label: "Visitors", value: 0, unit: "", trend: "flat" },
	queries: {
		get arrow(): string {
			return arrowOf(this.trend);
		},
	},
	on: {
		setLabel: {
			pure: true,
			changes: ["label"],
			post(prev, next, [label]: [string]) {
				return next.label === label;
			},
			run(next, [label]: [string]) {
				next.label = label;
			},
		},
		setUnit: {
			pure: true,
			changes: ["unit"],
			post(prev, next, [unit]: [string]) {
				return next.unit === unit;
			},
			run(next, [unit]: [string]) {
				next.unit = unit;
			},
		},
		/** The trend follows the last change. */
		bump: {
			pure: true,
			changes: ["value", "trend"],
			post(prev, next, [by]: [number]) {
				return next.value === prev.value + by;
			},
			run(next, [by]: [number]) {
				next.value = this.value + by;
				next.trend = by > 0 ? "up" : by < 0 ? "down" : "flat";
			},
		},
	},
	view: div(
		{ class: "stat" },
		div({ class: "stat-title" }, field("label")),
		div({ class: "stat-value tabular-nums" }, field("value"), " ", field("unit")),
		div(
			{ class: "stat-actions flex gap-1" },
			button({ class: "btn btn-xs", "on:click": send("bump", -1) }, "-1"),
			button({ class: "btn btn-xs", "on:click": send("bump", 1) }, "+1"),
			span({ class: "stat-desc" }, field("arrow")),
		),
	),
	views: {
		layoutEdit: div(
			{ class: "stat rounded-box border border-dashed border-base-300 gap-1" },
			input({ class: "input input-xs", "aria-label": "Label", value: field("label"), "on:input": send("setLabel", targetValue()) }),
			input({
				class: "input input-xs",
				"aria-label": "Unit",
				placeholder: "unit",
				value: field("unit"),
				"on:input": send("setUnit", targetValue()),
			}),
		),
	},
	examples: {
		bumpUp: {
			start: {},
			steps: [{ send: "bump", args: [2] }, { expect: { value: 2 } }],
		},
	},
};

export const register = { Stat: "Stat" };

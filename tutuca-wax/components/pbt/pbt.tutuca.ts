// A component module for the test runner's tests (js/pbt.js): what it should find, on purpose.
// Not for the demos.
import { p, field } from "tutuca/view";

/** A tally, with a bug seeded in its implementation: add(4) once the count is past 8 adds 5, so
 * its post doesn't hold. */
export type Tally = { count: number; marks: number[] };
export const Tally = {
	defaults: { count: 0, marks: [] },
	constraints: { count: { int: true, min: 0, max: 20 }, marks: { maxLength: 6 } },
	on: {
		inc: {
			pure: true,
			changes: ["count"],
			pre(prev, []: []) {
				return prev.count < 20;
			},
			post(prev, next, []: []) {
				return next.count === prev.count + 1;
			},
			run(next, []: []) {
				next.count = this.count + 1;
			},
		},
		add: {
			pure: true,
			changes: ["count"],
			constraints: { n: { int: true, min: 1, max: 5 } },
			pre(prev, [n]: [number]) {
				return prev.count <= 15;
			},
			post(prev, next, [n]: [number]) {
				return next.count === prev.count + n;
			},
			run(next, [n]: [number]) {
				// The seeded bug: add(4) past 8 adds 5.
				next.count = n === 4 && this.count >= 8 ? this.count + 5 : this.count + n;
			},
		},
		mark: {
			pure: true,
			changes: ["marks"],
			pre(prev, []: []) {
				return prev.marks.length < 6;
			},
			post(prev, next, []: []) {
				return next.marks.length === prev.marks.length + 1;
			},
			run(next, []: []) {
				next.marks.push(this.count);
			},
		},
		unmark: {
			pure: true,
			changes: ["marks"],
			constraints: { at: { keyOf: "marks" } },
			post(prev, next, [at]: [number]) {
				return next.marks.length === prev.marks.length - 1;
			},
			run(next, [at]: [number]) {
				next.marks.splice(at, 1);
			},
		},
		reset: {
			pure: true,
			changes: ["count", "marks"],
			post(prev, next, []: []) {
				return next.count === 0 && next.marks.length === 0;
			},
			run(next, []: []) {
				next.count = 0;
				next.marks = [];
			},
		},
	},
	view: p({}, field("count")),
	examples: {
		adds: {
			start: { count: 1 },
			steps: [{ send: "add", args: [2] }, { expect: { count: 3 } }, { send: "inc" }, { expect: { count: 4, marks: [] } }],
		},
		wrongOnPurpose: {
			start: { count: 2 },
			steps: [{ send: "inc" }, { expect: { count: 4 } }],
		},
	},
};

/** A lamp that breaks and can't be repaired: repair needs parts no message adds, and once broken
 * nothing else is enabled. */
export type Lamp = { mode: "off" | "on" | "broken"; parts: number[] };
export const Lamp = {
	defaults: { mode: "off", parts: [] },
	on: {
		toggle: {
			pure: true,
			changes: ["mode"],
			pre(prev, []: []) {
				return prev.mode !== "broken";
			},
			run(next, []: []) {
				next.mode = this.mode === "on" ? "off" : "on";
			},
		},
		breakIt: {
			pure: true,
			changes: ["mode"],
			pre(prev, []: []) {
				return prev.mode === "on";
			},
			post(prev, next, []: []) {
				return next.mode === "broken";
			},
			run(next, []: []) {
				next.mode = "broken";
			},
		},
		repair: {
			pure: true,
			changes: ["mode"],
			pre(prev, []: []) {
				return prev.mode === "broken" && prev.parts.length > 3;
			},
			post(prev, next, []: []) {
				return next.mode === "off";
			},
			run(next, []: []) {
				next.mode = "off";
			},
		},
	},
	view: p({}, field("mode")),
};

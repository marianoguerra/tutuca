// Dev checks as entries: a pre, a post and an invariant, each of which some message breaks
// alone (tutuca and tutuca-wax report it, the transition still happens).
import { div, field, span } from "tutuca/view";

export type Gauge = { level: number; max: number };

export const Gauge = {
	defaults: { level: 0, max: 10 },
	invariants: {
		underMax(): boolean {
			return this.level <= this.max;
		},
	},
	on: {
		raise: {
			pure: true,
			run(next, [by]: [number]) {
				next.level += by;
			},
		},
		drop: {
			pure: true,
			post(prev, next, []: []) {
				return next.level >= 0;
			},
			run(next, []: []) {
				next.level -= 1;
			},
		},
		setMax: {
			pure: true,
			pre(prev, [max]: [number]) {
				return max >= prev.level;
			},
			run(next, [max]: [number]) {
				next.max = max;
			},
		},
	},
	view: div({}, span({}, field("level")), span({}, field("max"))),
};

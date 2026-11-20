// A counter: constraints, a pure message with a post condition, an invariant, a notify.
import { button, div, field, send, span } from "tutuca/view";

export type Counter = { count: number; step: number; readonly doubled: number };
export interface CounterNotifies {
	reachedLimit(count: number): void;
}

export const Counter = {
	defaults: { count: 0, step: 1 },
	constraints: { count: { int: true, min: 0, max: 100 }, step: { int: true, min: 1 } },
	queries: {
		get doubled(): number {
			return this.count * 2;
		},
	},
	invariants: {
		bounded(): boolean {
			return this.count >= 0 && this.count <= 100;
		},
	},
	on: {
		inc: {
			pure: true,
			changes: ["count"],
			post(prev, next, []: []) {
				return next.count >= prev.count;
			},
			run(next, []: []) {
				next.count = Math.min(100, this.count + this.step);
			},
		},
		bump: {
			run(next, [by]: [number], ctx) {
				next.count = Math.min(100, this.count + by);
				if (next.count === 100) ctx.notify("reachedLimit", [next.count]);
			},
		},
	},
	view: div({}, span({}, field("count")), button({ "on:click": send("inc") }, "+")),
};

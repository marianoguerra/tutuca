// ctx.componentNames and ctx.tryMake: what a handler's scope can make, and making one by a name
// given at run time, as a result instead of a failed task, and a swap to it.
import { div, field } from "tutuca/view";

export type Leaf = { n: number };
export const Leaf = {
	defaults: { n: 0 },
	view: div({}, field("n")),
};

export type Picker = { names: string[]; made: number; failed: number };
export const Picker = {
	defaults: { names: [], made: 0, failed: 0 },
	on: {
		// Lists the names, and makes the one picked: a name that isn't one fails as a result.
		pick: {
			changes: ["names", "made", "failed"],
			run(next, [name]: [string], ctx) {
				next.names = ctx.componentNames(true);
				const r = ctx.tryMake(name, { n: 2 });
				if (r.err !== undefined) next.failed += 1;
				else next.made += 1;
			},
		},
		// Becomes the component picked; one that can't be made keeps it, counted.
		become: {
			swap: true,
			changes: ["failed"],
			run(next, [name]: [string], ctx) {
				const r = ctx.tryMake(name, { n: 7 });
				if (r.err !== undefined) {
					next.failed += 1;
					return undefined;
				}
				return r.ok;
			},
		},
	},
	view: div({}, field("made")),
};

export const register = { Leaf: "Leaf", Picker: "Picker" };

// tutuca/data (range, without, kindOf) and the std members of Object, Number and Array, as
// tutuca and tutuca-wasm give them.
import { kindOf, range, without } from "tutuca/data";
import { div } from "tutuca/view";

export type Bag = {
	labels: string[];
	tags: { [key: string]: number };
	kinds: string[];
	readonly names: string;
	readonly total: number;
};

export const Bag = {
	defaults: { labels: [], tags: {}, kinds: [] },
	queries: {
		get names(): string {
			return Object.keys(this.tags).join(",");
		},
		get total(): number {
			return Object.entries(this.tags).reduce((sum, [, n]) => sum + n, 0);
		},
	},
	on: {
		label: {
			pure: true,
			run(next, [n]: [number]) {
				next.labels = range(0, n).map((i) => `tab ${i + 1}`);
			},
		},
		tag: {
			pure: true,
			run(next, [key]: [string]) {
				next.tags[key] = (this.tags[key] ?? 0) + 1;
			},
		},
		untag: {
			pure: true,
			run(next, [key]: [string]) {
				if (Object.hasOwn(this.tags, key)) next.tags = without(this.tags, key);
			},
		},
		double: {
			pure: true,
			run(next) {
				for (const [key, n] of Object.entries(this.tags)) next.tags[key] = n * 2;
			},
		},
		copyTags: {
			pure: true,
			run(next) {
				const keys = Object.keys(this.tags);
				const sorted = Object.entries(this.tags).filter(([key]) => key !== "");
				next.tags = Object.fromEntries(sorted);
				next.labels = keys;
			},
		},
		kind: {
			pure: true,
			run(next, [value]: [unknown]) {
				const whole = Number.isInteger(value) ? " whole" : "";
				const list = Array.isArray(value) ? " (a list)" : "";
				next.kinds.push(`${kindOf(value)}${whole}${list}`);
			},
		},
	},
	view: div({}),
};

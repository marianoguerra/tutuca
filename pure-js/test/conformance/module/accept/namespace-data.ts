// @entries {"Counter.on.*": {"this": "read State", "params": ["draft State", "[number]"], "result": "void"}}
// @run {"entry": "Counter.on.step.run", "this": {"count": 1}, "args": [{"count": 1}, [2]]}
export type State = { count: number };

const LIMITS = { low: 0, high: 10 };

function clamp(n: number): number {
	return Math.max(LIMITS.low, Math.min(LIMITS.high, n));
}

export const Counter = {
	name: "Counter",
	defaults: { count: 0 },
	limits: LIMITS,
	on: {
		step: {
			pure: true,
			changes: ["count"],
			run(next, [by]) {
				next.count = clamp(this.count + by * Counter.limits.high);
			},
		},
	},
};

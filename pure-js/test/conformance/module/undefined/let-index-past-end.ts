// @entries {"L.on.*": {"this": "read State", "params": ["draft State", "[]"], "result": "void"}}
// @run {"entry": "L.on.put.run", "this": {"xs": [1]}, "args": [{"xs": [1]}, []]}
export type State = { xs: number[] };
export const L = {
	on: {
		put: {
			run(next) {
				let i = 0;
				for (const x of this.xs) i += x + 1;
				next.xs[i] = 9;
			},
		},
	},
};

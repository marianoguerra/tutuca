// @entries {"Todos.on.*": {"this": "read State", "params": ["draft State", "[]"], "result": "void"}}
// @expect entry-access
export type State = { n: number };
export const Todos = {
	on: {
		a: {
			run(next) {
				next.n = 1;
			},
		},
		b: {
			run(next) {
				Todos.on.a.run(next);
			},
		},
	},
};

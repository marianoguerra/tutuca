// @entries {"List.on.*": {"this": "read State", "params": ["draft State", "[]"], "result": "void"}}
// @run {"entry": "List.on.double.run", "this": {"xs": [1, 2, 3]}, "args": [{"xs": [1, 2, 3]}, []]}
export type State = { xs: number[] };

export const List = {
	on: {
		double: {
			run(next) {
				for (const x of next.xs) {
					next.xs.push(x * 10);
					if (next.xs.length > 100) break;
				}
			},
		},
	},
};

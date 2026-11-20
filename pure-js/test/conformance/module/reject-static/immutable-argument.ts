// @entries {"Todos.on.*": {"this": "read State", "params": ["draft State", "[]"], "result": "void"}}
// @expect immutable-argument
export type Task = { done: boolean };
export type State = { items: Task[] };
function finish(xs: Task[]): void {
	for (const x of xs) x.done = true;
}
export const Todos = {
	on: {
		all: {
			run(next) {
				finish(this.items);
			},
		},
	},
};

// @entries {"Todos.on.*": {"this": "read State", "params": ["draft State", "[]"], "result": "void"}}
// @expect immutable-argument
// A record behind an alias of a union is still one: a helper that may change it doesn't get a
// read-only one.
export type Task = { done: boolean } | null;
export type State = { first: Task };
function finish(x: Task): void {
	if (x !== null) x.done = true;
}
export const Todos = {
	on: {
		all: {
			run(next) {
				finish(this.first);
			},
		},
	},
};

// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
toggleAll(next) {
	const all = this.items.every((it) => it.done);
	next.items = this.items.map((it) => ({ title: it.title, done: !all }));
}

// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.text = this.items.filter((it) => !it.done).map((it) => it.title).join(", ");
}

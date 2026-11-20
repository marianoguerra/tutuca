// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.count = this.items.reduce((sum, it) => sum + it.title.length, 0);
}

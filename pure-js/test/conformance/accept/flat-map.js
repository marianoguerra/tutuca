// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.text = this.items.flatMap((it) => [it.title, it.title]).join("+");
}

// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.text = this.items.map((a) => this.items.filter((b) => b.done === a.done).length).join(",");
}

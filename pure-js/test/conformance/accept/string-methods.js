// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.text = this.text.trim().toLowerCase().replaceAll(" ", "-");
}

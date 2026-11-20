// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.text = this.items.some((it) => it.done) ? "some done" : "none done";
}

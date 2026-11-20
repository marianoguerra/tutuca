// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.text = Object.entries(this.tags).map(([k, v]) => `${k}=${v}`).join("&");
}

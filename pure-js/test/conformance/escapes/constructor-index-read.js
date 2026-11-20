// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const c = this.tags["constructor"];
	next.count = c ?? -1;
}

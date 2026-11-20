// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	if (this.filter === "all") next.filter = "open";
	else if (this.filter === "open") next.filter = "done";
	else next.filter = "all";
}

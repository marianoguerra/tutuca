// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	next.count += 1;
	next.text += "!";
}

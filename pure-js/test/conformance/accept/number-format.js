// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [3.14159], "@ctx"]}
function (next, [x]) {
	next.text = Number.isFinite(x) ? x.toFixed(2) : "not a number";
}

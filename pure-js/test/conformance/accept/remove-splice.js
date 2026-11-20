// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [0], "@ctx"]}
function (next, [i]) {
	next.items.splice(i, 1);
}

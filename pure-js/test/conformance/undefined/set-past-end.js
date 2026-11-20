// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [5], "@ctx"]}
function (next, [i]) {
	next.items[i] = { title: "far", done: false };
}

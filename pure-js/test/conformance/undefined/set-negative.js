// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [-1], "@ctx"]}
function (next, [i]) {
	next.items[i] = { title: "minus one", done: false };
}

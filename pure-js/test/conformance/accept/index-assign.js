// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [0], "@ctx"]}
function (next, [i]) {
	next.items[i] = { title: "replaced", done: false };
}

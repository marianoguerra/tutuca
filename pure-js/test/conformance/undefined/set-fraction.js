// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [0.5], "@ctx"]}
function (next, [i]) {
	next.items[i] = { title: "half", done: false };
}

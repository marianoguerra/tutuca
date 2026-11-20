// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [1], "@ctx"]}
function (next, [i]) {
	next.items = this.items.map((it, j) => (j === i ? { ...it, done: true } : it));
}

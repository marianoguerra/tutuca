// @handler TodoList [number]
// @run {"this": "@todo", "args": ["@draft-todo", [1], "@ctx"]}
function (next, [i]) {
	const item = next.items[i];
	const was = this.items[i];
	if (item === undefined || was === undefined) return;
	item.done = !was.done;
}

// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["ship"], "@ctx"]}
function (next, [title]) {
	const item = next.items.find((it) => it.title === title);
	if (item === undefined) return;
	item.done = true;
}

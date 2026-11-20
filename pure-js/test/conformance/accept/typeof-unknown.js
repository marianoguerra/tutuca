// @handler TodoList [unknown]
// @run {"this": "@todo", "args": ["@draft-todo", [42], "@ctx"]}
function (next, [value]) {
	if (typeof value === "string") next.text = value;
	else if (typeof value === "number") next.text = String(value);
}

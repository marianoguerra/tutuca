// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["toString"], "@ctx"]}
function (next, [key]) {
	next.tags[key] = 1;
}

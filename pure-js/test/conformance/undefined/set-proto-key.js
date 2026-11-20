// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["__proto__"], "@ctx"]}
function (next, [tag]) {
	next.tags[tag] = 1;
}

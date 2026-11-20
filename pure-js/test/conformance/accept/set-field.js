// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["hello"], "@ctx"]}
function (next, [text]) {
	next.text = text;
}

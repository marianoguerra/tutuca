// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["urgent"], "@ctx"]}
function (next, [tag]) {
	const n = this.tags[tag] ?? 0;
	next.tags[tag] = n + 1;
}

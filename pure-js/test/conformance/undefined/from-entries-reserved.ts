// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["hasOwnProperty"], "@ctx"]}
function (next, [key]) {
	const entry: [string, number] = [key, 1];
	next.tags = Object.fromEntries([entry]);
}

// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["\"from json\""], "@ctx"]}
function (next, [text]) {
	const value = JSON.parse(text);
	if (typeof value === "string") next.text = value;
}

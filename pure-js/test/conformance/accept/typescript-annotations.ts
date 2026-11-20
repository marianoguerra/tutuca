// @handler TodoList [string]
// @run {"this": "@todo", "args": ["@draft-todo", ["  typed  "], "@ctx"]}
function (next: TodoList, [text]: [string]): void {
	const trimmed: string = text.trim();
	next.text = trimmed;
}

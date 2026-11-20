// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const v = JSON.parse('{"toString": 1, "constructor": 2, "items": [{"valueOf": 3}], "ok": 4}');
	next.text = JSON.stringify(v) ?? "";
}

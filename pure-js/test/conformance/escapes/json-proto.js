// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
function (next) {
	const v = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
	next.text = typeof v;
}

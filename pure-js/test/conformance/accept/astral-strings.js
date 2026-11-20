// @handler TodoList []
// @run {"this": "@todo", "args": ["@draft-todo", [], "@ctx"]}
// Characters past the BMP (an emoji is two UTF-16 code units) in a string and a template.
function (next) {
	next.text = `🗒️ ${this.items.length} · ${"★ done"}`;
}

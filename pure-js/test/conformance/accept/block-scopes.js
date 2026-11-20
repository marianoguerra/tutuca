// @handler TodoList [boolean]
// @run {"this": "@todo", "args": ["@draft-todo", [true], "@ctx"]}
function (next, [loud]) {
	if (loud) {
		const shout = this.text.toUpperCase();
		next.text = shout;
	} else {
		const shout = this.text.toLowerCase();
		next.text = shout;
	}
}

// @handler TodoList []
// @expect immutable-target
function (next) {
	const items = this.items;
	items.push({ title: "sneaky", done: false });
}

// @signature {"this": "read TodoList"}
// @run {"this": "@todo"}
get open() {
	return this.items.filter((it) => !it.done).length;
}

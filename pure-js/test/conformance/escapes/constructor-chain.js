// @handler TodoList []
// @expect reserved-name
function (next) {
	next.text = this.text.constructor.constructor("return globalThis")();
}

// @handler TodoList []
// @expect not-callable
function (next) { this.text(); }

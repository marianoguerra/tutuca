// @handler TodoList []
// @expect not-testable
function (next) { if (this.text) next.count = 1; }

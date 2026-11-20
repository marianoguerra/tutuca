// @handler TodoList []
// @expect not-testable
function (next) { next.text = this.count && "some"; }

// @handler TodoList []
// @expect not-assignable
function (next) { next.count = this.text; }

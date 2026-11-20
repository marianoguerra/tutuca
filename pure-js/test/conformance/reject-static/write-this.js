// @handler TodoList []
// @expect immutable-target
function (next) { this.text = "x"; }

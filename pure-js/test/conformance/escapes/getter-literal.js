// @handler TodoList []
// @expect object-method
function (next) { next.selected = { get title() { return "x"; }, done: false }; }

// @handler TodoList []
// @expect operand-type
function (next) { next.text = this.text + this.count; }

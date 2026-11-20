// @handler TodoList []
// @expect operand-type
function (next) { next.text = this.items.join(","); }

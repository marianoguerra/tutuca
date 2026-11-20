// @handler TodoList []
// @expect possibly-null
function (next) { next.text = this.selected.title; }

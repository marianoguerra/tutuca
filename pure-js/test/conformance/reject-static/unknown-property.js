// @handler TodoList []
// @expect unknown-property
function (next) { next.text = this.title; }

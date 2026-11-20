// @handler TodoList []
// @expect unknown-method
function (next) { next.text = this.text.padStart(10); }

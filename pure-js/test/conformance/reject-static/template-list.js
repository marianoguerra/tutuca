// @handler TodoList []
// @expect template-type
function (next) { next.text = `${this.items}`; }

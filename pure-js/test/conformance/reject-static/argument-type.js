// @handler TodoList []
// @expect argument-type
function (next) { next.count = Math.floor(this.text); }

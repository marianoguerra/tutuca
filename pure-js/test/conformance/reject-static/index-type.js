// @handler TodoList []
// @expect index-type
function (next) { next.selected = this.items["0"] ?? null; }

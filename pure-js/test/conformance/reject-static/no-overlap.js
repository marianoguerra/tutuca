// @handler TodoList []
// @expect comparison-type
function (next) { if (this.filter === "nope") next.count = 0; }

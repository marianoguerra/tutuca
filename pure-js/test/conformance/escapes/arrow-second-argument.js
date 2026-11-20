// @handler TodoList []
// @expect arrow-not-callback
function (next) { next.count = this.items.reduce((n, item) => n + 1, (x) => x); }

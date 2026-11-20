// @handler TodoList []
// @expect dict-dot-access
function (next) { next.count = this.tags.urgent ?? 0; }

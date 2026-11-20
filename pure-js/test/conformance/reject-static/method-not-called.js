// @handler TodoList []
// @expect method-not-called
function (next) { const trim = this.text.trim; }

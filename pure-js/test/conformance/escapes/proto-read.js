// @handler TodoList []
// @expect reserved-name
function (next) { next.text = this.__proto__; }

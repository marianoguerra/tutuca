// @signature {"this": "read TodoList", "result": "number"}
// @expect missing-return
get n() { if (this.count > 0) return this.count; }

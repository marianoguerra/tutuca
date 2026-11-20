// @signature {"params": ["read TodoList"], "result": "boolean"}
// @run {"args": ["@todo"]}
(self) => self.items.length > 0 && self.filter !== "done"

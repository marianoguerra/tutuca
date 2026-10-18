// Port of test/pbt/pbt.test.js's "message sequences keep the todo app valid": random apps, as
// components/todo/fixtures.js's todoAppArb makes them, and random sequences of the messages
// JS includes (TodoApp.openView, setSearch, clearCompleted; TodoTask.toggle, setTitle,
// remove), checked after every step for problems (invalid state, broken invariants).

///|
test "message sequences keep the todo app valid" {
  let failure = @testing.find_failure(
    todo_app,
    (rs, _) => {
      random_app(n => {
        rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
      })
    },
    [
      @testing.root_messages(keep=m => {
        m is (OpenView(_) | SetSearch(_) | ClearCompleted)
      }),
      @testing.item_messages(todo_task, tasks, keep=m => {
        m is (Toggle | SetTitle(_) | Remove)
      }),
    ],
    count=50,
  )
  assert_eq(failure.map(f => f.problem), None)
}

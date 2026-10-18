// Ports of the todo tests of test/demos/demos.test.js.

///|
test "todo demo: quick adds a task in plain words" {
  // The demo's state: examples/todo/web starts with a week of plans.
  let d = @testing.Driver::new(todo_app, week_of_plans(fixture_today))
  let field = d
    .find_all("input")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("Quick add"))
  d.dispatch(field.unwrap(), "input", value="Call mom tomorrow p1 #Errands")
  let form = d
    .find_all("form")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("Quick add task"))
  d.dispatch(form.unwrap(), "submit")
  let task = d.state().tasks.last().unwrap()
  assert_eq(task.title, "Call mom")
  assert_eq(task.due, add_days(fixture_today, 1))
  assert_eq(task.priority, 1)
  let project = d.state().projects
    .iter()
    .find_first(p => p.id == task.project_id)
  assert_eq(project.map(p => p.name), Some("Errands"))
  assert_eq(d.problems().map(@testing.describe), [])
  assert_true(d.root_node.children().length() > 0)
  assert_eq(todo_app.check().map(i => i.to_string()), [])
}

///|
test "TodoApp has the generic properties on generated apps" {
  // As JS's todoAppArb: apps the fixtures make, with random tasks.
  @testing.check_component(todo_app, count=25, state=(rs, _) => {
    let pick = (n : Int32) => {
      rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
    }
    let titles = ["Buy milk", "Call mom", "Write docs", "Fix bug"]
    let projects : Array[String?] = [None, Some("Work"), Some("Home")]
    let tasks = Array::makei(pick(6), _ => {
      spec(
        titles[pick(4)],
        due=pick(20) - 5,
        priority=pick(4) + 1,
        project?=projects[pick(3)],
        done=pick(3) == 0,
        labels=if pick(2) == 0 { ["home"] } else { [] },
      )
    })
    make_app(
      fixture_today,
      projects=[("Work", Blue), ("Home", Green)],
      tasks~,
      page=[Inbox, Today, Upcoming][pick(3)],
    )
  })
}

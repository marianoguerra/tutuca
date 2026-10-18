// The cases of test/components/todo.test.js, and the app driven end to end.

///|
test "due labels are relative to today" {
  let at = (n : Int32) => due_label(add_days(fixture_today, n), fixture_today)
  assert_eq([at(-1), at(0), at(1), at(3), at(7), at(80)], [
    "Yesterday", "Today", "Tomorrow", "Monday", "Oct 23", "Jan 4 2027",
  ])
  assert_eq(day_header(fixture_today, fixture_today), "Fri 16 Oct · Today")
  assert_eq(
    day_header(add_days(fixture_today, 10), fixture_today),
    "Mon 26 Oct",
  )
  let tones = [-1, 0, 1, 3, 9].map(n => {
    match due_tone(add_days(fixture_today, n), fixture_today) {
      Overdue => "overdue"
      DueToday => "today"
      Tomorrow => "tomorrow"
      Week => "week"
      Later => "later"
      NoTone => ""
    }
  })
  assert_eq(tones, ["overdue", "today", "tomorrow", "week", "later"])
}

///|
test "is_iso only accepts real dates" {
  assert_true(is_iso("2026-02-28"))
  assert_false(is_iso("2026-02-30"))
  assert_false(is_iso("2026-2-3"))
}

///|
test "quick add parses dates, priority, project and labels" {
  let parse = (text : String) => {
    parse_quick_add(text, today=fixture_today, projects=["Work", "Home"])
  }
  assert_eq(parse("Buy milk tomorrow p1 #home @Shop @shop"), {
    title: "Buy milk",
    due: "2026-10-17",
    due_text: "tomorrow",
    priority: 1,
    project: Some("Home"),
    labels: ["shop"],
  })
  assert_eq(parse("Call mom next week").due, "2026-10-19")
  assert_eq(parse("Gym in 3 days").due, "2026-10-19")
  assert_eq(parse("Report fri").due, fixture_today)
  assert_eq(parse("Report mon").due, "2026-10-19")
  assert_eq(parse("Taxes 2027-04-15").due, "2027-04-15")
  // Only the first date counts; an unknown #project stays in the title.
  assert_eq(parse("Read #Books today tomorrow"), {
    title: "Read #Books tomorrow",
    due: fixture_today,
    due_text: "today",
    priority: 4,
    project: None,
    labels: [],
  })
  // Without today, as QuickAdd previews it: words kept, dates unresolved.
  assert_eq(parse_quick_add("x tom #Anything"), {
    title: "x",
    due: "",
    due_text: "tom",
    priority: 4,
    project: Some("Anything"),
    labels: [],
  })
}

///|
test "quick add never loses words" {
  let vocabulary = ["a", "b", "tod", "p2", "#Work", "@x", "next", "week"]
  @testing.check_property("quick add keeps words", (rs, _) => {
    let n = rs.next_uint(limit=8).reinterpret_as_int()
    let words = Array::makei(n, _ => {
      vocabulary[rs.next_uint(limit=8).reinterpret_as_int()]
    })
    let r = parse_quick_add(words.join(" "), today=fixture_today, projects=[
      "Work",
    ])
    let kept = words_of("\{r.title} \{r.due_text}").length()
    let tags = words.iter().count_if(w => w is ("p2" | "#Work" | "@x"))
    if kept + tags != words.length() {
      raise @testing.Broke("\{words.join(" ")} kept \{kept} + \{tags}")
    }
  })
}

///|
test "the todo components check clean" {
  for
    issues in [
      todo_app.check(),
      todo_task.check(),
      todo_project.check(),
      quick_add.check(),
    ] {
    assert_eq(issues.map(i => i.to_string()), [])
  }
}

///|
test "the app renders its today page" {
  let d = @testing.Driver::new(todo_app, week_of_plans(fixture_today))
  assert_eq(d.problems().map(@testing.describe), [])
  let text = d.text()
  assert_true(text.contains("Replytothedesignreview📅Yesterday"))
  assert_true(text.contains("Preparethequarterlyreport"))
  // Not due by today: not on the today page.
  assert_false(text.contains("Buycarrots"))
}

///|
test "quick add adds a parsed task to the app" {
  let d = @testing.Driver::new(todo_app, sample_app())
  let field = d
    .find_all("input")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("Quick add"))
  d.dispatch(field.unwrap(), "input", value="Call Ada tomorrow p2 #Work @phone")
  let form = d
    .find_all("form")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("Quick add task"))
  d.dispatch(form.unwrap(), "submit")
  assert_eq(d.problems().map(@testing.describe), [])
  let added = d.state().tasks.last().unwrap()
  assert_eq(added.title, "Call Ada")
  assert_eq(added.due, "2026-10-17")
  assert_eq(added.priority, 2)
  assert_eq(added.project_id, "p1")
  assert_true(d.state().labels.contains("phone"))
  assert_eq(d.state().quick_add.text, "")
}

///|
test "a subtask's delete removes it from its parent, not the app" {
  let d = @testing.Driver::new(todo_app, sample_app(), view?=None)
  d.send(OpenView(Today))
  let before = d.state().tasks.length()
  // Ship the storybook's subtasks render under it; the second Delete is the first subtask's.
  let deletes = d.root_node
    .descendants()
    .filter(n => n.get_attribute("title") == Some("Delete"))
  let ship = d.state().tasks
    .find_index(t => t.title == "Ship the storybook")
    .unwrap()
  assert_eq(d.state().tasks[ship].subtasks.length(), 2)
  let first_sub = deletes
    .iter()
    .find_first(n => {
      n.get_attribute(@tutuca.handler_attr).unwrap().contains(".subtasks[0]")
    })
  d.dispatch(first_sub.unwrap(), "click")
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(d.state().tasks.length(), before)
  assert_eq(d.state().tasks[ship].subtasks.map(s => s.title).to_array(), [
    "Stress test them",
  ])
}

///|
test "labels changed in a subtask bubble through its parent to the app" {
  let d = @testing.Driver::new(todo_app, sample_app())
  let ship = d.state().tasks
    .find_index(t => t.title == "Ship the storybook")
    .unwrap()
  d.send_to(
    todo_task,
    tasks.at(ship).then(subtasks.at(1)),
    SetLabelsText("@deep, @Work"),
  )
  assert_eq(d.problems().map(@testing.describe), [])
  assert_true(d.state().labels.contains("deep"))
  assert_true(d.state().labels.contains("work"))
}

///|
test "the editor's project select lists the provided projects" {
  let d = @testing.Driver::new(todo_app, sample_app())
  d.send_to(todo_task, tasks.at(0), BeginEdit)
  let select = d
    .find_all("select")
    .iter()
    .find_first(n => n.get_attribute("aria-label") == Some("Project"))
  let options = select
    .unwrap()
    .descendants()
    .filter(n => n.tag_name() == "OPTION")
  assert_eq(options.map(o => o.text_content()), ["Inbox", "Work", "Home"])
  d.dispatch(select.unwrap(), "change", value="p2")
  assert_eq(d.state().tasks[0].project_id, "p2")
}

///|
test "sync today asks the host" {
  let scope = @tutuca.Scope::new()
  scope.answer(today_ask, _ => "2026-12-24")
  let d = @testing.Driver::new(todo_app, sample_app(), scope~)
  d.send(SyncToday)
  assert_eq(d.state().today, "2026-12-24")
  assert_true(
    all_tasks(d.state().tasks).iter().all(t => t.today == "2026-12-24"),
  )
}

///|
test "removing a project moves its tasks to the inbox" {
  let d = @testing.Driver::new(todo_app, sample_app())
  d.send(OpenProject(1))
  d.click("button", text="Delete")
  assert_eq(d.problems().map(@testing.describe), [])
  assert_eq(d.state().projects.map(p => p.name).to_array(), ["Inbox", "Home"])
  assert_true(d.state().view is Inbox)
  assert_eq(d.state().tasks.count(t => t.project_id == "p1"), 0)
}

///|
test "random messages keep the app's contract" {
  @testing.run_messages(
    todo_app,
    () => week_of_plans(fixture_today),
    [
      @testing.root_messages(),
      // The project select only offers the app's projects.
      @testing.item_messages(todo_task, tasks, keep=m => !(m is SetProject(_))),
      @testing.item_messages(todo_project, projects),
      @testing.child_messages(quick_add, quick_add_lens),
    ],
    count=30,
  )
}

///|
/// Every task's subtasks are in its project, as SetProject moves them: a property of the app's
/// messages (JS's TodoTask doesn't check it, so it is no invariant of the component).
test "random messages keep every task's subtasks in its project" {
  let in_project = (t : TodoTask) => {
    t.all().iter().all(x => x.subtasks.all(s => s.project_id == x.project_id))
  }
  @testing.run_messages(
    todo_app,
    () => week_of_plans(fixture_today),
    [
      @testing.root_messages(),
      // To one of the app's projects, as the project select offers.
      @testing.item_messages(todo_task, tasks, keep=m => {
        match m {
          SetProject(id) => ["inbox", "p1", "p2"].contains(id)
          _ => true
        }
      }),
      @testing.item_messages(todo_project, projects),
    ],
    count=30,
    after_each=(_, next, label) => {
      guard next.tasks.all(in_project) else {
        fail("after \{label}: a subtask is outside its task's project")
      }
    },
  )
}

///|
test "random events patch the DOM as a fresh render would" {
  @testing.run_events(todo_app, () => sample_app(), count=20)
}

///|
test "the small components have the generic properties" {
  @testing.check_component(quick_add)
  @testing.check_component(todo_project)
}

///|
test "tasks have the generic properties on states that keep their invariants" {
  @testing.check_component(todo_task, state=(rs, _) => {
    let titles = ["Buy milk", "Call mom", "Write docs", "Fix bug"]
    let pick = (n : Int32) => {
      rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
    }
    let subs = Array::makei(pick(3), i => {
      spec(titles[pick(4)], done=pick(2) == 0, priority=i + 1)
    })
    task_of(
      spec(
        titles[pick(4)],
        due=pick(20) - 5,
        priority=pick(4) + 1,
        labels=["home"],
        subtasks=subs,
      ),
    )
  })
}

///|
fn task_of(s : Spec) -> TodoTask {
  make_app(fixture_today, tasks=[s]).tasks[0]
}

///|
using @storybook {
  story,
  send,
  send_to,
  hear,
  event,
  check,
  css,
  book,
  type Book,
}

///|
using @todo {
  fixture_today,
  spec,
  make_app,
  sample_app,
  todo_task,
  todo_app,
  quick_add,
  todo_project,
  type TodoTask,
  type TodoApp,
}

///|
fn task_of(s : @todo.Spec) -> TodoTask {
  make_app(fixture_today, tasks=[s]).tasks[0]
}

///|
let subtasks : @tutuca.Items[TodoTask, Int32, TodoTask] = @tutuca.items(
  "subtasks",
  t => t.subtasks,
  (t, v) => { ..t, subtasks: v, },
)

///|
let tasks : @tutuca.Items[TodoApp, Int32, TodoTask] = @tutuca.items(
  "tasks",
  a => a.tasks,
  (a, v) => { ..a, tasks: v, },
)

///|
let projects : @tutuca.Items[TodoApp, Int32, @todo.TodoProject] = @tutuca.items(
  "projects",
  a => a.projects,
  (a, v) => { ..a, projects: v, },
)

///|
let quick_add_at : @tutuca.Lens[TodoApp, @todo.QuickAdd] = @tutuca.field(
  "quick_add",
  a => a.quick_add,
  (a, q) => { ..a, quick_add: q, },
)

///|
/// The open tasks due today or before: the Today count in the sidebar.
fn today_count(a : TodoApp) -> Int32 {
  a.tasks.count(t => !t.is_completed && t.due != "" && t.due <= a.today)
}

///|
/// Random messages to the app, its tasks, projects and quick add, as JS's appMessages.
fn app_targets() -> Array[@testing.Target[TodoApp, @todo.TodoAppMsg]] {
  [
    @testing.root_messages(keep=m => {
      m
      is (OpenView(_)
      | OpenProject(_)
      | OpenLabel(_)
      | SetSearch(_)
      | SetShowCompleted(_)
      | ClearCompleted
      | SetToday(_))
    }),
    @testing.item_messages(todo_task, tasks, keep=m => {
      m
      is (Toggle
      | SetTitle(_)
      | SetDue(_)
      | SetPriority(_)
      | SetLabelsText(_)
      | ToggleExpand
      | Remove
      | MoveUp
      | MoveDown)
    }),
    @testing.item_messages(todo_project, projects, keep=m => {
      m is (SetName(_) | SetColor(_))
    }),
    @testing.child_messages(quick_add, quick_add_at),
  ]
}

///|
/// The todo book, for any DOM: memdom in tests, the browser's in the storybook page.
pub fn[N : @vdom.DomNode] todo_book() -> Book[N] {
  let today = (s : @tutuca.Scope) => {
    s.answer(@todo.today_ask, _ => "2026-12-24")
  }
  book(
    "Todo",
    [
      // Tasks alone, in each state.
      story("Task/Plain", todo_task, () => task_of(spec("Read a paper"))),
      story("Task/Due today, priority 1", todo_task, () => {
        task_of(spec("Reply to Ada", due=0, priority=1))
      }),
      story("Task/Overdue with labels", todo_task, () => {
        task_of(spec("Pay rent", due=-2, priority=2, labels=["home", "money"]))
      }),
      story("Task/Upcoming with description", todo_task, () => {
        task_of(
          spec(
            "Dentist",
            due=9,
            priority=3,
            description="Bring the insurance card",
          ),
        )
      }),
      story("Task/Completed", todo_task, () => {
        task_of(spec("Done thing", done=true))
      }),
      story(
        "Task/Editing",
        todo_task,
        () => {
          ..task_of(spec("Edit me", due=1, labels=["x"])),
          is_editing: true,
        },
        sequences=[
          (
            "edit every field",
            [
              event("input", css("[aria-label=\"Task name\"]"), value="Edited"),
              event(
                "input",
                css("[aria-label=\"Description\"]"),
                value="More details",
              ),
              event(
                "change",
                css("[aria-label=\"Due date\"]"),
                value="2026-10-20",
              ),
              event("change", css("[aria-label=\"Priority\"]"), value="1"),
              event("change", css("[aria-label=\"Labels\"]"), value="@a @b"),
              event("click", css("button.btn-primary")),
              check("edited", s => {
                s.title == "Edited" && s.description == "More details"
              }),
              check("due Tuesday", s => {
                s.due == "2026-10-20" &&
                @todo.due_label(s.due, s.today) == "Tuesday"
              }),
              check("priority 1, labels a b", s => {
                s.priority == 1 && s.labels.to_array() == ["a", "b"]
              }),
            ],
          ),
        ],
        events=true,
        max_steps=10,
      ),
      // A task with subtasks: messages from subtasks reach their parent.
      story(
        "Task/With subtasks",
        todo_task,
        () => {
          task_of(
            spec("Move house", due=4, subtasks=[
              spec("Pack books"),
              spec("Rent a van", done=true),
              spec("Clean"),
            ]),
          )
        },
        sequences=[
          (
            "complete, reorder and remove subtasks",
            [
              send_to(todo_task, subtasks.at(0), Toggle),
              check("2/3 done", s => s.subtasks.count(x => x.is_completed) == 2),
              hear(@todo.move_task, 1, from=subtasks.at(0)),
              check("Pack books second", s => {
                s.subtasks[1].title == "Pack books"
              }),
              send_to(todo_task, subtasks.at(2), Remove),
              check("two left", s => s.subtasks.length() == 2),
              send(Toggle),
              check("completing completes all", s => {
                s.subtasks.all(x => x.is_completed)
              }),
              send(ToggleExpand),
              check("collapsed", s => !s.is_expanded),
            ],
          ),
          (
            "add a subtask",
            [
              send(BeginEdit),
              event(
                "input",
                css("[aria-label=\"New subtask\"]"),
                value="Label boxes",
              ),
              event("submit", css("form")),
              check("added", s => {
                s.subtasks.last().map(x => x.title) == Some("Label boxes")
              }),
              check("with a nested id", s => {
                s.subtasks.last().map(x => x.id) == Some("t1.4")
              }),
            ],
          ),
        ],
        targets=[
          @testing.root_messages(keep=m => !(m is SetProject(_))),
          @testing.item_messages(todo_task, subtasks, keep=m => {
            !(m is SetProject(_))
          }),
        ],
      ),
      @storybook.generated_story("Task/Generated", todo_task, (rs, _) => {
        @todo.random_task(n => {
          rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
        })
      }),
      // Projects and quick add alone.
      story("Project/Inbox", todo_project, () => @todo.TodoProject::inbox()),
      story(
        "Project/Work",
        todo_project,
        () => { id: "p1", name: "Work", color: Blue, is_editing: false, },
        sequences=[
          (
            "rename",
            [
              event("click", css("button")),
              event(
                "input",
                css("[aria-label=\"Project name\"]"),
                value="Office",
              ),
              event("change", css("[aria-label=\"Color\"]"), value="red"),
              send(EndRename),
              check("renamed and red", s => s.name == "Office" && s.color is Red),
            ],
          ),
        ],
        events=true,
      ),
      story("Quick add/Empty", quick_add, () => Default::default()),
      story(
        "Quick add/Preview",
        quick_add,
        () => { text: "Buy milk tomorrow p1 #Errands @shop @home", },
        sequences=[
          (
            "type and submit",
            [
              event(
                "input",
                css("[aria-label=\"Quick add\"]"),
                value="Call mom next week p2",
              ),
              check("previews the date", s => {
                @todo.parse_quick_add(s.text).due_text == "next week"
              }),
              check("and the priority", s => {
                @todo.parse_quick_add(s.text).priority == 2
              }),
              event("submit", css("form")),
              check("cleared", s => s.text == ""),
            ],
          ),
        ],
      ),
      // The app, in each view.
      story("App/Inbox", todo_app, sample_app, asks=today),
      story(
        "App/Today",
        todo_app,
        () => { ..sample_app(), view: Today, },
        asks=today,
        sequences=[
          (
            "complete and add for today",
            [
              check("overdue and today", s => today_count(s) == 3),
              send_to(todo_task, tasks.at(0), Toggle),
              check("one less", s => today_count(s) == 2),
              send_to(quick_add, quick_add_at, SetText("Stretch")),
              send_to(quick_add, quick_add_at, Submit),
              check("due today", s => {
                s.tasks.last().map(t => t.due) == Some(fixture_today)
              }),
            ],
          ),
        ],
        targets=app_targets(),
        max_steps=15,
      ),
      story(
        "App/Upcoming",
        todo_app,
        () => { ..sample_app(), view: Upcoming, },
        asks=today,
      ),
      story(
        "App/Project",
        todo_app,
        () => { ..sample_app(), view: Project, project_index: 1, },
        asks=today,
        sequences=[
          (
            "rename, then delete the project",
            [
              event("dblclick", css("h2[title=\"Double-click to rename\"]")),
              event("input", css("[aria-label=\"Project name\"]"), value="Job"),
              send_to(todo_project, projects.at(1), EndRename),
              check("renamed", s => s.projects[1].name == "Job"),
              send_to(todo_project, projects.at(1), Remove),
              check("gone", s => s.projects.length() == 2 && s.view is Inbox),
              check("its tasks in the inbox", s => {
                s.tasks[2].project_id == "inbox"
              }),
            ],
          ),
        ],
      ),
      story(
        "App/Label",
        todo_app,
        () => { ..sample_app(), view: Label, label_index: Some(0), },
        asks=today,
      ),
      story(
        "App/Search",
        todo_app,
        () => { ..sample_app(), search: "the", view: Search, },
        asks=today,
      ),
      story("App/Empty", todo_app, () => make_app(fixture_today), asks=today),
      story(
        "App/Quick add",
        todo_app,
        sample_app,
        asks=today,
        sequences=[
          (
            "parse a task into its project",
            [
              event(
                "input",
                css("[aria-label=\"Quick add\"]"),
                value="Prepare slides fri p1 #Work @talk",
              ),
              event("submit", css("[aria-label=\"Quick add task\"]")),
              check("parsed", s => {
                match s.tasks.last() {
                  Some(t) =>
                    t.title == "Prepare slides" &&
                    t.due == "2026-10-16" &&
                    t.priority == 1 &&
                    t.project_id == "p1" &&
                    t.labels.to_array() == ["talk"]
                  None => false
                }
              }),
              check("new label listed", s => s.labels.contains("talk")),
              event("click", css("aside button:nth-of-type(2)")),
              check("today view", s => s.view is Today),
            ],
          ),
          (
            "add a project",
            [
              event(
                "input",
                css("[aria-label=\"New project\"]"),
                value="Garden",
              ),
              event("submit", css("[aria-label=\"Add project\"]")),
              check("opened", s => {
                s.view is Project &&
                s.projects.get(s.project_index).map(p => p.name) ==
                Some("Garden")
              }),
            ],
          ),
          (
            "edit a task's labels",
            [
              send_to(todo_task, tasks.at(5), BeginEdit),
              send_to(todo_task, tasks.at(5), SetLabelsText("@deep @work")),
              check("labels listed", s => {
                s.labels.contains("deep") && s.labels.contains("work")
              }),
              send_to(todo_task, tasks.at(5), SetProject("p2")),
              check("moved to Home", s => s.tasks[5].project_id == "p2"),
            ],
          ),
        ],
        targets=app_targets(),
        max_steps=15,
      ),
      story("App/Sync date", todo_app, sample_app, asks=today, sequences=[
        (
          "ask the host for today",
          [
            send(SyncToday),
            check("Christmas eve", s => s.today == "2026-12-24"),
            check("tasks know", s => {
              s.tasks.all(t => t.all().iter().all(x => x.today == "2026-12-24"))
            }),
          ],
        ),
      ]),
      @storybook.generated_story(
        "App/Generated",
        todo_app,
        (rs, _) => {
          @todo.random_app(n => {
            rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
          })
        },
        asks=today,
        targets=app_targets(),
        max_steps=15,
      ),
      story(
        "App/DOM events",
        todo_app,
        sample_app,
        asks=today,
        events=true,
        max_steps=15,
      ),
    ],
    specs=[
      @storybook.spec(@todo.todo_app),
      @storybook.spec(@todo.todo_project),
      @storybook.spec(@todo.todo_task),
      @storybook.spec(@todo.quick_add),
    ],
  )
}

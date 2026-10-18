// The core of todoist.com: projects with tasks that have due dates, priorities, labels and
// subtasks; inbox, today, upcoming, project, label and search views; quick add that parses
// "Buy milk tomorrow p1 #Errands @shop".

///|
pub(all) enum Page {
  Inbox
  Today
  Upcoming
  Project
  Label
  Search
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
let pages : Array[(Page, String)] = [
  (Inbox, "inbox"),
  (Today, "today"),
  (Upcoming, "upcoming"),
  (Project, "project"),
  (Label, "label"),
  (Search, "search"),
]

///|
/// As JS names the views: "inbox", "today", ….
pub impl ToJson for Page with fn to_json(self) {
  for p in pages {
    if p.0 == self {
      return Json::string(p.1)
    }
  }
  Json::null()
}

///|
pub impl FromJson for Page with fn from_json(json, path) {
  for p in pages {
    if json == Json::string(p.1) {
      return p.0
    }
  }
  raise @json.JsonDecodeError((path, "a view"))
}

///|
pub(all) struct TodoApp {
  today : String
  projects : Vec[TodoProject] // The inbox first.
  labels : Vec[String]
  tasks : Vec[TodoTask]
  view : Page
  project_index : Int32
  label_index : Int32?
  search : String
  show_completed : Bool
  quick_add : QuickAdd
  new_project : String
  next_task_id : Int32
  next_project_id : Int32
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum TodoAppMsg {
  OpenView(Page)
  OpenProject(Int32)
  OpenLabel(Int32)
  SetSearch(String)
  SetShowCompleted(Bool)
  ClearCompleted
  SetNewProject(String)
  AddProject
  SetToday(String)
  SyncToday // Asks the host for the real date.
  TodayIs(AskResult[String])
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// The real date, asked of the host.
pub let today_ask : Ask[Unit, String] = Ask::new("today")

///|
let projects : Items[TodoApp, Int32, TodoProject] = items(
  "projects",
  a => a.projects,
  (a, v) => { ..a, projects: v, },
)

///|
let tasks : Items[TodoApp, Int32, TodoTask] = items("tasks", a => a.tasks, (
  a,
  v,
) => { ..a, tasks: v, })

///|
let quick_add_lens : Lens[TodoApp, QuickAdd] = field(
  "quick_add",
  a => a.quick_add,
  (a, q) => { ..a, quick_add: q, },
)

///|
let projects_lens : Lens[TodoApp, Vec[TodoProject]] = field(
  "projects",
  a => a.projects,
  (a, v) => { ..a, projects: v, },
)

///|
fn TodoApp::current_project(self : TodoApp) -> TodoProject {
  self.projects.get(self.project_index).unwrap_or(TodoProject::inbox())
}

///|
fn TodoApp::current_label(self : TodoApp) -> String? {
  self.label_index.bind(i => self.labels.get(i))
}

///|
fn TodoApp::is_dated(self : TodoApp) -> Bool {
  self.view is (Today | Upcoming)
}

///|
fn TodoApp::in_view(self : TodoApp, task : TodoTask) -> Bool {
  if !self.show_completed && task.is_completed {
    return false
  }
  match self.view {
    Inbox => task.project_id == "inbox"
    Project => task.project_id == self.current_project().id
    Today => task.has_due() && task.due <= self.today
    Upcoming => task.has_due() && task.due >= self.today
    Label => self.current_label() is Some(l) && task.labels.contains(l)
    Search => trim(self.search) != "" && task.matches(trim(self.search))
  }
}

///|
fn TodoApp::open_count(self : TodoApp, keep : (TodoTask) -> Bool) -> Int32 {
  self.tasks.count(t => !t.is_completed && keep(t))
}

///|
fn TodoApp::group_of(self : TodoApp, task : TodoTask) -> String {
  if self.view is Upcoming {
    day_header(task.due, self.today)
  } else if task.due < self.today {
    "Overdue"
  } else {
    "Today"
  }
}

///|
/// A visible task row: where it is in `tasks`, and the day header before it, if any.
priv struct Row {
  index : Int32
  id : String
  header : String?
}

///|
/// The tasks of the page; dated pages sort by due date and head each group.
fn TodoApp::rows(self : TodoApp) -> Array[Row] {
  let entries = self.tasks.iter2().to_array().filter(e => self.in_view(e.1))
  if self.is_dated() {
    entries.sort_by((a, b) => {
      let by_due = a.1.due.compare(b.1.due)
      if by_due != 0 {
        by_due
      } else {
        a.1.priority.compare(b.1.priority)
      }
    })
  }
  let mut last = None
  entries.map(e => {
    let (index, task) = e
    let header = if self.is_dated() {
      let h = self.group_of(task)
      if last == Some(h) {
        None
      } else {
        last = Some(h)
        Some(h)
      }
    } else {
      None
    }
    { index, id: task.id, header, }
  })
}

///|
/// What the page shows around the task list.
priv struct PageBinds {
  title : String
  is_project : Bool
  is_empty : Bool
  empty_text : String
  inbox_count : String
  today_count : String
  inbox_class : String
  today_class : String
  upcoming_class : String
  has_completed : Bool
}

///|
fn nav_class(active : Bool) -> String {
  if active {
    nav_active
  } else {
    nav
  }
}

///|
fn count_text(n : Int32) -> String {
  if n == 0 {
    ""
  } else {
    n.to_string()
  }
}

///|
fn TodoApp::page_binds(self : TodoApp) -> PageBinds {
  let title = match self.view {
    Inbox => "Inbox"
    Today => "Today"
    Upcoming => "Upcoming"
    Project => self.current_project().name
    Label => "@\{self.current_label().unwrap_or("")}"
    Search => "Search: \{trim(self.search)}"
  }
  let empty_text = match self.view {
    Inbox => "Your inbox is clear. Add a task above."
    Today => "Nothing due today. Enjoy!"
    Upcoming => "Nothing scheduled."
    Project => "No tasks in this project yet."
    Label => "No tasks with this label."
    Search => "No tasks match your search."
  }
  {
    title,
    is_project: self.view is Project,
    is_empty: self.tasks.count(t => self.in_view(t)) == 0,
    empty_text,
    inbox_count: count_text(self.open_count(t => t.project_id == "inbox")),
    today_count: count_text(
      self.open_count(t => t.has_due() && t.due <= self.today),
    ),
    inbox_class: nav_class(self.view is Inbox),
    today_class: nav_class(self.view is Today),
    upcoming_class: nav_class(self.view is Upcoming),
    has_completed: self.tasks.any(t => t.is_completed),
  }
}

///|
priv struct NavItem {
  index : Int32
  name : String
  count : String
  nav_class : String
  dot : String
}

///|
/// The projects in the sidebar; the inbox has its own entry.
fn TodoApp::nav_projects(self : TodoApp) -> Array[NavItem] {
  self.projects
  .iter2()
  .to_array()
  .filter(e => e.0 != 0)
  .map(e => {
    let (index, p) = e
    {
      index,
      name: p.name,
      count: count_text(self.open_count(t => t.project_id == p.id)),
      nav_class: nav_class(self.view is Project && self.project_index == index),
      dot: p.dot_class(),
    }
  })
}

///|
fn TodoApp::nav_labels(self : TodoApp) -> Array[NavItem] {
  self.labels
  .iter2()
  .to_array()
  .map(e => {
    let (index, l) = e
    {
      index,
      name: l,
      count: count_text(self.open_count(t => t.labels.contains(l))),
      nav_class: nav_class(
        self.view is Label && self.label_index == Some(index),
      ),
      dot: "",
    }
  })
}

///|
fn sidebar() -> ViewAt[@tutuca.With[TodoApp, PageBinds], TodoApp, TodoAppMsg] {
  @tutuca.h(
    "aside",
    [cls("flex w-full shrink-0 flex-col gap-1 bg-base-200 p-3 md:w-64")],
    [
      input([
        cls("input input-sm mb-2 w-full"),
        attr("type", "search"),
        aria("label", "Search"),
        attr("placeholder", "Search"),
        value(w => w.up.search),
        on_input(v => SetSearch(v)),
      ]),
      button([class_(w => w.value.inbox_class), on_click(OpenView(Inbox))], [
        txt("📥 Inbox"),
        span([cls("ml-auto text-xs opacity-60")], [
          show(w => w.value.inbox_count),
        ]),
      ]),
      button([class_(w => w.value.today_class), on_click(OpenView(Today))], [
        txt("📅 Today"),
        span([cls("ml-auto text-xs opacity-60")], [
          show(w => w.value.today_count),
        ]),
      ]),
      button(
        [class_(w => w.value.upcoming_class), on_click(OpenView(Upcoming))],
        [txt("🗓 Upcoming")],
      ),
      h3([cls("mt-3 px-3 text-xs font-semibold uppercase opacity-60")], [
        txt("Projects"),
      ]),
      each(
        w => w.up.nav_projects().iter(),
        button(
          [
            class_(it => it.value.nav_class),
            on_event(Click, (it, _) => Some(OpenProject(it.value.index))),
          ],
          [
            span([class_(it => it.value.dot)], []),
            show(it => it.value.name),
            span([cls("ml-auto text-xs opacity-60")], [
              show(it => it.value.count),
            ]),
          ],
        ),
      ),
      form(
        [
          cls("flex gap-1 px-1"),
          aria("label", "Add project"),
          on_submit(AddProject),
        ],
        [
          input([
            cls("input input-xs flex-1"),
            aria("label", "New project"),
            attr("placeholder", "New project"),
            value(w => w.up.new_project),
            on_input(v => SetNewProject(v)),
          ]),
          button([attr("type", "submit"), cls("btn btn-xs")], [txt("+")]),
        ],
      ),
      h3([cls("mt-3 px-3 text-xs font-semibold uppercase opacity-60")], [
        txt("Labels"),
      ]),
      each(
        w => w.up.nav_labels().iter(),
        button(
          [
            class_(it => it.value.nav_class),
            on_event(Click, (it, _) => Some(OpenLabel(it.value.index))),
          ],
          [
            show(it => "@\{it.value.name}"),
            span([cls("ml-auto text-xs opacity-60")], [
              show(it => it.value.count),
            ]),
          ],
        ),
      ),
    ],
  )
}

///|
fn TodoApp::view() -> View[TodoApp, TodoAppMsg] {
  scope(
    s => s.page_binds(),
    div(
      [
        cls(
          "flex min-h-[32rem] flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 md:flex-row",
        ),
      ],
      [
        sidebar(),
        main_([cls("flex min-w-0 flex-1 flex-col gap-3 p-4")], [
          if_(
            w => w.value.is_project,
            render_key(projects, w => w.up.project_index, todo_project),
            h2([cls("text-xl font-bold")], [show(w => w.value.title)]),
          ),
          render(quick_add_lens, quick_add),
          div([cls("flex flex-col")], [
            each(
              w => w.up.rows().iter(),
              div([], [
                when(
                  it => it.value.header is Some(_),
                  h3(
                    [
                      cls(
                        "mt-3 border-b border-base-300 pb-1 text-sm font-semibold",
                      ),
                    ],
                    [show(it => it.value.header.unwrap_or(""))],
                  ),
                ),
                render_key(tasks, it => it.value.index, todo_task),
              ]),
              key=(row, _) => row.id,
            ),
          ]),
          when(
            w => w.value.is_empty,
            p([cls("py-8 text-center text-sm opacity-60")], [
              show(w => w.value.empty_text),
            ]),
          ),
          div(
            [
              cls(
                "mt-auto flex flex-wrap items-center gap-3 border-t border-base-200 pt-3 text-xs",
              ),
            ],
            [
              label([cls("flex items-center gap-1")], [
                input([
                  attr("type", "checkbox"),
                  cls("checkbox checkbox-xs"),
                  checked(w => w.up.show_completed),
                  on_check(c => SetShowCompleted(c)),
                ]),
                txt("Show completed"),
              ]),
              when(
                w => w.value.has_completed,
                button(
                  [cls("btn btn-xs btn-ghost"), on_click(ClearCompleted)],
                  [txt("Clear completed")],
                ),
              ),
            ],
          ),
        ]),
      ],
    ),
  )
}

///|
fn TodoApp::set_today(self : TodoApp, today : String) -> TodoApp {
  { ..self, today, tasks: self.tasks.map(t => t.deep(s => { ..s, today, })), }
}

///|
fn TodoApp::add_labels(self : TodoApp, labels : Array[String]) -> TodoApp {
  let mut all = self.labels
  for l in labels {
    if !all.contains(l) {
      all = all.push(l)
    }
  }
  { ..self, labels: all, }
}

///|
fn TodoApp::update(
  self : TodoApp,
  msg : TodoAppMsg,
  ctx : Ctx[TodoApp, TodoAppMsg],
) -> TodoApp {
  match msg {
    OpenView(page) =>
      if page is (Inbox | Today | Upcoming) {
        { ..self, view: page, }
      } else {
        self
      }
    OpenProject(i) =>
      if i >= 0 && i < self.projects.length() {
        {
          ..self,
          project_index: i,
          view: if i == 0 {
            Inbox
          } else {
            Project
          },
        }
      } else {
        self
      }
    OpenLabel(i) =>
      if i >= 0 && i < self.labels.length() {
        { ..self, label_index: Some(i), view: Label, }
      } else {
        self
      }
    SetSearch(search) => {
      let page = if trim(search) != "" {
        Search
      } else if self.view is Search {
        Inbox
      } else {
        self.view
      }
      { ..self, search, view: page, }
    }
    SetShowCompleted(show_completed) => { ..self, show_completed, }
    ClearCompleted =>
      { ..self, tasks: self.tasks.filter(t => !t.is_completed), }
    SetNewProject(new_project) => { ..self, new_project, }
    AddProject => {
      let name = trim(self.new_project)
      if name == "" {
        return self
      }
      let project = {
        id: "p\{self.next_project_id}",
        name,
        color: colors[self.projects.length() % colors.length()],
        is_editing: false,
      }
      {
        ..self,
        projects: self.projects.push(project),
        next_project_id: self.next_project_id + 1,
        new_project: "",
        project_index: self.projects.length(),
        view: Project,
      }
    }
    SetToday(today) => if is_iso(today) { self.set_today(today) } else { self }
    SyncToday => {
      ctx.ask(today_ask, (), r => Some(TodayIs(r)))
      self
    }
    TodayIs(Ok(today)) =>
      if is_iso(today) {
        self.set_today(today)
      } else {
        self
      }
    TodayIs(_) => self
  }
}

///|
/// From QuickAdd: parses the text against today and the project names.
fn TodoApp::add_task(self : TodoApp, text : String) -> TodoApp {
  let names = self.projects.map(p => p.name).to_array()
  let parsed = parse_quick_add(text, today=self.today, projects=names)
  if parsed.title == "" {
    return self
  }
  let named = self.projects
    .iter()
    .find_first(p => Some(p.name) == parsed.project)
  let here = if self.view is Project {
    self.current_project()
  } else {
    self.projects[0]
  }
  let due = if parsed.due != "" {
    parsed.due
  } else if self.view is Today {
    self.today
  } else {
    ""
  }
  let task = TodoTask::new(
    "t\{self.next_task_id}",
    parsed.title,
    today=self.today,
    project_id=named.unwrap_or(here).id,
    due~,
    priority=parsed.priority,
    labels=Vec::of(parsed.labels),
  )
  { ..self, tasks: self.tasks.push(task), next_task_id: self.next_task_id + 1, }.add_labels(
    parsed.labels,
  )
}

///|
/// From the shown project's header; its tasks move to the inbox.
fn TodoApp::remove_project(self : TodoApp, key : Int32) -> TodoApp {
  if key == 0 {
    return self
  }
  let id = self.projects[key].id
  {
    ..self,
    tasks: self.tasks.map(t => {
      if t.project_id == id {
        t.deep(s => { ..s, project_id: "inbox", })
      } else {
        t
      }
    }),
    projects: self.projects.remove(key),
    project_index: 0,
    view: if self.view is Project {
      Inbox
    } else {
      self.view
    },
  }
}

///|
/// Moves past the next task in the same project.
fn TodoApp::move_task(self : TodoApp, i : Int32, delta : Int32) -> TodoApp {
  let project_id = self.tasks[i].project_id
  match neighbor(self.tasks, i, delta, t => t.project_id == project_id) {
    Some(j) => { ..self, tasks: self.tasks.swap(i, j), }
    None => self
  }
}

///|
fn all_tasks(tasks : Vec[TodoTask]) -> Array[TodoTask] {
  tasks.iter().flat_map(t => t.all().iter()).to_array()
}

///|
pub let todo_app : Component[TodoApp, TodoAppMsg] = component(
  "TodoApp",
  view=TodoApp::view,
  update=TodoApp::update,
  on=[
    remove_project.from(projects, (a, _, key, ctx) => {
      ctx.stop()
      a.remove_project(key)
    }),
    add_task.on((a, text, ctx) => {
      ctx.stop()
      a.add_task(text)
    }),
    remove_task.from(tasks, (a, _, i, ctx) => {
      ctx.stop()
      { ..a, tasks: a.tasks.remove(i), }
    }),
    move_task.from(tasks, (a, delta, i, ctx) => {
      ctx.stop()
      a.move_task(i, delta)
    }),
    labels_changed.on((a, labels, ctx) => {
      ctx.stop()
      a.add_labels(labels)
    }),
  ],
  provides=[projects_provided.from(projects_lens)],
  children=() => {
    [
      @tutuca.each_child(todo_project, projects),
      @tutuca.each_child(todo_task, tasks),
      @tutuca.child(quick_add, quick_add_lens),
    ]
  },
  fields=[
    field_info("today", Text, constraints=[Where("iso")], computed_initial=true),
    field_info(
      "projects",
      ListOf(ComponentOf(["TodoProject"])),
      constraints=[MinLength(1)],
      initial=[],
    ),
    field_info("labels", ListOf(Text), initial=[]),
    field_info("tasks", ListOf(ComponentOf(["TodoTask"])), initial=[]),
    field_info(
      "view",
      OneOf(["inbox", "today", "upcoming", "project", "label", "search"]),
      initial="inbox",
    ),
    field_info("project_index", KeyOf("projects"), checks=[
      "the project index is in range",
    ]),
    field_info("label_index", Optional(KeyOf("labels"))),
    field_info("search", Text, initial=""),
    field_info("show_completed", Boolean, initial=false),
    field_info("quick_add", ComponentOf(["QuickAdd"])),
    field_info("new_project", Text, initial=""),
    field_info("next_task_id", Whole, constraints=[AtLeast(1)], initial=1),
    field_info("next_project_id", Whole, constraints=[AtLeast(1)], initial=1),
  ],
  messages=@tutuca.json_messages(
    [
      "OpenView", "OpenProject", "OpenLabel", "SetSearch", "SetShowCompleted", "ClearCompleted",
      "SetNewProject", "AddProject", "removeProject", "addTask", "removeTask", "moveTask",
      "labelsChanged", "SetToday", "SyncToday", "TodayIs",
    ],
    heard=[
      @tutuca.heard(remove_project),
      @tutuca.heard(add_task),
      @tutuca.heard(remove_task),
      @tutuca.heard(move_task),
      @tutuca.heard(labels_changed),
    ],
    replies=[@tutuca.reply("TodayIs", today_ask)],
  ),
  invariants=[
    (
      "the inbox is first",
      a => a.projects.first().map(p => p.id) == Some("inbox"),
    ),
    (
      "project ids are unique",
      a => {
        let ids = a.projects.map(p => p.id).to_array()
        ids.iter().all(id => ids.iter().count_if(x => x == id) == 1)
      },
    ),
    (
      "tasks are in projects",
      a => {
        all_tasks(a.tasks)
        .iter()
        .all(t => a.projects.any(p => p.id == t.project_id))
      },
    ),
    (
      "tasks know today",
      a => all_tasks(a.tasks).iter().all(t => t.today == a.today),
    ),
    (
      "the project index is in range",
      a => a.project_index >= 0 && a.project_index < a.projects.length(),
    ),
    (
      "a label page has a label",
      a => !(a.view is Label) || a.current_label() is Some(_),
    ),
  ],
  post=(msg, _, next) => {
    match msg {
      ClearCompleted => next.tasks.all(t => !t.is_completed)
      _ => true
    }
  },
)

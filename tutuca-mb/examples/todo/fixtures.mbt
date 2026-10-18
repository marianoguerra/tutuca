// Sample todo apps for stories, tests and the demo.

///|
/// Stories run on a fixed date, so due labels and views don't change from day to day.
pub let fixture_today : String = "2026-10-16" // A Friday.

///|
/// A task described by its title and what differs from the defaults: `due` in days from
/// today, `project` by name.
pub(all) struct Spec {
  title : String
  due : Int32?
  priority : Int32
  labels : Array[String]
  done : Bool
  description : String
  project : String?
  subtasks : Array[Spec]
}

///|
pub fn spec(
  title : String,
  due? : Int32,
  priority~ : Int32 = 4,
  labels~ : Array[String] = [],
  done~ : Bool = false,
  description~ : String = "",
  project? : String,
  subtasks~ : Array[Spec] = [],
) -> Spec {
  { title, due, priority, labels, done, description, project, subtasks, }
}

///|
fn make_task(
  today : String,
  projects : Array[TodoProject],
  s : Spec,
  id : String,
) -> TodoTask {
  let project = s.project
    .bind(name => projects.iter().find_first(p => p.name == name))
    .unwrap_or(projects[0])
  let subs = s.subtasks.mapi((i, sub) => {
    make_task(
      today,
      projects,
      { ..sub, project: Some(project.name), },
      "\{id}.\{i + 1}",
    )
  })
  TodoTask::new(
    id,
    s.title,
    today~,
    description=s.description,
    project_id=project.id,
    due=s.due.map(n => add_days(today, n)).unwrap_or(""),
    priority=s.priority,
    labels=Vec::of(s.labels),
    is_completed=s.done,
    subtasks=Vec::of(subs),
  )
}

///|
/// An app on `today` with these projects (name, color) after the inbox, and these tasks.
pub fn make_app(
  today : String,
  projects~ : Array[(String, Color)] = [],
  tasks~ : Array[Spec] = [],
  page~ : Page = Inbox,
) -> TodoApp {
  let all = [
    TodoProject::inbox(),
    ..projects.mapi((i, p) => {
      id: "p\{i + 1}",
      name: p.0,
      color: p.1,
      is_editing: false,
    }),
  ]
  let made = tasks.mapi((i, s) => make_task(today, all, s, "t\{i + 1}"))
  let labels = []
  for t in all_tasks(Vec::of(made)) {
    for l in t.labels.iter() {
      if !labels.contains(l) {
        labels.push(l)
      }
    }
  }
  // By UTF-16 code units, as JS's sort (String's compare goes by length first).
  labels.sort_by((a, b) => a.lexical_compare(b))
  {
    today,
    projects: Vec::of(all),
    labels: Vec::of(labels),
    tasks: Vec::of(made),
    view: page,
    project_index: 0,
    label_index: None,
    search: "",
    show_completed: false,
    quick_add: { text: "", },
    new_project: "",
    next_task_id: made.length() + 1,
    next_project_id: all.length(),
  }
}

///|
/// A small app on the fixture date.
pub fn sample_app() -> TodoApp {
  make_app(fixture_today, projects=[("Work", Blue), ("Home", Green)], tasks=[
    spec("Reply to Ada", due=-1, priority=1, labels=["email"]),
    spec("Water the plants", due=0, project="Home", labels=["chores"]),
    spec(
      "Ship the storybook",
      due=0,
      priority=2,
      project="Work",
      description="Stories, sequences and stress tests",
      subtasks=[spec("Write stories", done=true), spec("Stress test them")],
    ),
    spec("Plan the week", due=3, priority=3, project="Work"),
    spec("Buy carrots", due=1, labels=["shop", "chores"]),
    spec("Read a paper"),
    spec("Book flights", due=12, project="Home"),
    spec("Old done task", done=true),
  ])
}

///|
/// A week of plans, due relative to today so the today and upcoming views have something.
pub fn week_of_plans(today : String) -> TodoApp {
  make_app(
    today,
    page=Today,
    projects=[("Work", Blue), ("Home", Green), ("Errands", Orange)],
    tasks=[
      spec("Reply to the design review", due=-1, priority=1, labels=["email"]),
      spec(
        "Prepare the quarterly report",
        due=0,
        priority=2,
        project="Work",
        description="Numbers from finance, charts from the dashboard",
        subtasks=[
          spec("Collect the numbers", done=true),
          spec("Draft the summary"),
          spec("Send for review"),
        ],
      ),
      spec("Water the plants", due=0, project="Home", labels=["chores"]),
      spec("Buy carrots and coffee", due=1, project="Errands", labels=["shop"]),
      spec("Pick up the parcel", due=2, project="Errands", priority=3),
      spec("Plan next sprint", due=4, priority=3, project="Work", labels=[
        "meeting",
      ]),
      spec("Fix the leaking tap", due=6, project="Home", labels=["chores"]),
      spec("Book flights for the holidays", due=20, project="Home"),
      spec("Read the paper Ada sent"),
      spec("Renew the library card", done=true),
    ],
  )
}

///|
/// A random app keeping the app's invariants: the inbox first, tasks in known projects, every
/// task on the app's date (components/todo/fixtures.js's todoAppArb). `pick(n)` is a random
/// number below `n`.
pub fn random_app(pick : (Int32) -> Int32) -> TodoApp {
  let names = ["Work", "Home", "Errands", "Ideas"]
  let projects = names.filter(_ => pick(2) == 0).map(n => (n, Grey))
  let tasks = Array::makei(pick(7), _ => random_spec(pick, [..names, "Inbox"]))
  make_app(
    add_days("2026-01-01", pick(366)),
    projects~,
    tasks~,
    page=[Inbox, Today, Upcoming][pick(3)],
  )
}

///|
/// A random task spec in one of `projects` (by name), with up to two subtasks.
fn random_spec(pick : (Int32) -> Int32, projects : Array[String]) -> Spec {
  let titles = ["Buy milk", "Call mom", "Write docs", "Fix bug", "Run"]
  spec(
    titles[pick(titles.length())],
    due?=if pick(2) == 0 { None } else { Some(pick(20) - 5) },
    priority=pick(4) + 1,
    labels=["home", "urgent", "shop"].filter(_ => pick(2) == 0),
    project=projects[pick(projects.length())],
    done=pick(2) == 0,
    subtasks=Array::makei(pick(3), _ => {
      spec(["a", "b"][pick(2)], done=pick(2) == 0)
    }),
  )
}

///|
/// A random valid task on a random date, as random apps make them.
pub fn random_task(pick : (Int32) -> Int32) -> TodoTask {
  make_app(add_days("2026-01-01", pick(366)), tasks=[
    random_spec(pick, ["Inbox"]),
  ]).tasks[0]
}

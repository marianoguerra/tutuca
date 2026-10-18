// A task with its subtasks, due date, priority and labels, shown as a row or edited in place.

///|
pub(all) struct TodoTask {
  id : String
  title : String
  description : String
  project_id : String
  due : String // An ISO date, or "" for none.
  priority : Int32 // 1 (highest) to 4.
  labels : Vec[String]
  is_completed : Bool
  is_editing : Bool
  is_expanded : Bool
  subtasks : Vec[TodoTask]
  next_sub_id : Int32
  new_subtask : String
  today : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn TodoTask::new(
  id : String,
  title : String,
  today~ : String,
  description~ : String = "",
  project_id~ : String = "inbox",
  due~ : String = "",
  priority~ : Int32 = 4,
  labels~ : Vec[String] = Vec::new(),
  is_completed~ : Bool = false,
  subtasks~ : Vec[TodoTask] = Vec::new(),
) -> TodoTask {
  {
    id,
    title,
    description,
    project_id,
    due,
    priority,
    labels,
    is_completed,
    is_editing: false,
    is_expanded: true,
    subtasks,
    next_sub_id: subtasks.length() + 1,
    new_subtask: "",
    today,
  }
}

///|
pub(all) enum TodoTaskMsg {
  Toggle
  SetTitle(String)
  SetDescription(String)
  SetDue(String)
  SetPriority(String)
  SetLabelsText(String)
  SetProject(String)
  BeginEdit
  EndEdit
  ToggleExpand
  SetNewSubtask(String)
  AddSubtask
  Remove
  MoveUp
  MoveDown
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by a task's Delete button, to whoever holds it.
pub let remove_task : Signal[Unit] = Signal::new("removeTask")

///|
/// Sent by a task's up and down buttons with the direction.
pub let move_task : Signal[Int32] = Signal::new("moveTask")

///|
/// Sent when a task's labels change; the app keeps the list of labels.
pub let labels_changed : Signal[Array[String]] = Signal::new("labelsChanged")

///|
/// The projects an app provides, for the task editor's project select.
pub let projects_provided : Provide[Vec[TodoProject]] = Provide::new("projects")

///|
let subtasks : Items[TodoTask, Int32, TodoTask] = items(
  "subtasks",
  t => t.subtasks,
  (t, v) => { ..t, subtasks: v, },
)

///|
pub fn TodoTask::matches(self : TodoTask, query : String) -> Bool {
  "\{self.title} \{self.description}".to_lower().contains(query.to_lower())
}

///|
/// The task and its subtasks with `f` applied to each.
pub fn TodoTask::deep(self : TodoTask, f : (TodoTask) -> TodoTask) -> TodoTask {
  let t = f(self)
  { ..t, subtasks: t.subtasks.map(sub => sub.deep(f)), }
}

///|
/// The task and all its subtasks, depth first.
pub fn TodoTask::all(self : TodoTask) -> Array[TodoTask] {
  let out = [self]
  for sub in self.subtasks.iter() {
    out.append(sub.all())
  }
  out
}

///|
fn TodoTask::has_due(self : TodoTask) -> Bool {
  self.due != ""
}

///|
fn TodoTask::title_class(self : TodoTask) -> String {
  if self.is_completed {
    "break-words line-through opacity-50"
  } else {
    "break-words"
  }
}

///|
fn TodoTask::subtask_progress(self : TodoTask) -> String {
  let done = self.subtasks.count(s => s.is_completed)
  "\{if self.is_expanded { "▾" } else { "▸" }} \{done}/\{self.subtasks.length()}"
}

///|
fn TodoTask::labels_text(self : TodoTask) -> String {
  self.labels.iter().map(l => "@\{l}").join(" ")
}

///|
fn TodoTask::editor() -> View[TodoTask, TodoTaskMsg] {
  div(
    [cls("my-2 flex flex-col gap-2 rounded-box border border-base-300 p-3")],
    [
      input([
        cls("input input-sm input-ghost w-full text-base font-medium"),
        aria("label", "Task name"),
        value(s => s.title),
        on_input(v => SetTitle(v)),
      ]),
      textarea([
        cls("textarea textarea-ghost textarea-sm w-full"),
        aria("label", "Description"),
        attr("placeholder", "Description"),
        value(s => s.description),
        on_input(v => SetDescription(v)),
      ]),
      div([cls("flex flex-wrap items-center gap-2")], [
        input([
          attr("type", "date"),
          cls("input input-xs w-auto"),
          aria("label", "Due date"),
          value(s => s.due),
          on_change(v => SetDue(v)),
        ]),
        select(
          [
            cls("select select-xs w-auto"),
            aria("label", "Priority"),
            value(s => s.priority.to_string()),
            on_change(v => SetPriority(v)),
          ],
          [1, 2, 3, 4].map(n => {
            option([attr("value", n.to_string())], [txt("Priority \{n}")])
          }),
        ),
        input([
          cls("input input-xs w-40"),
          aria("label", "Labels"),
          attr("placeholder", "@label"),
          value(s => s.labels_text()),
          on_change(v => SetLabelsText(v)),
        ]),
        // Only inside an app, which provides its projects.
        when_provided(
          projects_provided,
          select(
            [
              cls("select select-xs w-auto"),
              aria("label", "Project"),
              value(w => w.up.project_id),
              on_change(v => SetProject(v)),
            ],
            [
              each(
                w => w.value.iter(),
                option([bind_str("value", it => it.value.id)], [
                  show(it => it.value.name),
                ]),
              ),
            ],
          ),
        ),
      ]),
      form([cls("flex gap-2"), on_submit(AddSubtask)], [
        input([
          cls("input input-xs flex-1"),
          aria("label", "New subtask"),
          attr("placeholder", "Add a subtask"),
          value(s => s.new_subtask),
          on_input(v => SetNewSubtask(v)),
        ]),
        button([attr("type", "submit"), cls("btn btn-xs")], [txt("Add subtask")]),
      ]),
      div([cls("flex justify-end")], [
        button([cls("btn btn-sm btn-primary"), on_click(EndEdit)], [txt("Done")]),
      ]),
    ],
  )
}

///|
fn TodoTask::row() -> View[TodoTask, TodoTaskMsg] {
  div([cls("group flex items-start gap-3 py-2")], [
    input([
      attr("type", "checkbox"),
      class_(s => check_class(s.priority)),
      aria("label", "Complete task"),
      checked(s => s.is_completed),
      on_change(_ => Toggle),
    ]),
    div([cls("flex min-w-0 flex-1 flex-col gap-0.5")], [
      span([class_(s => s.title_class()), on_dblclick(BeginEdit)], [
        show(s => s.title),
      ]),
      when(
        s => s.description != "",
        p([cls("truncate text-xs text-base-content/60")], [
          show(s => s.description),
        ]),
      ),
      div([cls("flex flex-wrap items-center gap-2 text-xs")], [
        when(
          s => s.has_due(),
          span(
            [
              class_(s => {
                "flex items-center gap-1 \{tone_class(due_tone(s.due, s.today))}"
              }),
            ],
            [txt("📅 "), show(s => due_label(s.due, s.today))],
          ),
        ),
        each(
          s => s.labels.iter(),
          span([cls("badge badge-ghost badge-xs")], [show(it => "@\{it.value}")]),
        ),
        when(
          s => s.subtasks.length() > 0,
          button([cls("link link-hover opacity-60"), on_click(ToggleExpand)], [
            show(s => s.subtask_progress()),
          ]),
        ),
      ]),
    ]),
    div([cls("flex shrink-0 gap-0.5")], [
      button([cls(icon_btn), attr("title", "Move up"), on_click(MoveUp)], [
        txt("↑"),
      ]),
      button([cls(icon_btn), attr("title", "Move down"), on_click(MoveDown)], [
        txt("↓"),
      ]),
      button([cls(icon_btn), attr("title", "Edit"), on_click(BeginEdit)], [
        txt("✎"),
      ]),
      button(
        [
          cls("\{icon_btn} text-error"),
          attr("title", "Delete"),
          on_click(Remove),
        ],
        [txt("🗑")],
      ),
    ]),
  ])
}

///|
fn TodoTask::view() -> View[TodoTask, TodoTaskMsg] {
  div([cls("flex flex-col border-b border-base-200 last:border-0")], [
    if_(s => s.is_editing, TodoTask::editor(), TodoTask::row()),
    when(
      s => s.is_expanded && s.subtasks.length() > 0,
      div([cls("ml-8")], [render_self_each(subtasks)]),
    ),
  ])
}

///|
fn TodoTask::update(
  self : TodoTask,
  msg : TodoTaskMsg,
  ctx : Ctx[TodoTask, TodoTaskMsg],
) -> TodoTask {
  match msg {
    // Completing a task completes its subtasks; reopening it leaves them.
    Toggle =>
      if self.is_completed {
        { ..self, is_completed: false, }
      } else {
        self.deep(t => { ..t, is_completed: true, })
      }
    SetTitle(title) => { ..self, title, }
    SetDescription(description) => { ..self, description, }
    SetDue(due) =>
      if due == "" || is_iso(due) {
        { ..self, due, }
      } else {
        self
      }
    // From a select: values it doesn't offer are ignored.
    SetPriority(text) =>
      match text {
        "1" | "2" | "3" | "4" =>
          { ..self, priority: text.get_char(0).unwrap().to_int() - 48, }
        _ => self
      }
    SetLabelsText(text) => {
      let labels = labels_of(text)
      ctx.notify(labels_changed, labels.to_array())
      { ..self, labels, }
    }
    // From the project select: "" when it matched no option.
    SetProject("") => self
    SetProject(project_id) => self.deep(t => { ..t, project_id, })
    BeginEdit => { ..self, is_editing: true, }
    EndEdit => {
      let title = trim(self.title)
      {
        ..self,
        is_editing: false,
        title: if title == "" {
          "Untitled"
        } else {
          title
        },
      }
    }
    ToggleExpand => { ..self, is_expanded: !self.is_expanded, }
    SetNewSubtask(new_subtask) => { ..self, new_subtask, }
    AddSubtask => {
      let title = trim(self.new_subtask)
      if title == "" {
        return self
      }
      let sub = TodoTask::new(
        "\{self.id}.\{self.next_sub_id}",
        title,
        today=self.today,
        project_id=self.project_id,
      )
      {
        ..self,
        subtasks: self.subtasks.push(sub),
        next_sub_id: self.next_sub_id + 1,
        new_subtask: "",
        is_expanded: true,
      }
    }
    Remove => {
      ctx.notify(remove_task, ())
      self
    }
    MoveUp => {
      ctx.notify(move_task, -1)
      self
    }
    MoveDown => {
      ctx.notify(move_task, 1)
      self
    }
  }
}

///|
pub let todo_task : Component[TodoTask, TodoTaskMsg] = component(
  "TodoTask",
  view=TodoTask::view,
  update=TodoTask::update,
  on=[
    // From a subtask, which the key points at.
    remove_task.from(subtasks, (t, _, i, ctx) => {
      ctx.stop()
      { ..t, subtasks: t.subtasks.remove(i), }
    }),
    move_task.from(subtasks, (t, delta, i, ctx) => {
      ctx.stop()
      { ..t, subtasks: t.subtasks.swap(i, i + delta), }
    }),
    // A subtask's labels: they pass through to the app, as JS's no-op labelsChanged.
    labels_changed.on((t, _, _) => t),
  ],
  fields=[
    field_info("id", Text, initial=""),
    field_info("title", Text, initial=""),
    field_info("description", Text, initial=""),
    field_info("project_id", Text, initial="inbox"),
    field_info("due", Text, constraints=[Where("isoOrEmpty")], initial="", checks=[
      "due is an ISO date or empty",
    ]),
    field_info("priority", OneOf([4, 1, 2, 3]), initial=4, checks=[
      "priority is 1 to 4",
    ]),
    field_info("labels", ListOf(Text), initial=[]),
    field_info("is_completed", Boolean, initial=false),
    field_info("is_editing", Boolean, initial=false),
    field_info("is_expanded", Boolean, initial=true),
    field_info("subtasks", ListOf(ComponentOf(["TodoTask"])), initial=[]),
    field_info("next_sub_id", Whole, constraints=[AtLeast(1)], initial=1),
    field_info("new_subtask", Text, initial=""),
    field_info("today", Text, constraints=[Where("iso")], computed_initial=true),
  ],
  messages=@tutuca.json_messages(
    [
      "Toggle", "SetTitle", "SetDescription", "SetDue", "SetPriority", "SetLabelsText",
      "SetProject", "BeginEdit", "EndEdit", "ToggleExpand", "SetNewSubtask", "AddSubtask",
      "Remove", "MoveUp", "MoveDown", "removeTask", "moveTask", "labelsChanged",
    ],
    heard=[
      @tutuca.heard(remove_task),
      @tutuca.heard(move_task),
      @tutuca.heard(labels_changed),
    ],
  ),
  children=() => [@tutuca.each_self(subtasks)],
  computed=[
    ("matches", _ => None), // Takes the query.
    ("has_due", s => Some(Json::boolean(s.has_due()))),
    ("due_text", s => Some(Json::string(due_label(s.due, s.today)))),
    (
      "due_class",
      s => {
        Some(
          Json::string(
            "flex items-center gap-1 \{tone_class(due_tone(s.due, s.today))}",
          ),
        )
      },
    ),
    ("check_class", s => Some(Json::string(check_class(s.priority)))),
    ("title_class", s => Some(Json::string(s.title_class()))),
    ("has_description", s => Some(Json::boolean(s.description != ""))),
    ("has_subtasks", s => Some(Json::boolean(s.subtasks.length() > 0))),
    (
      "show_subtasks",
      s => Some(Json::boolean(s.is_expanded && s.subtasks.length() > 0)),
    ),
    ("subtask_progress", s => Some(Json::string(s.subtask_progress()))),
    ("labels_text", s => Some(Json::string(s.labels_text()))),
  ],
  invariants=[
    ("due is an ISO date or empty", t => t.due == "" || is_iso(t.due)),
    ("priority is 1 to 4", t => t.priority >= 1 && t.priority <= 4),
  ],
  post=(msg, prev, next) => {
    match msg {
      Toggle => next.is_completed != prev.is_completed
      AddSubtask =>
        trim(prev.new_subtask) == "" ||
        next.subtasks.length() == prev.subtasks.length() + 1
      _ => true
    }
  },
)

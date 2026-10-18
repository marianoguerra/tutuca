// A project: a named, colored list of tasks.

///|
pub(all) struct TodoProject {
  id : String
  name : String
  color : Color
  is_editing : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn TodoProject::inbox() -> TodoProject {
  { id: "inbox", name: "Inbox", color: Grey, is_editing: false, }
}

///|
pub(all) enum TodoProjectMsg {
  BeginRename
  SetName(String)
  SetColor(String)
  EndRename
  Remove
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by a project's Delete button.
pub let remove_project : Signal[Unit] = Signal::new("removeProject")

///|
fn TodoProject::dot_class(self : TodoProject) -> String {
  "size-3 shrink-0 rounded-full \{self.color.bg()}"
}

///|
fn TodoProject::view() -> View[TodoProject, TodoProjectMsg] {
  div([cls("flex flex-wrap items-center gap-2")], [
    span([class_(s => s.dot_class())], []),
    if_(
      s => s.is_editing,
      div([cls("flex flex-wrap items-center gap-2")], [
        input([
          cls("input input-sm text-xl font-bold"),
          aria("label", "Project name"),
          value(s => s.name),
          on_input(v => SetName(v)),
        ]),
        select(
          [
            cls("select select-sm w-auto"),
            aria("label", "Color"),
            value(s => s.color.name()),
            on_change(v => SetColor(v)),
          ],
          colors.map(c => option([attr("value", c.name())], [txt(c.name())])),
        ),
        button([cls("btn btn-sm btn-primary"), on_click(EndRename)], [
          txt("Done"),
        ]),
      ]),
      h2(
        [
          cls("text-xl font-bold"),
          attr("title", "Double-click to rename"),
          on_dblclick(BeginRename),
        ],
        [show(s => s.name)],
      ),
    ),
    when(
      s => s.id != "inbox",
      div([cls("ml-auto flex gap-1")], [
        button([cls("btn btn-xs btn-ghost"), on_click(BeginRename)], [
          txt("Rename"),
        ]),
        button([cls("btn btn-xs btn-ghost text-error"), on_click(Remove)], [
          txt("Delete"),
        ]),
      ]),
    ),
  ])
}

///|
fn TodoProject::update(
  self : TodoProject,
  msg : TodoProjectMsg,
  ctx : Ctx[TodoProject, TodoProjectMsg],
) -> TodoProject {
  match msg {
    BeginRename =>
      if self.id != "inbox" {
        { ..self, is_editing: true, }
      } else {
        self
      }
    SetName(name) => { ..self, name, }
    SetColor(name) =>
      match Color::from_name(name) {
        Some(color) => { ..self, color, }
        None => self
      }
    EndRename => {
      let name = trim(self.name)
      {
        ..self,
        is_editing: false,
        name: if name == "" {
          "Untitled"
        } else {
          name
        },
      }
    }
    Remove => {
      ctx.notify(remove_project, ())
      self
    }
  }
}

///|
pub let todo_project : Component[TodoProject, TodoProjectMsg] = component(
  "TodoProject",
  view=TodoProject::view,
  update=TodoProject::update,
  fields=[
    field_info("id", Text, initial="inbox"),
    field_info("name", Text, initial="Inbox"),
    field_info(
      "color",
      OneOf(["grey", "red", "orange", "green", "blue", "violet"]),
      initial="grey",
    ),
    field_info("is_editing", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages([
    "BeginRename", "SetName", "SetColor", "EndRename", "Remove",
  ]),
)

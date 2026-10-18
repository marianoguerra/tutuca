///|
/// A quick add line, parsed.
pub(all) struct Parsed {
  title : String
  due : String
  due_text : String
  priority : Int32
  project : String?
  labels : Array[String]
} derive(Eq, Debug)

///|
/// Parses a quick add line as Todoist does: "Buy milk tomorrow p1 #Errands @shop" is the
/// task "Buy milk", due tomorrow, priority 1, in the Errands project, labelled shop.
/// `projects` are the known project names; a #name that isn't one stays in the title.
/// Without a `today`, due words are kept as `due_text` but not resolved.
pub fn parse_quick_add(
  text : String,
  today? : String,
  projects~ : Array[String] = [],
) -> Parsed {
  let words = words_of(text)
  let title = []
  let labels = []
  let mut due = ""
  let mut due_text = ""
  let mut priority = 4
  let mut project = None
  let mut i = 0
  while i < words.length() {
    let word = words[i]
    i += 1
    if word.length() == 2 &&
      word.get_char(0) is Some('p' | 'P') &&
      word.get_char(1) is Some('1'..<='4') {
      priority = word.get_char(1).unwrap().to_int() - '0'.to_int()
      continue
    }
    if word.length() > 1 && word.has_prefix("@") {
      let label = word.view(start_offset=1).to_owned().to_lower()
      if !labels.contains(label) {
        labels.push(label)
      }
      continue
    }
    if word.length() > 1 && word.has_prefix("#") {
      let name = word.view(start_offset=1).to_owned()
      let known = projects
        .iter()
        .find_first(p => p.to_lower() == name.to_lower())
      if known is Some(_) || today is None {
        project = Some(known.unwrap_or(name))
        continue
      }
    }
    if due_text == "" &&
      parse_due_words(words, i - 1, today.unwrap_or("2000-01-03"))
      is Some((date, used)) {
      due_text = words[i - 1:i - 1 + used].iter().join(" ")
      if today is Some(_) {
        due = date
      }
      i += used - 1
      continue
    }
    title.push(word)
  }
  { title: title.join(" "), due, due_text, priority, project, labels, }
}

///|
pub(all) struct QuickAdd {
  text : String
} derive(Eq, Debug, Default, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum QuickAddMsg {
  SetText(String)
  Submit
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent with the text of a submitted quick add line.
pub let add_task : Signal[String] = Signal::new("addTask")

///|
fn QuickAdd::parsed(self : QuickAdd) -> Parsed {
  parse_quick_add(self.text)
}

///|
fn QuickAdd::view() -> View[QuickAdd, QuickAddMsg] {
  form(
    [
      aria("label", "Quick add task"),
      cls("flex flex-col gap-1"),
      on_submit(Submit),
    ],
    [
      div([cls("join w-full")], [
        input([
          cls("input input-sm join-item flex-1"),
          aria("label", "Quick add"),
          attr("placeholder", "e.g. Buy milk tomorrow p1 #Errands @shop"),
          value(s => s.text),
          on_input(v => SetText(v)),
        ]),
        button(
          [attr("type", "submit"), cls("btn btn-sm btn-primary join-item")],
          [txt("Add task")],
        ),
      ]),
      when(
        s => trim(s.text) != "",
        scope(
          s => s.parsed(),
          div([cls("flex flex-wrap items-center gap-1 text-xs")], [
            span([cls("font-medium")], [
              show(p => {
                if p.value.title == "" {
                  "(no title)"
                } else {
                  p.value.title
                }
              }),
            ]),
            when(
              p => p.value.due_text != "",
              span([cls("badge badge-success badge-xs")], [
                txt("📅 "),
                show(p => p.value.due_text),
              ]),
            ),
            when(
              p => p.value.priority < 4,
              span([cls("badge badge-error badge-xs")], [
                show(p => "p\{p.value.priority}"),
              ]),
            ),
            when(
              p => p.value.project is Some(_),
              span([cls("badge badge-info badge-xs")], [
                show(p => "#\{p.value.project.unwrap_or("")}"),
              ]),
            ),
            each(
              p => p.value.labels.iter(),
              span([cls("badge badge-ghost badge-xs")], [
                show(it => "@\{it.value}"),
              ]),
            ),
          ]),
        ),
      ),
    ],
  )
}

///|
fn QuickAdd::update(
  self : QuickAdd,
  msg : QuickAddMsg,
  ctx : Ctx[QuickAdd, QuickAddMsg],
) -> QuickAdd {
  match msg {
    SetText(text) => { text, }
    Submit => {
      if trim(self.text) == "" {
        return self
      }
      ctx.notify(add_task, self.text)
      { text: "", }
    }
  }
}

///|
pub let quick_add : Component[QuickAdd, QuickAddMsg] = component(
  "QuickAdd",
  view=QuickAdd::view,
  update=QuickAdd::update,
  fields=[field_info("text", Text, initial="")],
  messages=@tutuca.json_messages(["SetText", "Submit"]),
  post=(msg, prev, next) => {
    match msg {
      Submit => trim(prev.text) == "" || next.text == ""
      SetText(_) => true
    }
  },
)

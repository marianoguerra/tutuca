// The storybook UI, made with tutuca, as JS's src/storybook/ui: the sidebar of stories by
// book and the selected one's preview, with its Steps, Stress test and Dev panels.

///|
using @tutuca {
  div,
  span,
  p,
  h1,
  h2,
  h3,
  button,
  input,
  select,
  option,
  section,
  label,
  ul,
  ol,
  li,
  pre,
  main_,
  txt,
  show,
  when,
  if_,
  each,
  cls,
  class_,
  attr,
  aria,
  bind,
  bind_str,
  value,
  checked,
  on_click,
  on_input,
  on_change,
  on_check,
  on_event,
  component,
  type View,
  type ViewAt,
  type Item,
  type Component,
}

// --- what the UI keeps -----------------------------------------------------------------------

///|
/// A story in the sidebar: the first of its group shows the group's header.
pub(all) struct StoryLink {
  id : String
  group : String
  name : String
  show_group : Bool
  group_size : Int32
  is_generated : Bool
} derive(Eq, Debug)

///|
/// The panel shown below the preview.
pub(all) enum Panel {
  Steps
  Stress
  Dev
} derive(Eq, Debug)

///|
/// The step form: a message to send to one of the story's targets.
pub(all) struct StepForm {
  target : Int32
  message : String
  key : String
  args : String // The message's arguments, as a JSON array.
  arg_seed : Int32
  is_playing : Bool
} derive(Eq, Debug)

///|
let new_form : StepForm = {
  target: 0,
  message: "",
  key: "",
  args: "[]",
  arg_seed: 1,
  is_playing: false,
}

///|
/// The stress test's settings.
pub(all) struct StressForm {
  runs : Int32
  steps : Int32 // Max steps per run.
  seed : Int32
  from : StressFrom
  events : Bool // DOM events instead of messages.
} derive(Eq, Debug)

///|
let new_stress : StressForm = {
  runs: 100,
  steps: 20,
  seed: 1,
  from: FromStory,
  events: false,
}

///|
pub(all) struct Storybook {
  links : Array[StoryLink]
  filter : String
  collapsed : Array[String] // Groups whose stories are hidden.
  selected : String
  is_generated : Bool
  seed : Int32 // The seed of a generated story's state.
  panel : Panel
  summary : Summary?
  error : String
  form : StepForm
  stress : StressForm
  dev : @dev.DevPanel // The current entry's state, tasks and the book's components.
  prefix : String // Starts the previews' app keys, so a page can run many storybooks.
} derive(Eq, Debug)

///|
let dev_lens : @tutuca.Lens[Storybook, @dev.DevPanel] = @tutuca.field(
  "dev",
  s => s.dev,
  (s, dev) => { ..s, dev, },
)

///|
/// The UI state for `books`, with `selected` chosen; `prefix` starts its previews' app keys.
pub fn[N] Storybook::of(
  books : Array[Book[N]],
  selected~ : String = "",
  prefix~ : String = "",
) -> Storybook {
  let links = []
  for b in books {
    for i, s in b.stories {
      links.push({
        id: s.id,
        group: b.title,
        name: s.name,
        show_group: i == 0,
        group_size: b.stories.length(),
        is_generated: s.is_generated,
      })
    }
  }
  let picked = links.iter().find_first(l => l.id == selected)
  {
    links,
    filter: "",
    collapsed: [],
    selected: picked.map(l => l.id).unwrap_or(""),
    is_generated: picked.map(l => l.is_generated).unwrap_or(false),
    seed: 0,
    panel: Steps,
    summary: None,
    error: "",
    form: new_form,
    stress: new_stress,
    dev: @dev.DevPanel::new(),
    prefix,
  }
}

///|
/// The preview's app key: the story and the seed of its state.
fn Storybook::app_key(self : Storybook) -> String {
  "\{self.prefix}\{self.selected}@\{self.seed}"
}

///|
pub(all) enum StorybookMsg {
  SetFilter(String)
  ToggleGroup(String)
  Select(String)
  Reroll
  SetPanel(Panel)
  Run(Op)
  TogglePlay
  Delayed(@tutuca.AskResult[Unit])
  SetTarget(String)
  SetMessage(String)
  SetKey(String)
  SetArgs(String)
  GenerateArgs
  Generated(@tutuca.AskResult[String])
  SendIt
  RandomStep
  SetStressNumber(String, String) // "runs", "steps" or "seed", and the text typed.
  SetStressFrom(String)
  SetEvents(Bool)
  StressIt
  LoadCounterexample
  Refresh // The selected story mounted or changed; ask for its summary.
  Got(@tutuca.AskResult[Summary])
} derive(Debug)

// --- shared looks, as JS's ui/common.js --------------------------------------------------------

///|
let card : String = "card border border-base-300 bg-base-100 p-4 shadow-sm flex flex-col gap-3"

///|
let title_class : String = "text-sm font-semibold uppercase tracking-wider text-base-content/60"

///|
fn badge(status : String) -> String {
  match status {
    "ok" => "badge badge-sm badge-success"
    "failed" => "badge badge-sm badge-error"
    "skipped" => "badge badge-sm badge-warning"
    _ => "badge badge-sm badge-ghost"
  }
}

///|
fn origin_icon(origin : String) -> String {
  match origin {
    "initial" => "◆"
    "step" => "▸"
    _ => "☝"
  }
}

// --- the sidebar ---------------------------------------------------------------------------------

///|
fn Storybook::is_collapsed(self : Storybook, link : StoryLink) -> Bool {
  self.filter.trim() == "" && self.collapsed.contains(link.group)
}

///|
/// The links the filter keeps; a collapsed group keeps its header, on its first link.
fn Storybook::shown(self : Storybook) -> Array[StoryLink] {
  let q = self.filter.to_lower()
  self.links.filter(l => {
    l.id.to_lower().contains(q) && (l.show_group || !self.is_collapsed(l))
  })
}

///|
fn link_view() -> ViewAt[Item[Storybook, StoryLink], Storybook, StorybookMsg] {
  li([cls("flex flex-col")], [
    when(
      it => it.value.show_group,
      button(
        [
          attr("type", "button"),
          cls("\{title_class} mt-3 mb-1 flex items-center gap-1 text-left"),
          bind_str("aria-expanded", it => {
            if it.up.is_collapsed(it.value) {
              "false"
            } else {
              "true"
            }
          }),
          on_event(Click, (it, _) => Some(ToggleGroup(it.value.group))),
        ],
        [
          span([cls("w-3")], [
            show(it => if it.up.is_collapsed(it.value) { "▸" } else { "▾" }),
          ]),
          span([cls("flex-1")], [show(it => it.value.group)]),
          span([cls("font-normal opacity-60")], [
            show(it => it.value.group_size.to_string()),
          ]),
        ],
      ),
    ),
    when(
      it => !it.up.is_collapsed(it.value),
      button(
        [
          attr("type", "button"),
          class_(it => {
            if it.up.selected == it.value.id {
              "btn btn-sm btn-primary justify-start font-normal"
            } else {
              "btn btn-sm btn-ghost justify-start font-normal"
            }
          }),
          bind_str("title", it => it.value.id),
          on_event(Click, (it, _) => Some(Select(it.value.id))),
        ],
        [show(it => it.value.name)],
      ),
    ),
  ])
}

///|
fn Storybook::sidebar() -> View[Storybook, StorybookMsg] {
  @tutuca.h(
    "aside",
    [
      cls(
        "flex flex-col gap-3 border-r border-base-300 bg-base-100 p-4 md:overflow-y-auto",
      ),
    ],
    [
      h1([cls("text-lg font-bold")], [txt("Tutuca Storybook")]),
      input([
        cls("input input-sm input-bordered w-full"),
        attr("placeholder", "Filter stories…"),
        aria("label", "Filter stories"),
        value(s => s.filter),
        on_input(v => SetFilter(v)),
      ]),
      ul([cls("flex flex-col gap-1")], [
        each(s => s.shown().iter(), link_view(), key=(l, _) => l.id),
      ]),
    ],
  )
}

// --- the steps panel, as JS's StoryPanel ---------------------------------------------------------

///|
fn Storybook::sequences(self : Storybook) -> Array[String] {
  self.summary.map(sm => sm.sequences).unwrap_or([])
}

///|
fn Storybook::steps(self : Storybook) -> Array[StepView] {
  self.summary.map(sm => sm.steps).unwrap_or([])
}

///|
fn Storybook::timeline(self : Storybook) -> Array[EntryView] {
  self.summary.map(sm => sm.timeline).unwrap_or([])
}

///|
fn Storybook::targets(self : Storybook) -> Array[TargetView] {
  self.summary.map(sm => sm.targets).unwrap_or([])
}

///|
fn Storybook::messages(self : Storybook) -> Array[String] {
  self
  .targets()
  .get(self.form.target)
  .map(t => t.messages.map(m => m.name))
  .unwrap_or([])
}

///|
fn Storybook::keys(self : Storybook) -> Array[String] {
  self
  .targets()
  .get(self.form.target)
  .bind(t => t.messages.iter().find_first(m => m.name == self.form.message))
  .map(m => m.keys)
  .unwrap_or([])
}

///|
/// What went wrong: the UI's own error, else the current entry's problems.
fn Storybook::problems(self : Storybook) -> Array[String] {
  if self.error != "" {
    [self.error]
  } else {
    self.summary.map(sm => sm.problems).unwrap_or([])
  }
}

///|
/// The state as JS shows it: its JSON, the component's name first as `$`.
fn Storybook::state_json(self : Storybook) -> String {
  match self.summary {
    Some(sm) => @dev.snapshot(sm.spec, sm.state, sm.specs).stringify(indent=2)
    None => ""
  }
}

///|
fn Storybook::at_end(self : Storybook) -> Bool {
  match self.summary {
    Some(sm) =>
      sm.cursor >= sm.timeline.length() - 1 &&
      !sm.steps.iter().any(s => s.is_next)
    None => true
  }
}

///|
/// The form with its choices among the current targets and their messages.
fn Storybook::synced(self : Storybook) -> Storybook {
  let targets = self.targets()
  let target = if self.form.target >= targets.length() {
    0
  } else {
    self.form.target
  }
  let t = targets.get(target)
  let messages = t.map(t => t.messages).unwrap_or([])
  let message = if messages.iter().any(m => m.name == self.form.message) {
    self.form.message
  } else {
    messages.get(0).map(m => m.name).unwrap_or("")
  }
  let keys = messages
    .iter()
    .find_first(m => m.name == message)
    .map(m => m.keys)
    .unwrap_or([])
  let key = if keys.contains(self.form.key) {
    self.form.key
  } else {
    keys.get(0).unwrap_or("")
  }
  { ..self, form: { ..self.form, target, message, key, }, }
}

///|
fn small(
  classes : String,
  title : String,
  msg : StorybookMsg,
  text : String,
) -> View[Storybook, StorybookMsg] {
  button([cls(classes), attr("title", title), on_click(msg)], [txt(text)])
}

///|
fn Storybook::steps_panel() -> View[Storybook, StorybookMsg] {
  div([cls("grid gap-4 xl:grid-cols-2")], [
    section([cls(card)], [
      div([cls("flex flex-wrap items-center gap-2")], [
        select(
          [
            cls("select select-sm select-bordered"),
            aria("label", "Sequence"),
            value(s => s.summary.map(sm => sm.sequence).unwrap_or("")),
            on_change(v => Run(Load(v))),
          ],
          [
            option([attr("value", "")], [txt("(no sequence)")]),
            each(
              s => s.sequences().iter(),
              option([bind_str("value", it => it.value)], [show(it => it.value)]),
            ),
          ],
        ),
        div([cls("join")], [
          small("btn btn-sm join-item", "Reset", Run(Reset), "⏮"),
          small("btn btn-sm join-item", "Back", Run(Back), "◀"),
          small("btn btn-sm join-item", "Step", Run(Forward), "▶"),
          small("btn btn-sm join-item", "Run to end", Run(ToEnd), "⏭"),
        ]),
        button(
          [
            class_(s => {
              if s.form.is_playing {
                "btn btn-sm btn-warning"
              } else {
                "btn btn-sm btn-primary"
              }
            }),
            on_click(TogglePlay),
          ],
          [show(s => if s.form.is_playing { "Pause" } else { "Play" })],
        ),
      ]),
      h3([cls(title_class)], [txt("Steps")]),
      ol([cls("flex flex-col gap-1 text-sm")], [
        each(
          s => s.steps().iter(),
          li(
            [
              class_(it => {
                if it.value.is_next {
                  "flex items-center gap-2 rounded bg-base-200 px-2 py-1 font-semibold"
                } else {
                  "flex items-center gap-2 px-2 py-1"
                }
              }),
            ],
            [
              span([class_(it => badge(it.value.status))], [
                show(it => it.value.status),
              ]),
              span([cls("min-w-0 break-all font-mono text-xs")], [
                show(it => it.value.label),
              ]),
            ],
          ),
        ),
      ]),
      when(
        s => s.problems().length() > 0,
        ul(
          [
            cls("flex flex-col gap-1 rounded bg-error/10 p-2"),
            attr("role", "alert"),
          ],
          [
            each(
              s => s.problems().iter(),
              li([cls("whitespace-pre-wrap font-mono text-xs text-error")], [
                show(it => it.value),
              ]),
            ),
          ],
        ),
      ),
      h3([cls(title_class)], [txt("Send a message")]),
      div([cls("flex flex-wrap items-end gap-2")], [
        select(
          [
            cls("select select-sm select-bordered max-w-full"),
            aria("label", "Target component"),
            value(s => s.form.target.to_string()),
            on_change(v => SetTarget(v)),
          ],
          [
            each(
              s => s.targets().iter(),
              option([bind_str("value", it => it.index.to_string())], [
                show(it => it.value.name),
              ]),
            ),
          ],
        ),
        select(
          [
            cls("select select-sm select-bordered"),
            aria("label", "Message"),
            value(s => s.form.message),
            on_change(v => SetMessage(v)),
          ],
          [
            each(
              s => s.messages().iter(),
              option([bind_str("value", it => it.value)], [show(it => it.value)]),
            ),
          ],
        ),
        when(
          s => s.keys().length() > 0,
          select(
            [
              cls("select select-sm select-bordered"),
              aria("label", "Source key"),
              value(s => s.form.key),
              on_change(v => SetKey(v)),
            ],
            [
              each(
                s => s.keys().iter(),
                option([bind_str("value", it => it.value)], [
                  show(it => it.value),
                ]),
              ),
            ],
          ),
        ),
        input([
          cls("input input-sm input-bordered min-w-40 flex-1 font-mono"),
          aria("label", "Arguments as a JSON array"),
          value(s => s.form.args),
          on_input(v => SetArgs(v)),
        ]),
      ]),
      div([cls("flex flex-wrap gap-2")], [
        button([cls("btn btn-sm"), on_click(GenerateArgs)], [
          txt("Generate args"),
        ]),
        button([cls("btn btn-sm btn-primary"), on_click(SendIt)], [txt("Send")]),
        button([cls("btn btn-sm btn-secondary"), on_click(RandomStep)], [
          txt("Random step"),
        ]),
      ]),
    ]),
    div([cls("flex min-w-0 flex-col gap-4")], [
      section([cls(card)], [
        h3([cls(title_class)], [txt("Timeline")]),
        ol([cls("flex max-h-64 flex-col gap-1 overflow-auto")], [
          each(
            s => s.timeline().iter(),
            li([], [
              button(
                [
                  attr("type", "button"),
                  class_(it => {
                    if it.value.is_current {
                      "btn btn-xs btn-primary w-full justify-start font-normal"
                    } else {
                      "btn btn-xs btn-ghost w-full justify-start font-normal"
                    }
                  }),
                  on_event(Click, (it, _) => Some(Run(Goto(it.index)))),
                ],
                [
                  show(it => origin_icon(it.value.origin)),
                  span([cls("min-w-0 flex-1 truncate text-left font-mono")], [
                    show(it => it.value.label),
                  ]),
                  when(
                    it => it.value.problem_count > 0,
                    span([cls("badge badge-xs badge-error")], [
                      show(it => it.value.problem_count.to_string()),
                    ]),
                  ),
                ],
              ),
            ]),
          ),
        ]),
      ]),
      section([cls(card)], [
        h3([cls(title_class)], [txt("State")]),
        pre([cls("max-h-96 overflow-auto rounded bg-base-200 p-3 text-xs")], [
          show(s => s.state_json()),
        ]),
      ]),
    ]),
  ])
}

// --- the stress panel, as JS's StressPanel ---------------------------------------------------------

///|
fn Storybook::stress_status(self : Storybook) -> StressResult {
  match self.summary.bind(sm => sm.stress) {
    Some(r) => r
    None => { status: "idle", runs: 0, done: 0, error: "", steps: [], }
  }
}

///|
fn number_field(
  text : String,
  name : String,
  get : (StressForm) -> Int32,
) -> View[Storybook, StorybookMsg] {
  label([cls("flex flex-col gap-1 text-xs")], [
    txt(text),
    input([
      attr("type", "number"),
      cls("input input-sm input-bordered"),
      value(s => get(s.stress).to_string()),
      on_input(v => SetStressNumber(name, v)),
    ]),
  ])
}

///|
fn from_name(from : StressFrom) -> String {
  match from {
    FromStory => "story"
    FromGenerated => "generated"
    FromCurrent => "current"
  }
}

///|
fn Storybook::stress_panel() -> View[Storybook, StorybookMsg] {
  section([cls(card)], [
    div([cls("grid grid-cols-2 gap-3 sm:grid-cols-5")], [
      number_field("Runs", "runs", f => f.runs),
      number_field("Max steps per run", "steps", f => f.steps),
      number_field("Seed", "seed", f => f.seed),
      label([cls("flex flex-col gap-1 text-xs")], [
        txt("Start from"),
        select(
          [
            cls("select select-sm select-bordered"),
            value(s => from_name(s.stress.from)),
            on_change(v => SetStressFrom(v)),
          ],
          [
            option([attr("value", "story")], [txt("story state")]),
            option([attr("value", "generated")], [txt("generated states")]),
            option([attr("value", "current")], [txt("current state")]),
          ],
        ),
      ]),
      label([cls("flex items-center gap-2 self-end pb-2 text-xs")], [
        input([
          attr("type", "checkbox"),
          cls("checkbox checkbox-sm"),
          checked(s => s.stress.events),
          on_check(b => SetEvents(b)),
        ]),
        txt("DOM events"),
      ]),
    ]),
    div([cls("flex flex-wrap items-center gap-3")], [
      button(
        [
          cls("btn btn-sm btn-primary"),
          bind("disabled", s => Bool(s.stress_status().status == "running")),
          on_click(StressIt),
        ],
        [txt("Run stress test")],
      ),
      when(
        s => s.stress_status().status == "running",
        button([cls("btn btn-sm"), on_click(Run(StressCancel))], [txt("Cancel")]),
      ),
      span([cls("badge")], [show(s => s.stress_status().status)]),
      span([cls("text-xs text-base-content/60")], [
        show(s => s.stress_status().done.to_string()),
        txt(" / "),
        show(s => s.stress_status().runs.to_string()),
        txt(" runs"),
      ]),
    ]),
    @tutuca.h(
      "progress",
      [
        cls("progress progress-primary w-full"),
        bind("value", s => Num(s.stress_status().done.to_double())),
        bind("max", s => {
          let total = s.stress_status().runs
          Num((if total > 1 { total } else { 1 }).to_double())
        }),
      ],
      [],
    ),
    when(
      s => s.stress_status().error != "",
      pre(
        [cls("whitespace-pre-wrap rounded bg-error/10 p-3 text-xs text-error")],
        [show(s => s.stress_status().error)],
      ),
    ),
    when(
      s => s.stress_status().status == "failed",
      div([cls("flex flex-col gap-2")], [
        h3([cls(title_class)], [txt("Shrunk counterexample")]),
        ol([cls("list-decimal pl-6 font-mono text-xs")], [
          each(
            s => s.stress_status().steps.iter(),
            li([], [show(it => it.value)]),
          ),
        ]),
        button(
          [
            cls("btn btn-sm btn-secondary self-start"),
            on_click(LoadCounterexample),
          ],
          [txt("Load into stepper")],
        ),
      ]),
    ),
  ])
}

// --- the page --------------------------------------------------------------------------------

///|
fn tab(
  text : String,
  panel : Panel,
  title? : String,
) -> View[Storybook, StorybookMsg] {
  ignore(title)
  button(
    [
      attr("type", "button"),
      attr("role", "tab"),
      class_(s => if s.panel == panel { "tab tab-active" } else { "tab" }),
      on_click(SetPanel(panel)),
    ],
    [txt(text)],
  )
}

///|
fn Storybook::story() -> View[Storybook, StorybookMsg] {
  div([cls("flex flex-col gap-4")], [
    div([cls("flex flex-wrap items-center gap-3")], [
      h2([cls("text-xl font-bold")], [show(s => s.selected)]),
      when(
        s => s.is_generated,
        div([cls("flex items-center gap-2")], [
          span([cls("badge badge-outline")], [
            txt("seed "),
            show(s => s.seed.to_string()),
          ]),
          button([cls("btn btn-sm"), on_click(Reroll)], [txt("Reroll")]),
        ]),
      ),
    ]),
    section([cls("card border border-base-300 bg-base-100 p-4 shadow-sm")], [
      @tutuca.h(
        "tutuca-app",
        [cls("block"), bind_str("app-key", s => s.app_key())],
        [],
      ),
    ]),
    div([attr("role", "tablist"), cls("tabs tabs-box self-start")], [
      tab("Steps", Steps),
      tab("Stress test", Stress),
      tab("Dev", Dev),
    ]),
    if_(
      s => s.panel is Steps,
      Storybook::steps_panel(),
      if_(
        s => s.panel is Stress,
        Storybook::stress_panel(),
        @tutuca.render(dev_lens, @dev.dev_panel),
      ),
    ),
  ])
}

///|
fn Storybook::view() -> View[Storybook, StorybookMsg] {
  div(
    [
      cls(
        "grid min-h-screen grid-cols-1 bg-base-200 text-base-content md:h-screen md:grid-cols-[16rem_1fr] md:overflow-hidden",
      ),
    ],
    [
      Storybook::sidebar(),
      main_(
        [
          cls("flex min-w-0 flex-col gap-4 p-4 md:overflow-y-auto"),
          attr("data-story-main", ""),
        ],
        [
          if_(
            s => s.selected != "",
            Storybook::story(),
            p([cls("text-base-content/60")], [txt("Pick a story.")]),
          ),
        ],
      ),
    ],
  )
}

// --- what it does ------------------------------------------------------------------------------

///|
fn ask(
  s : Storybook,
  op : Op,
  ctx : @tutuca.Ctx[Storybook, StorybookMsg],
) -> Storybook {
  if s.selected != "" {
    ctx.ask(story_op, (s.selected, op), r => Some(Got(r)))
  }
  s
}

///|
/// The story's panels, new for the app the UI shows now.
fn Storybook::reset_panels(self : Storybook) -> Storybook {
  {
    ..self,
    summary: None,
    error: "",
    form: new_form,
    stress: new_stress,
    dev: @dev.DevPanel::new(),
  }
}

///|
/// A task of an entry, as the dev panel shows it.
fn task_node(t : TaskView) -> @dev.Inspected {
  let message = t.message()
  let name = match message.find("(") {
    Some(i) => message.view(end_offset=i).to_owned()
    None => message
  }
  match t.kind {
    Notify =>
      match t.label.find(" from ") {
        Some(i) =>
          @dev.Inspected::message(
            Notify,
            t.label.view(end_offset=i).to_owned(),
            [],
            t.path,
          )
        None => @dev.Inspected::message(Notify, t.label, [], t.path)
      }
    kind => @dev.Inspected::message(kind, @dev.js_name(name), [], t.path)
  }
}

///|
fn parse_int(text : String) -> Int32? {
  Some(@string.parse_int(text.trim())) catch {
    _ => None
  }
}

///|
fn Storybook::update(
  self : Storybook,
  msg : StorybookMsg,
  ctx : @tutuca.Ctx[Storybook, StorybookMsg],
) -> Storybook {
  match msg {
    SetFilter(filter) => { ..self, filter, }
    ToggleGroup(group) =>
      if self.collapsed.contains(group) {
        { ..self, collapsed: self.collapsed.filter(g => g != group), }
      } else {
        { ..self, collapsed: [..self.collapsed, group], }
      }
    Select(id) => {
      guard self.links.iter().find_first(l => l.id == id) is Some(link) else {
        return self
      }
      // Shows the new story from its top, wherever the list was scrolled to.
      ctx.ask(scroll_to_top, (), _ => None)
      { ..self, selected: id, is_generated: link.is_generated, }.reset_panels()
    }
    Reroll => { ..self, seed: self.seed + 1, }.reset_panels()
    SetPanel(panel) => { ..self, panel, }
    Run(op) => ask(self, op, ctx)
    TogglePlay => {
      let is_playing = !self.form.is_playing
      if is_playing {
        ctx.ask(delay, 400, r => Some(Delayed(r)))
      }
      { ..self, form: { ..self.form, is_playing, }, }
    }
    Delayed(Ok(_)) =>
      if !self.form.is_playing {
        self
      } else if self.at_end() {
        { ..self, form: { ..self.form, is_playing: false, }, }
      } else {
        ctx.ask(delay, 400, r => Some(Delayed(r)))
        ask(self, Forward, ctx)
      }
    Delayed(_) => { ..self, form: { ..self.form, is_playing: false, }, }
    SetTarget(text) =>
      { ..self, form: { ..self.form, target: parse_int(text).unwrap_or(0), }, }.synced()
    SetMessage(message) => { ..self, form: { ..self.form, message, }, }.synced()
    SetKey(key) => { ..self, form: { ..self.form, key, }, }
    SetArgs(args) => { ..self, form: { ..self.form, args, }, }
    GenerateArgs => {
      let f = self.form
      ctx.ask(
        story_sample_args,
        (self.selected, f.target, f.message, f.arg_seed.to_uint64()),
        r => Some(Generated(r)),
      )
      { ..self, form: { ..f, arg_seed: f.arg_seed + 1, }, }
    }
    Generated(Ok(args)) => { ..self, form: { ..self.form, args, }, }
    Generated(Err(e)) => { ..self, error: e, }
    Generated(NotFound) => self
    SendIt => {
      let f = self.form
      ask(self, SendTo(f.target, f.message, f.args, f.key), ctx)
    }
    RandomStep => {
      let f = self.form
      ask(
        { ..self, form: { ..f, arg_seed: f.arg_seed + 1, }, },
        Random(f.arg_seed.to_uint64()),
        ctx,
      )
    }
    SetStressNumber(name, text) =>
      match parse_int(text) {
        Some(n) =>
          match name {
            "runs" if n >= 1 && n <= 100000 =>
              { ..self, stress: { ..self.stress, runs: n, }, }
            "steps" if n >= 1 && n <= 1000 =>
              { ..self, stress: { ..self.stress, steps: n, }, }
            "seed" => { ..self, stress: { ..self.stress, seed: n, }, }
            _ => self
          }
        None => self
      }
    SetStressFrom(name) => {
      let from = match name {
        "current" => FromCurrent
        "generated" => FromGenerated
        _ => FromStory
      }
      { ..self, stress: { ..self.stress, from, }, }
    }
    SetEvents(events) => { ..self, stress: { ..self.stress, events, }, }
    StressIt => {
      if self.stress_status().status == "running" {
        return self
      }
      let f = self.stress
      let seed = f.seed.to_uint64()
      ask(
        self,
        if f.events {
          StressEvents(f.runs, f.steps, seed, f.from)
        } else {
          StressStart(f.runs, f.steps, seed, f.from)
        },
        ctx,
      )
    }
    LoadCounterexample =>
      ask({ ..self, panel: Steps, }, Load("counterexample"), ctx)
    Refresh => ask(self, Show, ctx)
    Got(Ok(summary)) =>
      {
        ..self,
        summary: Some(summary),
        error: "",
        dev: self.dev.updated(
          state=@dev.Inspected::state(
            summary.spec,
            summary.state,
            specs=summary.specs,
          ),
          tasks=summary.tasks.map(t => ("", task_node(t))),
          specs=summary.specs,
          issues=summary.lint,
        ),
      }.synced()
    Got(Err(e)) =>
      { ..self, error: e, form: { ..self.form, is_playing: false, }, }
    Got(NotFound) => { ..self, error: "no story ask handler is registered", }
  }
}

///|
pub let storybook : Component[Storybook, StorybookMsg] = component(
  "Storybook",
  view=Storybook::view,
  update=Storybook::update,
)

///|
/// Asked when a story is picked: the page scrolls the story panel back to its top.
pub let scroll_to_top : @tutuca.Ask[Unit, Unit] = @tutuca.Ask::new(
  "scrollToTop",
)

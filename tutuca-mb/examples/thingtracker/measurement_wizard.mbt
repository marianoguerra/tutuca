// Asks a thing's measurements one at a time when logging it. From
// panels/measurement-wizard.js.

///|
pub(all) struct MeasurementWizard {
  thing_id : String
  emoji : String
  title : String
  prompts : Vec[Prompt] // At least one.
  step : Int32
  confirming : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn MeasurementWizard::new(
  thing_id : String,
  emoji : String,
  title : String,
  prompts : Array[Prompt],
) -> MeasurementWizard {
  {
    thing_id,
    emoji,
    title,
    prompts: Vec::of(prompts),
    step: 0,
    confirming: false,
  }
}

///|
pub(all) enum WizardMsg {
  RequestClose
  Key(String) // A key pressed in the panel.
  KeepEditing
  Discard
  Back
  Next
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by the wizard's last step with the thing's id and the values.
pub let commit_log : Signal[(String, Array[MeasureValue])] = Signal::new(
  "commitLog",
)

///|
pub let prompts_items : Items[MeasurementWizard, Int32, Prompt] = items(
  "prompts",
  s => s.prompts,
  (s, prompts) => { ..s, prompts, },
)

///|
pub fn MeasurementWizard::current(self : MeasurementWizard) -> Prompt? {
  self.prompts.get(self.step)
}

///|
pub fn MeasurementWizard::is_last(self : MeasurementWizard) -> Bool {
  self.step == self.prompts.length() - 1
}

///|
pub fn MeasurementWizard::step_text(self : MeasurementWizard) -> String {
  "\{self.step + 1} of \{self.prompts.length()}"
}

///|
pub fn MeasurementWizard::cannot_go(self : MeasurementWizard) -> Bool {
  !(self.current() is Some(c) && c.base > 0.0)
}

///|
pub fn MeasurementWizard::primary_label(self : MeasurementWizard) -> String {
  if self.is_last() {
    "Log \{self.current().map(c => c.formatted()).unwrap_or("")}"
  } else {
    "Next"
  }
}

///|
fn MeasurementWizard::view() -> View[MeasurementWizard, WizardMsg] {
  panel(
    title=s => "\{s.emoji} \{s.title}",
    description=_ => "",
    extra=when(
      s => s.prompts.length() > 1,
      span([cls("text-xs tabular-nums \{muted}")], [show(s => s.step_text())]),
    ),
    progress=s => {
      let pct = js_round(
        (s.step + 1).to_double() / s.prompts.length().to_double() * 100.0,
      ).to_int()
      "width: \{pct}%"
    },
    body=render_key(prompts_items, s => s.step, prompt_c),
    foot=[
      when(
        s => s.step > 0,
        button([cls("btn btn-outline h-12 shrink-0"), on_click(Back)], [
          txt("← Back"),
        ]),
      ),
      button(
        [
          cls("btn btn-primary h-12 flex-1 text-base"),
          bind("disabled", s => Bool(s.cannot_go())),
          on_click(Next),
        ],
        [show(s => s.primary_label())],
      ),
    ],
    confirm=s => {
      confirming: s.confirming,
      title: "Discard this entry?",
      text: "Nothing has been logged yet.",
      keep: "Keep going",
    },
    close=wizard_of_close,
  )
}

///|
fn MeasurementWizard::update(
  self : MeasurementWizard,
  msg : WizardMsg,
  ctx : Ctx[MeasurementWizard, WizardMsg],
) -> MeasurementWizard {
  match msg {
    RequestClose | Key(_) | KeepEditing | Discard => {
      let m = wizard_close(msg)
      { ..self, confirming: closing(self.confirming, true, m, ctx), }
    }
    Back => if self.step > 0 { { ..self, step: self.step - 1, } } else { self }
    Next => {
      if self.cannot_go() {
        return self
      }
      if !self.is_last() {
        return { ..self, step: self.step + 1, }
      }
      let values = self.prompts
        .iter()
        .map(pr => {
          ({ measurement_id: pr.kind.id(), value: pr.base, } : MeasureValue)
        })
        .to_array()
      ctx.notify(commit_log, (self.thing_id, values))
      self
    }
  }
}

///|
pub let measurement_wizard : Component[MeasurementWizard, WizardMsg] = component(
  "MeasurementWizard",
  children=() => [@tutuca.each_child(prompt_c, prompts_items)],
  fields=[
    @tutuca.field_info("thing_id", Text, initial=""),
    @tutuca.field_info("emoji", Text, initial=""),
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info(
      "prompts",
      ListOf(ComponentOf(["Prompt"])),
      constraints=[MinLength(1)],
      initial=[],
      checks=["it has a prompt"],
    ),
    @tutuca.field_info("step", KeyOf("prompts"), checks=[
      "the step is a prompt's",
    ]),
    @tutuca.field_info("confirming", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages([
    "RequestClose", "Key", "KeepEditing", "Discard", "Back", "Next",
  ]),
  view=MeasurementWizard::view,
  update=MeasurementWizard::update,
  invariants=[
    ("it has a prompt", s => s.prompts.length() >= 1),
    ("the step is a prompt's", s => s.step >= 0 && s.step < s.prompts.length()),
  ],
)

///|
/// The closing message `msg` is, for `closing`.
fn wizard_close(msg : WizardMsg) -> CloseMsg {
  match msg {
    Key(k) => Pressed(k)
    KeepEditing => Keep
    Discard => Drop
    _ => AskClose
  }
}

///|
fn wizard_of_close(c : CloseMsg) -> WizardMsg {
  match c {
    AskClose => RequestClose
    Pressed(k) => Key(k)
    Keep => KeepEditing
    Drop => Discard
  }
}

// Edits a logged event, or one about to be: when it happened, its measurements and notes.
// From panels/event-editor.js.

///|
pub(all) struct EventEditor {
  mode : Mode
  event_id : String
  thing_id : String
  heading : String
  subtitle : String
  recorded_at : Double
  when_ : String // A datetime-local value.
  tz : Int32
  notes : String
  values : Vec[Prompt]
  confirming : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn EventEditor::new(
  mode : Mode,
  event_id~ : String = "",
  thing_id~ : String = "",
  heading~ : String = "Entry",
  subtitle~ : String = "",
  recorded_at~ : Double = 0.0,
  when_~ : String = "",
  tz~ : Int32 = 0,
  notes~ : String = "",
  values~ : Array[Prompt] = [],
) -> EventEditor {
  {
    mode,
    event_id,
    thing_id,
    heading,
    subtitle,
    recorded_at,
    when_,
    tz,
    notes,
    values: Vec::of(values),
    confirming: false,
  }
}

///|
pub(all) enum EventEditorMsg {
  RequestClose
  Key(String) // A key pressed in the panel.
  KeepEditing
  Discard
  SetWhen(String)
  SetNotes(String)
  Save
  Remove
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// An entry the event editor saves: a new one for a thing, or an edit of one.
pub(all) struct EntrySaved {
  mode : Mode
  id : String
  thing_id : String
  recorded_at : Double
  actual_at : Double
  notes : String
  measurements : Array[MeasureValue]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let save_entry : Signal[EntrySaved] = Signal::new("saveEntry")

///|
pub let values_items : Items[EventEditor, Int32, Prompt] = items(
  "values",
  s => s.values,
  (s, values) => { ..s, values, },
)

///|
pub fn EventEditor::actual_at(self : EventEditor) -> Double? {
  from_datetime_local(self.when_, self.tz)
}

///|
pub fn EventEditor::is_invalid(self : EventEditor) -> Bool {
  self.actual_at() is None
}

///|
fn EventEditor::view() -> View[EventEditor, EventEditorMsg] {
  panel(
    title=s => s.heading,
    description=s => s.subtitle,
    body=div([cls("space-y-4")], [
      div([cls("flex flex-col gap-1.5")], [
        label([cls("text-sm font-medium")], [txt("When did it happen?")]),
        input([
          attr("type", "datetime-local"),
          cls("input input-sm w-full"),
          aria("label", "When did it happen?"),
          bind_str("aria-invalid", s => s.is_invalid().to_string()),
          value(s => s.when_),
          on_input(v => SetWhen(v)),
        ]),
        when(
          s => s.is_invalid(),
          p([cls("text-xs text-error")], [txt("That isn't a valid time.")]),
        ),
      ]),
      render_each(values_items, prompt_c, view="field"),
      div([cls("flex flex-col gap-1.5")], [
        label([cls("text-sm font-medium")], [txt("Notes (optional)")]),
        textarea([
          cls("textarea w-full"),
          attr("rows", "3"),
          aria("label", "Notes"),
          attr("placeholder", "Anything worth remembering about this one?"),
          value(s => s.notes),
          on_input(v => SetNotes(v)),
        ]),
      ]),
    ]),
    foot=[
      when(
        s => s.mode is Edit,
        button(
          [cls("btn btn-outline h-12 shrink-0 text-error"), on_click(Remove)],
          [txt("Delete")],
        ),
      ),
      button(
        [
          cls("btn btn-primary h-12 flex-1 text-base"),
          bind("disabled", s => Bool(s.is_invalid())),
          on_click(Save),
        ],
        [show(s => if s.mode is Edit { "Save" } else { "Log entry" })],
      ),
    ],
    confirm=s => {
      confirming: s.confirming,
      title: if s.mode is Edit {
        "Discard changes?"
      } else {
        "Discard this entry?"
      },
      text: if s.mode is Edit {
        "Your edits won't be saved."
      } else {
        "Nothing has been logged yet."
      },
      keep: "Keep editing",
    },
    close=editor_of_close,
  )
}

///|
fn EventEditor::update(
  self : EventEditor,
  msg : EventEditorMsg,
  ctx : Ctx[EventEditor, EventEditorMsg],
) -> EventEditor {
  match msg {
    RequestClose | Key(_) | KeepEditing | Discard => {
      let m = editor_close(msg)
      { ..self, confirming: closing(self.confirming, true, m, ctx), }
    }
    SetWhen(when_) => { ..self, when_, }
    SetNotes(notes) => { ..self, notes, }
    Save => {
      if self.actual_at() is Some(actual_at) {
        let measurements = self.values
          .iter()
          .filter(v => v.base > 0.0)
          .map(v => {
            ({ measurement_id: v.kind.id(), value: v.base, } : MeasureValue)
          })
          .to_array()
        ctx.notify(save_entry, {
          mode: self.mode,
          id: self.event_id,
          thing_id: self.thing_id,
          recorded_at: self.recorded_at,
          actual_at,
          notes: self.notes,
          measurements,
        })
      }
      self
    }
    Remove => {
      ctx.notify(delete_entry, self.event_id)
      self
    }
  }
}

///|
pub let event_editor : Component[EventEditor, EventEditorMsg] = component(
  "EventEditor",
  children=() => [@tutuca.each_child(prompt_c, values_items)],
  fields=[
    @tutuca.field_info("mode", OneOf(["create", "edit"]), initial="create"),
    @tutuca.field_info("event_id", Text, initial=""),
    @tutuca.field_info("thing_id", Text, initial=""),
    @tutuca.field_info("heading", Text, initial="Entry"),
    @tutuca.field_info("subtitle", Text, initial=""),
    @tutuca.field_info("recorded_at", Whole, initial=0),
    @tutuca.field_info("when_", Text, initial=""),
    @tutuca.field_info(
      "tz",
      Whole,
      constraints=[AtLeast(-840), AtMost(840)],
      initial=0,
      checks=["the time zone is -840 to 840"],
    ),
    @tutuca.field_info("notes", Text, initial=""),
    @tutuca.field_info("values", ListOf(ComponentOf(["Prompt"])), initial=[]),
    @tutuca.field_info("confirming", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages([
    "RequestClose", "Key", "KeepEditing", "Discard", "SetWhen", "SetNotes", "Save",
    "Remove",
  ]),
  view=EventEditor::view,
  update=EventEditor::update,
  invariants=[
    ("the time zone is -840 to 840", s => s.tz >= -840 && s.tz <= 840),
  ],
)

///|
/// The closing message `msg` is, for `closing`.
fn editor_close(msg : EventEditorMsg) -> CloseMsg {
  match msg {
    Key(k) => Pressed(k)
    KeepEditing => Keep
    Discard => Drop
    _ => AskClose
  }
}

///|
fn editor_of_close(c : CloseMsg) -> EventEditorMsg {
  match c {
    AskClose => RequestClose
    Pressed(k) => Key(k)
    Keep => KeepEditing
    Drop => Discard
  }
}

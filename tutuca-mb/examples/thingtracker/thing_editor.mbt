// Creates or edits a thing in steps: name and emoji, what to record, notes. From
// panels/thing-editor.js.

///|
let steps_names : Array[String] = ["Name & emoji", "What to record", "Notes"]

///|
pub(all) struct ThingEditor {
  mode : Mode
  thing_id : String
  step : Int32 // 0 to 2.
  emoji : String
  title : String
  description : String
  measurements : Vec[MeasureRef]
  picker_open : Bool
  picker : EmojiPicker
  clash : String // Why the emoji may be hard to tell apart, if it may.
  confirming : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub fn ThingEditor::new(
  mode : Mode,
  thing_id~ : String = "",
  emoji~ : String = "⭐",
  title~ : String = "",
  description~ : String = "",
  measurements~ : Array[MeasureRef] = [],
  picker_open~ : Bool = false,
  clash~ : String = "",
) -> ThingEditor {
  {
    mode,
    thing_id,
    step: 0,
    emoji,
    title,
    description,
    measurements: Vec::of(measurements),
    picker_open,
    picker: EmojiPicker::new(),
    clash,
    confirming: false,
  }
}

///|
pub(all) enum ThingEditorMsg {
  RequestClose
  Key(String) // A key pressed in the panel.
  KeepEditing
  Discard
  TogglePicker
  SetTitle(String)
  SetDescription(String)
  ToggleMeasurement(MeasureKind)
  SetUnit(String) // "<measurement id>|<unit id>", as the unit chip's value.
  Back
  Next
  Remove
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// What the thing editor saves.
pub(all) struct ThingFields {
  id : String
  emoji : String
  title : String
  description : String
  measurements : Array[MeasureRef]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let save_thing : Signal[(Mode, ThingFields)] = Signal::new("saveThing")

///|
pub let delete_thing : Signal[String] = Signal::new("deleteThing")

///|
pub let thing_picker_lens : Lens[ThingEditor, EmojiPicker] = field(
  "picker",
  s => s.picker,
  (s, picker) => { ..s, picker, },
)

///|
pub fn ThingEditor::cannot_go(self : ThingEditor) -> Bool {
  self.step == 0 && (trim(self.title) == "" || self.emoji == "")
}

///|
pub fn ThingEditor::primary_label(self : ThingEditor) -> String {
  if self.step < 2 {
    "Next"
  } else if self.mode is Edit {
    "Save"
  } else {
    "Create"
  }
}

///|
priv struct UnitOption {
  kind : MeasureKind
  id : String
  label : String
  cls : String
}

///|
priv struct Choice {
  kind : MeasureKind
  id : String
  label : String
  checked : Bool
  show_units : Bool
  units : Array[UnitOption]
}

///|
/// Every measurement, by name, ticked when the thing records it.
fn ThingEditor::choices(self : ThingEditor) -> Array[Choice] {
  sorted_by(measurements, (a, b) => locale_compare(a.name, b.name)).map(m => {
    let ref_ = self.measurements.iter().find_first(r => r.kind == m.kind)
    {
      kind: m.kind,
      id: m.id,
      label: "\{m.emoji} \{m.name}",
      checked: ref_ is Some(_),
      show_units: ref_ is Some(_) && m.units.length() > 1,
      units: m.units.map(u => {
        kind: m.kind,
        id: u.id,
        label: u.label,
        cls: if ref_.map(r => r.unit) == Some(u.id) {
          "rounded-full border border-transparent bg-primary px-2 py-0.5 text-[0.6875rem] font-medium text-primary-content"
        } else {
          "rounded-full border border-base-300 px-2 py-0.5 text-[0.6875rem] font-medium \{muted}"
        },
      }),
    }
  })
}

///|
fn ThingEditor::view() -> View[ThingEditor, ThingEditorMsg] {
  panel(
    title=s => if s.mode is Edit { "Edit thing" } else { "New thing" },
    description=s => steps_names.get(s.step).unwrap_or(""),
    extra=span([cls("text-xs tabular-nums \{muted}")], [
      show(s => "\{s.step + 1} of 3"),
    ]),
    progress=s => {
      "width: \{js_round((s.step + 1).to_double() / 3.0 * 100.0).to_int()}%"
    },
    body=div([], [
      when(
        s => s.step == 0,
        div([cls("flex flex-col gap-3")], [
          div([cls("flex items-start gap-3")], [
            div([cls("flex flex-col gap-1.5")], [
              label([cls("text-sm font-medium")], [txt("Emoji")]),
              button(
                [
                  cls(
                    "emoji flex size-14 items-center justify-center rounded-xl border border-base-300 text-3xl",
                  ),
                  aria("label", "Choose an emoji"),
                  on_click(TogglePicker),
                ],
                [show(s => s.emoji)],
              ),
            ]),
            div([cls("flex flex-1 flex-col gap-1.5")], [
              label([cls("text-sm font-medium")], [txt("Name")]),
              input([
                cls("input h-14 w-full text-base"),
                attr("placeholder", "Coffee"),
                attr("enterkeyhint", "done"),
                aria("label", "Name"),
                value(s => s.title),
                on_input(v => SetTitle(v)),
              ]),
            ]),
          ]),
          when(
            s => s.clash != "",
            p([cls("text-xs \{muted}")], [show(s => s.clash)]),
          ),
          when(s => s.picker_open, render(thing_picker_lens, emoji_picker)),
        ]),
      ),
      when(
        s => s.step == 1,
        div([cls("flex flex-col gap-2")], [
          label([cls("text-sm font-medium")], [
            txt("Record a value when logging"),
          ]),
          p([cls("text-xs \{muted}")], [
            txt(
              "Leave all unticked and one tap logs it outright. Tick any and tapping asks for them first, pre-filled with last time's.",
            ),
          ]),
          ul([cls("flex flex-col")], [
            each(
              s => s.choices().iter(),
              li([cls("flex flex-col")], [
                label([cls("flex items-center gap-3 py-2 text-sm")], [
                  input([
                    attr("type", "checkbox"),
                    cls("checkbox checkbox-sm"),
                    checked(it => it.value.checked),
                    bind_str("value", it => it.value.id),
                    on_event(Change, (it, _) => {
                      Some(ToggleMeasurement(it.value.kind))
                    }),
                  ]),
                  show(it => it.value.label),
                ]),
                when(
                  it => it.value.show_units,
                  div([cls("flex flex-wrap gap-1 pb-1.5 pl-9")], [
                    each(
                      it => it.value.units.iter(),
                      button(
                        [
                          class_(u => u.value.cls),
                          bind_str("value", u => {
                            "\{u.value.kind.id()}|\{u.value.id}"
                          }),
                          on_event(Click, (u, _) => {
                            Some(SetUnit("\{u.value.kind.id()}|\{u.value.id}"))
                          }),
                        ],
                        [show(u => u.value.label)],
                      ),
                    ),
                  ]),
                ),
              ]),
            ),
          ]),
        ]),
      ),
      when(
        s => s.step == 2,
        div([cls("flex flex-col gap-1.5")], [
          label([cls("text-sm font-medium")], [txt("Notes (optional)")]),
          textarea([
            cls("textarea w-full"),
            attr("rows", "3"),
            aria("label", "Notes"),
            attr("placeholder", "What counts as one of these?"),
            value(s => s.description),
            on_input(v => SetDescription(v)),
          ]),
        ]),
      ),
    ]),
    foot=[
      when(
        s => s.mode is Edit,
        button(
          [
            cls("btn btn-outline btn-square size-12 text-error"),
            bind_str("aria-label", s => "Delete \{s.title}"),
            on_click(Remove),
          ],
          [txt("🗑")],
        ),
      ),
      when(
        s => s.step > 0,
        button([cls("btn btn-outline h-12"), on_click(Back)], [txt("Back")]),
      ),
      button(
        [
          cls("btn btn-primary h-12 flex-1"),
          bind("disabled", s => Bool(s.cannot_go())),
          on_click(Next),
        ],
        [show(s => s.primary_label())],
      ),
    ],
    confirm=s => {
      confirming: s.confirming,
      title: if s.mode is Edit {
        "Discard changes?"
      } else {
        "Discard this thing?"
      },
      text: "Nothing has been saved yet.",
      keep: "Keep editing",
    },
    close=thing_editor_of_close,
  )
}

///|
fn ThingEditor::update(
  self : ThingEditor,
  msg : ThingEditorMsg,
  ctx : Ctx[ThingEditor, ThingEditorMsg],
) -> ThingEditor {
  match msg {
    RequestClose | Key(_) | KeepEditing | Discard => {
      let m = thing_editor_close(msg)
      { ..self, confirming: closing(self.confirming, true, m, ctx), }
    }
    TogglePicker => { ..self, picker_open: !self.picker_open, }
    SetTitle(title) => { ..self, title, }
    SetDescription(description) => { ..self, description, }
    ToggleMeasurement(kind) =>
      match self.measurements.find_index(r => r.kind == kind) {
        Some(i) => { ..self, measurements: self.measurements.remove(i), }
        None =>
          {
            ..self,
            measurements: self.measurements.push({
              kind,
              unit: kind.measurement().default_unit,
            }),
          }
      }
    SetUnit(value) => {
      let (id, unit) = match value.find("|") {
        Some(i) =>
          (
            value.view(end_offset=i).to_owned(),
            value.view(start_offset=i + 1).to_owned(),
          )
        None => (value, "")
      }
      match MeasureKind::from_id(id) {
        Some(kind) =>
          match self.measurements.find_index(r => r.kind == kind) {
            Some(i) if kind.measurement().find_unit(unit) is Some(_) =>
              {
                ..self,
                measurements: self.measurements.set(i, { kind, unit, }),
              }
            _ => self
          }
        None => self
      }
    }
    Back => if self.step > 0 { { ..self, step: self.step - 1, } } else { self }
    Next => {
      if self.cannot_go() {
        return self
      }
      if self.step < 2 {
        return { ..self, step: self.step + 1, picker_open: false, }
      }
      ctx.notify(
        save_thing,
        (
          self.mode,
          {
            id: self.thing_id,
            emoji: self.emoji,
            title: trim(self.title),
            description: trim(self.description),
            measurements: self.measurements.to_array(),
          },
        ),
      )
      self
    }
    Remove => {
      ctx.notify(delete_thing, self.thing_id)
      self
    }
  }
}

///|
pub let thing_editor : Component[ThingEditor, ThingEditorMsg] = component(
  "ThingEditor",
  children=() => [@tutuca.child(emoji_picker, thing_picker_lens)],
  fields=[
    @tutuca.field_info("mode", OneOf(["create", "edit"]), initial="create"),
    @tutuca.field_info("thing_id", Text, initial=""),
    @tutuca.field_info(
      "step",
      Whole,
      constraints=[AtLeast(0), AtMost(2)],
      initial=0,
      checks=["the step is 0 to 2"],
    ),
    @tutuca.field_info("emoji", Text, initial="⭐"),
    @tutuca.field_info("title", Text, initial=""),
    @tutuca.field_info("description", Text, initial=""),
    @tutuca.field_info(
      "measurements",
      ListOf(RecordOf([("measurement_id", Text), ("unit", Text)])),
      initial=[],
    ),
    @tutuca.field_info("picker_open", Boolean, initial=false),
    @tutuca.field_info("picker", ComponentOf(["EmojiPicker"])),
    @tutuca.field_info("clash", Text, initial=""),
    @tutuca.field_info("confirming", Boolean, initial=false),
  ],
  messages=@tutuca.json_messages(
    [
      "RequestClose", "Key", "KeepEditing", "Discard", "TogglePicker", "emojiPicked",
      "SetTitle", "SetDescription", "ToggleMeasurement", "SetUnit", "Back", "Next",
      "Remove",
    ],
    heard=[@tutuca.heard(emoji_picked)],
  ),
  view=ThingEditor::view,
  update=ThingEditor::update,
  on=[
    emoji_picked.on((s, glyph, ctx) => {
      ctx.stop()
      { ..s, emoji: glyph, picker_open: false, }
    }),
  ],
  invariants=[("the step is 0 to 2", s => s.step >= 0 && s.step <= 2)],
)

///|
/// The closing message `msg` is, for `closing`.
fn thing_editor_close(msg : ThingEditorMsg) -> CloseMsg {
  match msg {
    Key(k) => Pressed(k)
    KeepEditing => Keep
    Discard => Drop
    _ => AskClose
  }
}

///|
fn thing_editor_of_close(c : CloseMsg) -> ThingEditorMsg {
  match c {
    AskClose => RequestClose
    Pressed(k) => Key(k)
    Keep => KeepEditing
    Drop => Discard
  }
}

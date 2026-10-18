// The value of one measurement, as the measurement wizard asks it (main) or as the event
// editor shows it (field). From prompt.js.

///|
let chip : String = "rounded-full border px-3 py-1.5 text-xs font-medium"

///|
let unit_btn : String = "rounded px-2 py-1 text-xs font-medium"

///|
let adjust_class : String = "flex min-h-12 items-center justify-center gap-1 rounded-xl border border-base-300 text-sm font-medium tabular-nums disabled:opacity-40"

///|
pub(all) struct Prompt {
  kind : MeasureKind
  unit_id : String
  base : Double // In the measurement's base unit.
  text : String // What the input shows, in the unit.
  history : Vec[Double]
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS keeps a prompt: its measurement by id.
pub impl ToJson for Prompt with fn to_json(self) {
  {
    "measurement_id": ToJson::to_json(self.kind),
    "unit_id": Json::string(self.unit_id),
    "base": Json::number(self.base),
    "text": Json::string(self.text),
    "history": self.history.to_json(),
  }
}

///|
pub impl FromJson for Prompt with fn from_json(json, path) {
  guard json is Object(m) else {
    raise @json.JsonDecodeError((path, "a prompt"))
  }
  let get = (k : String) => m.get(k).unwrap_or(Json::null())
  {
    kind: @json.from_json(get("measurement_id"), path~),
    unit_id: @json.from_json(get("unit_id"), path~),
    base: @json.from_json(get("base"), path~),
    text: @json.from_json(get("text"), path~),
    history: @json.from_json(get("history"), path~),
  }
}

///|
pub(all) enum PromptMsg {
  SetText(String)
  SetUnit(String) // Shows the same value in another unit.
  SetBase(String) // A base value, as the chip's value text.
  Adjust(String) // Steps of the step unit, up or down, as the button's value text.
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// A prompt for measurement m in a thing's unit, from its history; blank in the editor.
pub fn make_prompt(
  m : Measurement,
  thing_unit : String,
  base : Double,
  history : Array[Double],
  blank~ : Bool = false,
) -> Prompt {
  let u = preferred_unit(m, thing_unit, current=base)
  {
    kind: m.kind,
    unit_id: u.id,
    base,
    text: if blank && base == 0.0 {
      ""
    } else {
      text_in(base, u)
    },
    history: Vec::of(history),
  }
}

///|
pub fn Prompt::measurement(self : Prompt) -> Measurement {
  self.kind.measurement()
}

///|
pub fn Prompt::unit(self : Prompt) -> MeasureUnit {
  let m = self.measurement()
  m.find_unit(self.unit_id).unwrap_or(m.units[0])
}

///|
pub fn Prompt::formatted(self : Prompt) -> String {
  format_measurement(self.measurement(), self.base, unit=self.unit().id)
}

///|
fn Prompt::step_unit(self : Prompt) -> MeasureUnit {
  let m = self.measurement()
  m.find_unit(m.step_unit).unwrap_or(self.unit())
}

///|
fn symbol_of(u : MeasureUnit) -> String {
  let s = trim(u.symbol)
  if s == "" {
    u.label
  } else {
    s
  }
}

///|
priv struct UnitChip {
  id : String
  label : String
  symbol : String
  pill : String
  button : String
}

///|
fn Prompt::unit_chips(self : Prompt) -> Array[UnitChip] {
  let current = self.unit().id
  self.measurement().units.map(u => {
    let on = u.id == current
    {
      id: u.id,
      label: u.label,
      symbol: symbol_of(u),
      pill: if on {
        "\{chip} border-transparent bg-primary text-primary-content"
      } else {
        "\{chip} border-base-300 \{muted}"
      },
      button: if on {
        "\{unit_btn} bg-primary text-primary-content"
      } else {
        "\{unit_btn} bg-base-200 \{muted}"
      },
    }
  })
}

///|
priv struct Usual {
  value : Double
  label : String
  cls : String
}

///|
fn Prompt::usual(self : Prompt) -> Array[Usual] {
  common_values(self.history.to_array()).map(v => {
    value: v,
    label: format_measurement(self.measurement(), v, unit=self.unit().id),
    cls: if v == self.base {
      "min-h-11 rounded-xl border border-transparent bg-primary px-4 text-sm font-medium tabular-nums text-primary-content"
    } else {
      "min-h-11 rounded-xl border border-base-300 px-4 text-sm font-medium tabular-nums"
    },
  })
}

///|
priv struct AdjustButton {
  steps : Double
  label : String
  aria : String
  disabled : Bool
}

///|
fn Prompt::adjusts(self : Prompt) -> Array[AdjustButton] {
  let m = self.measurement()
  let name = self.step_unit().label
  [
    ..m.steps.map(v => {
      steps: v,
      label: "+\{v}",
      aria: "Add \{v} \{name}",
      disabled: false,
    }),
    ..m.steps.map(v => {
      steps: -v,
      label: "−\{v}",
      aria: "Subtract \{v} \{name}",
      disabled: self.base <= 0.0,
    }),
  ]
}

///|
fn number_input(
  classes : String,
  placeholder? : String,
) -> View[Prompt, PromptMsg] {
  let attrs : Array[@tutuca.Prop[Prompt, PromptMsg]] = [
    attr("type", "number"),
    attr("inputmode", "decimal"),
    attr("min", "0"),
    attr("step", "any"),
    cls(classes),
    bind_str("aria-label", s => s.measurement().name),
    value(s => s.text),
    on_input(v => SetText(v)),
  ]
  if placeholder is Some(p) {
    attrs.push(attr("placeholder", p))
  }
  input(attrs)
}

///|
fn Prompt::main_view() -> View[Prompt, PromptMsg] {
  div([cls("flex flex-col")], [
    h2(
      [
        cls(
          "mb-4 flex items-center justify-center gap-1.5 text-center text-base font-semibold",
        ),
      ],
      [show(s => "\{s.measurement().emoji} \{s.measurement().name}")],
    ),
    number_input(
      "input mx-auto block h-16 w-44 text-center text-3xl font-semibold tabular-nums",
    ),
    p([cls("mt-2 text-center text-sm \{muted}"), aria("live", "polite")], [
      show(s => s.formatted()),
    ]),
    when(
      s => s.measurement().units.length() > 1,
      div([cls("mt-4 flex flex-wrap justify-center gap-1.5")], [
        each(
          s => s.unit_chips().iter(),
          button(
            [
              class_(it => it.value.pill),
              bind_str("value", it => it.value.id),
              on_event(Click, (it, _) => Some(SetUnit(it.value.id))),
            ],
            [show(it => it.value.label)],
          ),
        ),
      ]),
    ),
    when(
      s => s.history.length() > 0,
      div([cls("mt-6")], [
        h3([cls("mb-2 text-xs font-medium \{muted}")], [txt("Usual")]),
        div([cls("flex flex-wrap gap-2")], [
          each(
            s => s.usual().iter(),
            button(
              [
                class_(it => it.value.cls),
                bind_str("value", it => it.value.value.to_string()),
                on_event(Click, (it, _) => {
                  Some(SetBase(it.value.value.to_string()))
                }),
              ],
              [show(it => it.value.label)],
            ),
          ),
        ]),
      ]),
    ),
    div([cls("mt-6")], [
      h3([cls("mb-2 text-xs font-medium \{muted}")], [
        show(s => "Adjust (\{symbol_of(s.step_unit())})"),
      ]),
      div([cls("grid grid-cols-3 gap-2")], [
        each(
          s => s.adjusts().iter(),
          button(
            [
              cls(adjust_class),
              bind_str("value", it => it.value.steps.to_string()),
              bind("disabled", it => Bool(it.value.disabled)),
              bind_str("aria-label", it => it.value.aria),
              on_event(Click, (it, _) => {
                Some(Adjust(it.value.steps.to_string()))
              }),
            ],
            [show(it => it.value.label)],
          ),
        ),
      ]),
    ]),
  ])
}

///|
fn Prompt::field_view() -> View[Prompt, PromptMsg] {
  div([cls("flex flex-col gap-1.5")], [
    label([cls("text-sm font-medium")], [show(s => s.measurement().name)]),
    div([cls("flex items-start gap-2")], [
      number_input("input input-sm w-24 tabular-nums", placeholder="0"),
      div([cls("flex max-h-20 flex-wrap gap-1 overflow-y-auto")], [
        each(
          s => s.unit_chips().iter(),
          button(
            [
              class_(it => it.value.button),
              bind_str("value", it => it.value.id),
              on_event(Click, (it, _) => Some(SetUnit(it.value.id))),
            ],
            [show(it => it.value.symbol)],
          ),
        ),
      ]),
    ]),
    when(
      s => s.base > 0.0,
      p([cls("text-xs tabular-nums \{muted}")], [show(s => s.formatted())]),
    ),
  ])
}

///|
fn Prompt::update(
  self : Prompt,
  msg : PromptMsg,
  _ctx : Ctx[Prompt, PromptMsg],
) -> Prompt {
  match msg {
    SetText(text) => {
      let base = match parse_float(text) {
        Some(n) if trim(text) != "" => {
          let b = to_base(n, self.unit())
          if b > 0.0 {
            b
          } else {
            0.0
          }
        }
        _ => 0.0
      }
      { ..self, text, base, }
    }
    SetUnit(unit_id) =>
      match self.measurement().find_unit(unit_id) {
        None => self
        Some(u) =>
          {
            ..self,
            unit_id: u.id,
            text: if self.base > 0.0 || self.text != "" {
              text_in(self.base, u)
            } else {
              ""
            },
          }
      }
    SetBase(value) =>
      match parse_float(value) {
        Some(base) if !base.is_nan() && !base.is_inf() && base >= 0.0 =>
          { ..self, base, text: text_in(base, self.unit()), }
        _ => self
      }
    Adjust(value) =>
      match parse_float(value) {
        Some(steps) if !steps.is_nan() && !steps.is_inf() => {
          let b = self.base + steps * self.step_unit().factor
          let base = if b > 0.0 { b } else { 0.0 }
          { ..self, base, text: text_in(base, self.unit()), }
        }
        _ => self
      }
  }
}

///|
pub let prompt_c : Component[Prompt, PromptMsg] = component(
  "Prompt",
  fields=[
    @tutuca.field_info(
      "measurement_id",
      OneOf([
        "duration", "count", "distance", "weight", "volume", "temperature", "energy",
        "steps", "rating",
      ]),
      initial="duration",
    ),
    @tutuca.field_info("unit_id", Text, initial=""),
    @tutuca.field_info("base", Number, constraints=[AtLeast(0)], initial=0, checks=[
      "the value is never negative",
    ]),
    @tutuca.field_info("text", Text, initial=""),
    @tutuca.field_info("history", ListOf(Number), initial=[], checks=[
      "the history is never negative",
    ]),
  ],
  messages=@tutuca.json_messages(["SetText", "SetUnit", "SetBase", "Adjust"]),
  view=Prompt::main_view,
  views=() => [("field", Prompt::field_view())],
  update=Prompt::update,
  invariants=[
    ("the value is never negative", s => s.base >= 0.0),
    ("the history is never negative", s => s.history.all(v => v >= 0.0)),
  ],
)

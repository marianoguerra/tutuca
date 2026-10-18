// Built-in measurements and unit math of thing-tracker (src/measurements/definitions.ts,
// src/lib/measure), from measure.js. Values are stored in a measurement's base unit; a unit
// converts with base = value * factor + offset.

///|
/// The built-in measurements; their ids are what records store.
pub(all) enum MeasureKind {
  Duration
  Count
  Distance
  Weight
  Volume
  Temperature
  Energy
  Steps
  Rating
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes a measurement id.
pub impl ToJson for MeasureKind with fn to_json(self) {
  Json::string(
    match self {
      Duration => "duration"
      Count => "count"
      Distance => "distance"
      Weight => "weight"
      Volume => "volume"
      Temperature => "temperature"
      Energy => "energy"
      Steps => "steps"
      Rating => "rating"
    },
  )
}

///|
pub impl FromJson for MeasureKind with fn from_json(json, path) {
  match json {
    String("duration") => Duration
    String("count") => Count
    String("distance") => Distance
    String("weight") => Weight
    String("volume") => Volume
    String("temperature") => Temperature
    String("energy") => Energy
    String("steps") => Steps
    String("rating") => Rating
    _ => raise @json.JsonDecodeError((path, "a measurement id"))
  }
}

///|
pub impl Default for MeasureKind with fn default() {
  Duration
}

///|
pub(all) struct MeasureUnit {
  id : String
  label : String
  symbol : String
  factor : Double
  precision : Int32
  offset : Double? // Only for scales that don't start at zero (temperatures).
}

///|
pub(all) struct Measurement {
  kind : MeasureKind
  id : String
  name : String
  emoji : String
  base_unit : String
  default_unit : String
  units : Array[MeasureUnit]
  steps : Array[Double]
  step_unit : String
}

///|
fn unit_def(
  id : String,
  label : String,
  symbol : String,
  factor : Double,
  precision : Int32,
  offset? : Double,
) -> MeasureUnit {
  { id, label, symbol, factor, precision, offset, }
}

///|
pub let measurements : Array[Measurement] = [
  {
    kind: Duration,
    id: "duration",
    name: "Duration",
    emoji: "⏱️",
    base_unit: "ms",
    default_unit: "min",
    units: [
      unit_def("ms", "milliseconds", "ms", 1.0, 0),
      unit_def("s", "seconds", "s", 1000.0, 0),
      unit_def("min", "minutes", "m", 60000.0, 0),
      unit_def("h", "hours", "h", 3600000.0, 2),
      unit_def("d", "days", "d", 86400000.0, 2),
    ],
    steps: [1.0, 5.0, 10.0, 15.0, 30.0, 60.0],
    step_unit: "min",
  },
  {
    kind: Count,
    id: "count",
    name: "Count",
    emoji: "🔢",
    base_unit: "x",
    default_unit: "x",
    units: [unit_def("x", "times", "×", 1.0, 0)],
    steps: [1.0, 2.0, 5.0, 10.0, 25.0, 100.0],
    step_unit: "x",
  },
  {
    kind: Distance,
    id: "distance",
    name: "Distance",
    emoji: "📏",
    base_unit: "m",
    default_unit: "km",
    units: [
      unit_def("cm", "centimetres", "cm", 0.01, 1),
      unit_def("m", "metres", "m", 1.0, 1),
      unit_def("km", "kilometres", "km", 1000.0, 2),
      unit_def("in", "inches", "in", 0.0254, 1),
      unit_def("ft", "feet", "ft", 0.3048, 1),
      unit_def("yd", "yards", "yd", 0.9144, 1),
      unit_def("mi", "miles", "mi", 1609.344, 2),
    ],
    steps: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
    step_unit: "km",
  },
  {
    kind: Weight,
    id: "weight",
    name: "Weight",
    emoji: "⚖️",
    base_unit: "g",
    default_unit: "kg",
    units: [
      unit_def("g", "grams", "g", 1.0, 0),
      unit_def("kg", "kilograms", "kg", 1000.0, 2),
      unit_def("oz", "ounces", "oz", 28.349523125, 1),
      unit_def("lb", "pounds", "lb", 453.59237, 2),
      unit_def("st", "stone", "st", 6350.29318, 2),
    ],
    steps: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
    step_unit: "kg",
  },
  {
    kind: Volume,
    id: "volume",
    name: "Volume",
    emoji: "🥤",
    base_unit: "ml",
    default_unit: "ml",
    units: [
      unit_def("ml", "millilitres", "ml", 1.0, 0),
      unit_def("l", "litres", "l", 1000.0, 2),
      unit_def("floz", "fluid ounces (US)", "fl oz", 29.5735295625, 1),
      unit_def("cup", "cups (US)", "cup", 236.5882365, 2),
      unit_def("pt", "pints (US)", "pt", 473.176473, 2),
      unit_def("galuk", "gallons (UK)", "gal", 4546.09, 2),
    ],
    steps: [50.0, 100.0, 250.0, 330.0, 500.0, 1000.0],
    step_unit: "ml",
  },
  {
    kind: Temperature,
    id: "temperature",
    name: "Temperature",
    emoji: "🌡️",
    base_unit: "c",
    default_unit: "c",
    units: [
      unit_def("c", "Celsius", "°C", 1.0, 1),
      unit_def("f", "Fahrenheit", "°F", 5.0 / 9.0, 1, offset=-160.0 / 9.0),
      unit_def("k", "Kelvin", "K", 1.0, 1, offset=-273.15),
    ],
    steps: [0.1, 0.5, 1.0, 5.0],
    step_unit: "c",
  },
  {
    kind: Energy,
    id: "energy",
    name: "Energy",
    emoji: "🔥",
    base_unit: "kcal",
    default_unit: "kcal",
    units: [
      unit_def("kcal", "kilocalories", "kcal", 1.0, 0),
      unit_def("kj", "kilojoules", "kJ", 0.239005736, 0),
    ],
    steps: [10.0, 50.0, 100.0, 250.0, 500.0],
    step_unit: "kcal",
  },
  {
    kind: Steps,
    id: "steps",
    name: "Steps",
    emoji: "👣",
    base_unit: "step",
    default_unit: "step",
    units: [unit_def("step", "steps", " steps", 1.0, 0)],
    steps: [100.0, 500.0, 1000.0, 2500.0, 5000.0],
    step_unit: "step",
  },
  {
    kind: Rating,
    id: "rating",
    name: "Rating",
    emoji: "⭐",
    base_unit: "pt",
    default_unit: "pt",
    units: [unit_def("pt", "out of 10", "/10", 1.0, 1)],
    steps: [0.5, 1.0, 2.0],
    step_unit: "pt",
  },
]

///|
pub fn MeasureKind::measurement(self : MeasureKind) -> Measurement {
  match measurements.iter().find_first(m => m.kind == self) {
    Some(m) => m
    None => abort("every kind has a measurement")
  }
}

///|
pub fn MeasureKind::id(self : MeasureKind) -> String {
  self.measurement().id
}

///|
/// The measurement with this id, if it's a built-in one.
pub fn find_measurement(id : String) -> Measurement? {
  measurements.iter().find_first(m => m.id == id)
}

///|
pub fn MeasureKind::from_id(id : String) -> MeasureKind? {
  find_measurement(id).map(m => m.kind)
}

///|
pub fn Measurement::find_unit(self : Measurement, id : String) -> MeasureUnit? {
  self.units.iter().find_first(u => u.id == id)
}

///|
pub fn to_base(value : Double, u : MeasureUnit) -> Double {
  value * u.factor + u.offset.unwrap_or(0.0)
}

///|
pub fn from_base(base : Double, u : MeasureUnit) -> Double {
  (base - u.offset.unwrap_or(0.0)) / u.factor
}

///|
pub fn round_to(value : Double, precision : Int32) -> Double {
  let mut scale = 1.0
  for _ in 0..<precision {
    scale = scale * 10.0
  }
  js_round(value * scale) / scale
}

///|
/// The largest ratio unit the value reaches, else the smallest, else the first.
fn natural_unit(base : Double, units : Array[MeasureUnit]) -> MeasureUnit {
  let ratio = sorted_by(units.filter(u => u.offset is None), (a, b) => {
    b.factor.compare(a.factor)
  })
  match ratio.iter().find_first(u => base.abs() >= u.factor) {
    Some(u) => u
    None => ratio.last().unwrap_or(units[0])
  }
}

///|
/// The thing's unit, else the measurement's default.
pub fn preferred_unit(
  m : Measurement,
  thing_unit : String,
  current? : Double,
) -> MeasureUnit {
  match m.find_unit(thing_unit) {
    Some(u) => u
    None =>
      match m.find_unit(m.default_unit) {
        Some(u) => u
        None =>
          match current {
            None => m.units[0]
            Some(c) => natural_unit(c, m.units)
          }
      }
  }
}

///|
pub fn format_duration_ms(ms : Double) -> String {
  if !(ms > 0.0) {
    return "0m"
  }
  let d = (ms / 86400000.0).floor()
  let h = (ms % 86400000.0 / 3600000.0).floor()
  let m = (ms % 3600000.0 / 60000.0).floor()
  let s = js_round(ms % 60000.0 / 1000.0)
  let n = (x : Double) => x.to_string()
  if d > 0.0 {
    return if h > 0.0 { "\{n(d)}d \{n(h)}h" } else { "\{n(d)}d" }
  }
  if h > 0.0 {
    return if m > 0.0 { "\{n(h)}h \{n(m)}m" } else { "\{n(h)}h" }
  }
  if m > 0.0 {
    return if s > 0.0 && m < 5.0 { "\{n(m)}m \{n(s)}s" } else { "\{n(m)}m" }
  }
  "\{n(s)}s"
}

///|
/// The value in the unit asked for, else the default one.
pub fn format_measurement(
  m : Measurement,
  base : Double,
  unit? : String,
) -> String {
  if m.base_unit == "ms" {
    return format_duration_ms(base)
  }
  let u = match unit.bind(id => m.find_unit(id)) {
    Some(u) => u
    None => m.find_unit(m.default_unit).unwrap_or(m.units[0])
  }
  "\{round_to(from_base(base, u), u.precision)}\{u.symbol}"
}

///|
/// The values seen most often, ties to the smaller one.
pub fn common_values(
  values : Array[Double],
  limit~ : Int32 = 6,
) -> Array[Double] {
  let counts : Array[(Double, Int32)] = []
  for v in values {
    match counts.search_by(c => c.0 == v) {
      Some(i) => counts[i] = (v, counts[i].1 + 1)
      None => counts.push((v, 1))
    }
  }
  let sorted = sorted_by(counts, (a, b) => {
    let c = b.1.compare(a.1)
    if c != 0 {
      c
    } else {
      a.0.compare(b.0)
    }
  })
  sorted[:if sorted.length() < limit { sorted.length() } else { limit }]
  .to_owned()
  .map(c => c.0)
}

///|
/// The text an input shows for base in unit u.
pub fn text_in(base : Double, u : MeasureUnit) -> String {
  round_to(from_base(base, u), u.precision).to_string()
}

///|
/// As JS keeps a thing's measurement (a MeasureRef, in model.mbt): by id, with its unit.
/// (Here, not in model.mbt: the playground's moonc aborts when a warning in one run's model.mbt
/// overlaps one in the last run's, as jsonschema's.)
pub impl ToJson for MeasureRef with fn to_json(self) {
  {
    "measurement_id": ToJson::to_json(self.kind),
    "unit": Json::string(self.unit),
  }
}

///|
pub impl FromJson for MeasureRef with fn from_json(json, path) {
  guard json is Object(m) else {
    raise @json.JsonDecodeError((path, "a measurement"))
  }
  {
    kind: @json.from_json(
      m.get("measurement_id").unwrap_or(Json::null()),
      path~,
    ),
    unit: @json.from_json(m.get("unit").unwrap_or(Json::null()), path~),
  }
}

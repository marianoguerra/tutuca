// The app's data as plain JSON records, for backups, imports and shared packs, from
// records.js. Records from a file get the fields our records require, coerced as JS does.

///|
fn json_field(j : Json, key : String) -> Json? {
  match j {
    Object(m) =>
      match m.get(key) {
        Some(Null) | None => None // JS's ?? treats null as missing.
        v => v
      }
    _ => None
  }
}

///|
/// JS's String(x).
fn js_string(j : Json?) -> String {
  match j {
    None => "undefined"
    Some(Null) => "null"
    Some(True) => "true"
    Some(False) => "false"
    Some(Number(n, ..)) => n.to_string()
    Some(String(s)) => s
    Some(Array(xs)) =>
      xs.map(x => if x is Null { "" } else { js_string(Some(x)) }).join(",")
    Some(Object(_)) => "[object Object]"
  }
}

///|
/// JS's Boolean(x).
fn js_truthy(j : Json?) -> Bool {
  match j {
    None | Some(Null) | Some(False) => false
    Some(Number(n, ..)) => !(n == 0.0 || n.is_nan())
    Some(String(s)) => s != ""
    _ => true
  }
}

///|
/// The text at key, or `default` when it's missing.
fn text_at(j : Json, key : String, default~ : String = "") -> String {
  match json_field(j, key) {
    None => default
    v => js_string(v)
  }
}

///|
fn string_at(j : Json, key : String) -> String {
  js_string(json_field(j, key))
}

///|
fn number_at(j : Json, key : String) -> Double {
  match json_field(j, key) {
    Some(Number(n, ..)) => n
    _ => 0.0
  }
}

///|
fn trunc(x : Double) -> Double {
  if x < 0.0 {
    -(-x).floor()
  } else {
    x.floor()
  }
}

///|
fn array_at(j : Json, key : String) -> Array[Json] {
  match json_field(j, key) {
    Some(Array(xs)) => xs
    _ => []
  }
}

///|
pub fn plain_thing(t : Thing) -> Json {
  Json::object({
    "id": Json(t.id),
    "emoji": Json(t.emoji),
    "title": Json(t.title),
    "description": Json(t.description),
    "measurements": Json::array(
      t.measurements
      .iter()
      .map(m => {
        Json::object({
          "measurementId": Json(m.kind.id()),
          "unit": Json(m.unit),
        })
      })
      .to_array(),
    ),
    "color": Json(t.color),
    "archived": Json(t.archived),
    "bundleId": Json(t.bundle_id),
  })
}

///|
pub fn plain_tag(g : Tag) -> Json {
  Json::object({
    "id": Json(g.id),
    "title": Json(g.title),
    "emoji": Json(g.emoji),
    "description": Json(g.description),
    "sortOrder": Json(g.sort_order),
    "thingIds": Json::array(g.thing_ids.iter().map(id => Json(id)).to_array()),
    "bundleId": Json(g.bundle_id),
  })
}

///|
pub fn plain_event(e : EventRecord) -> Json {
  Json::object({
    "id": Json(e.id),
    "thingId": Json(e.thing_id),
    "recordedAt": Json(e.recorded_at),
    "actualAt": Json(e.actual_at),
    "measurements": Json::array(
      e.measurements
      .iter()
      .map(m => {
        Json::object({
          "measurementId": Json(m.measurement_id),
          "value": Json(m.value),
        })
      })
      .to_array(),
    ),
    "notes": Json(e.notes),
  })
}

///|
/// A thing from a file.
pub fn thing_from(t : Json) -> Thing {
  let emoji = text_at(t, "emoji", default="⭐")
  let refs = array_at(t, "measurements").filter_map(m => {
    match json_field(m, "measurementId") {
      Some(String(id)) =>
        MeasureKind::from_id(id).map(kind => {
          ({ kind, unit: text_at(m, "unit"), } : MeasureRef)
        })
      _ => None
    }
  })
  Thing::new(
    string_at(t, "id"),
    if emoji == "" {
      "⭐"
    } else {
      emoji
    },
    prefix(text_at(t, "title"), 120),
    description=text_at(t, "description"),
    measurements=Vec::of(refs),
    color=text_at(t, "color"),
    archived=js_truthy(json_field(t, "archived")),
    bundle_id=text_at(t, "bundleId"),
  )
}

///|
/// A here thing with what a file says of it: JS's thingFrom({ ...here, ...t }).
pub fn thing_over(here : Thing, t : Json) -> Thing {
  match (plain_thing(here), t) {
    (Object(base), Object(over)) => {
      let merged = Map([])
      for k, v in base {
        merged[k] = v
      }
      for k, v in over {
        merged[k] = v
      }
      thing_from(Json::object(merged))
    }
    _ => thing_from(plain_thing(here))
  }
}

///|
/// A tag from a file; `sort_order` when it has none.
pub fn tag_from(g : Json, sort_order : Int32) -> Tag {
  let order = match json_field(g, "sortOrder") {
    Some(Number(n, ..)) => trunc(n).to_int()
    _ => sort_order
  }
  Tag::new(
    string_at(g, "id"),
    prefix(text_at(g, "title"), 120),
    emoji=text_at(g, "emoji"),
    description=text_at(g, "description"),
    sort_order=order,
    thing_ids=Vec::of(array_at(g, "thingIds").map(id => js_string(Some(id)))),
    bundle_id=text_at(g, "bundleId"),
  )
}

///|
/// An event from a file.
pub fn event_from(e : Json) -> EventRecord {
  let actual_at = trunc(number_at(e, "actualAt"))
  let recorded_at = match json_field(e, "recordedAt") {
    Some(Number(n, ..)) => trunc(n)
    _ => actual_at
  }
  let values = array_at(e, "measurements").filter_map(m => {
    match json_field(m, "value") {
      Some(Number(v, ..)) if v >= 0.0 =>
        Some({ measurement_id: string_at(m, "measurementId"), value: v, })
      _ => None
    }
  })
  {
    id: string_at(e, "id"),
    thing_id: string_at(e, "thingId"),
    recorded_at,
    actual_at,
    measurements: Vec::of(values),
    notes: text_at(e, "notes"),
  }
}

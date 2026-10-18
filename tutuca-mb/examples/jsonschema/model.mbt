///|
using @tutuca {type Vec}

// The schema tree: one variant per kind of schema, read from a JSON Schema once, on the way in.
// enum and const carry arbitrary JSON, which has no schema shape, so they hold JSON values.

///|
pub let default_per_page : Int32 = 50

///|
pub(all) struct Notes {
  title : String
  description : String
} derive(Eq, Debug, ToJson, FromJson)

///|
/// One page of a node's items. `total` never changes: a node's items are fixed once built.
pub(all) struct Pager {
  total : Int32
  per_page : Int32
  page : Int32
  settings : Bool
} derive(Eq, Debug, ToJson, FromJson)

///|
pub(all) struct ObjectSchema {
  notes : Notes
  properties : Vec[Property]
  additional : Schema? // What additionalProperties allows, if it says.
  open : Bool
  pager : Pager?
} derive(Eq, Debug)

///|
pub(all) struct Property {
  name : String
  required : Bool
  schema : Schema
} derive(Eq, Debug)

///|
pub(all) struct ArraySchema {
  notes : Notes
  items : Schema? // What every element must be, if it says.
  min_items : String // A keyword the schema writes as a number, as its text: "" when absent.
  max_items : String
  open : Bool
} derive(Eq, Debug)

///|
pub(all) struct StringSchema {
  notes : Notes
  format : String
  pattern : String
  min_length : String
  max_length : String
} derive(Eq, Debug)

///|
pub(all) struct NumericSchema {
  notes : Notes
  minimum : String
  maximum : String
  multiple_of : String
} derive(Eq, Debug)

///|
pub(all) struct UnionSchema {
  notes : Notes
  types : Array[String]
} derive(Eq, Debug)

///|
pub(all) struct EnumSchema {
  notes : Notes
  values : Vec[@jv.JsonValue]
  open : Bool
  pager : Pager?
} derive(Eq, Debug)

///|
pub(all) struct ConstSchema {
  notes : Notes
  value : @jv.JsonValue
} derive(Eq, Debug)

///|
pub(all) struct Combinator {
  notes : Notes
  branches : Vec[Schema]
  open : Bool
  pager : Pager?
} derive(Eq, Debug)

///|
pub(all) struct NotSchema {
  notes : Notes
  schema : Schema
} derive(Eq, Debug)

///|
pub(all) enum Schema {
  SObject(ObjectSchema)
  SArray(ArraySchema)
  SString(StringSchema)
  SNumber(NumericSchema)
  SInteger(NumericSchema)
  SBoolean(Notes)
  SNull(Notes)
  SUnion(UnionSchema)
  SEnum(EnumSchema)
  SConst(ConstSchema)
  SRef(String)
  SAllOf(Combinator)
  SAnyOf(Combinator)
  SOneOf(Combinator)
  SNot(NotSchema)
  SAny // true, or {}: anything is valid.
  SNever // false: nothing is valid.
} derive(Eq, Debug)

// --- opening and closing ---------------------------------------------------------------

///|
pub fn Schema::is_openable(self : Schema) -> Bool {
  self
  is (SObject(_) | SArray(_) | SEnum(_) | SAllOf(_) | SAnyOf(_) | SOneOf(_))
}

///|
pub fn Schema::is_open(self : Schema) -> Bool? {
  match self {
    SObject(o) => Some(o.open)
    SArray(a) => Some(a.open)
    SEnum(e) => Some(e.open)
    SAllOf(c) | SAnyOf(c) | SOneOf(c) => Some(c.open)
    _ => None
  }
}

///|
pub fn Schema::set_open(self : Schema, open : Bool) -> Schema {
  match self {
    SObject(o) => SObject({ ..o, open, })
    SArray(a) => SArray({ ..a, open, })
    SEnum(e) => SEnum({ ..e, open, })
    SAllOf(c) => SAllOf({ ..c, open, })
    SAnyOf(c) => SAnyOf({ ..c, open, })
    SOneOf(c) => SOneOf({ ..c, open, })
    other => other
  }
}

///|
/// The schema with `f` applied to each node right below it; properties are see-through.
pub fn Schema::map_children(self : Schema, f : (Schema) -> Schema) -> Schema {
  match self {
    SObject(o) =>
      SObject({
        ..o,
        properties: o.properties.map(p => { ..p, schema: f(p.schema), }),
        additional: o.additional.map(f),
      })
    SArray(a) => SArray({ ..a, items: a.items.map(f), })
    SAllOf(c) => SAllOf({ ..c, branches: c.branches.map(f), })
    SAnyOf(c) => SAnyOf({ ..c, branches: c.branches.map(f), })
    SOneOf(c) => SOneOf({ ..c, branches: c.branches.map(f), })
    SNot(n) => SNot({ ..n, schema: f(n.schema), })
    other => other
  }
}

///|
/// The nodes right below it.
pub fn Schema::children(self : Schema) -> Array[Schema] {
  let out = []
  ignore(
    self.map_children(c => {
      out.push(c)
      c
    }),
  )
  out
}

///|
/// The node and everything below it opened or closed.
pub fn Schema::open_deep(self : Schema, open : Bool) -> Schema {
  self.set_open(open).map_children(c => c.open_deep(open))
}

///|
/// The nearest openable nodes below it opened or closed: what a ctrl click below asks of it.
pub fn Schema::open_children(self : Schema, open : Bool) -> Schema {
  self.map_children(c => c.set_open(open))
}

///|
/// The open state of the node and every node below it, depth first.
pub fn Schema::all_open(self : Schema) -> Array[Bool] {
  let out = match self.is_open() {
    Some(o) => [o]
    None => []
  }
  for c in self.children() {
    out.append(c.all_open())
  }
  out
}

// --- pager -------------------------------------------------------------------------------

///|
pub fn Pager::last_page(self : Pager) -> Int32 {
  let pages = (self.total + self.per_page - 1) / self.per_page
  if pages - 1 < 0 {
    0
  } else {
    pages - 1
  }
}

///|
pub fn Pager::shows(self : Pager, key : Int32) -> Bool {
  key >= self.page * self.per_page && key < (self.page + 1) * self.per_page
}

///|
pub fn Pager::is_many(self : Pager) -> Bool {
  self.total > self.per_page
}

///|
/// The pager for `total` items, or None when they fit in one page.
pub fn pager_for(total : Int32, per_page : Int32) -> Pager? {
  if total <= per_page {
    None
  } else {
    Some({
      total,
      per_page: if per_page < 1 {
        1
      } else {
        per_page
      },
      page: 0,
      settings: false,
    })
  }
}

// --- reading -----------------------------------------------------------------------------

///|
fn field(j : Json, key : String) -> Json? {
  match j {
    Object(m) => m.get(key)
    _ => None
  }
}

///|
fn array_at(j : Json, key : String) -> Array[Json] {
  match field(j, key) {
    Some(Array(xs)) => xs
    _ => []
  }
}

///|
fn number_text(n : Double) -> String {
  Json::number(n).stringify()
}

///|
/// A keyword as text: a number or a string, else "".
fn scalar(j : Json, key : String) -> String {
  match field(j, key) {
    Some(String(s)) => s
    Some(Number(n, ..)) => number_text(n)
    _ => ""
  }
}

///|
fn notes_of(j : Json) -> Notes {
  { title: scalar(j, "title"), description: scalar(j, "description"), }
}

///|
/// Which kind of schema `j` is, in the order a validator reads it: $ref stands for what it
/// points at, a combinator is about its branches, enum and const pin the value whatever its
/// type. Only then type decides, and a schema without one is read from its keywords.
pub fn read_kind(j : Json) -> String {
  guard j is Object(m) && !m.is_empty() else {
    return if j is False { "never" } else { "any" }
  }
  if m.get("$ref") is Some(String(_)) {
    return "ref"
  }
  for k in ["allOf", "anyOf", "oneOf"] {
    if m.get(k) is Some(Array(_)) {
      return k
    }
  }
  if m.contains("not") {
    return "not"
  }
  if m.get("enum") is Some(Array(_)) {
    return "enum"
  }
  if m.contains("const") {
    return "const"
  }
  match m.get("type") {
    Some(String(t)) => return t
    Some(Array(_)) => return "union"
    _ => ()
  }
  if m.contains("properties") || m.contains("required") {
    return "object"
  }
  if m.contains("items") {
    return "array"
  }
  "any"
}

///|
/// The node for schema `j`; `open` is how every node starts.
pub fn from_schema(
  j : Json,
  open~ : Bool = true,
  per_page~ : Int32 = default_per_page,
) -> Schema {
  let node = (x : Json) => from_schema(x, open~, per_page~)
  let notes = notes_of(j)
  match read_kind(j) {
    "object" => {
      let required = array_at(j, "required").filter_map(r => {
        match r {
          String(s) => Some(s)
          _ => None
        }
      })
      let properties = match field(j, "properties") {
        Some(Object(props)) =>
          props
          .to_array()
          .map(p => {
            name: p.0,
            required: required.contains(p.0),
            schema: node(p.1),
          })
        _ => []
      }
      SObject({
        notes,
        properties: Vec::of(properties),
        additional: field(j, "additionalProperties").map(node),
        open,
        pager: pager_for(properties.length(), per_page),
      })
    }
    "array" =>
      SArray({
        notes,
        items: field(j, "items").map(node),
        min_items: scalar(j, "minItems"),
        max_items: scalar(j, "maxItems"),
        open,
      })
    "string" =>
      SString({
        notes,
        format: scalar(j, "format"),
        pattern: scalar(j, "pattern"),
        min_length: scalar(j, "minLength"),
        max_length: scalar(j, "maxLength"),
      })
    "number" | "integer" as kind => {
      let n = {
        notes,
        minimum: scalar(j, "minimum"),
        maximum: scalar(j, "maximum"),
        multiple_of: scalar(j, "multipleOf"),
      }
      if kind == "number" {
        SNumber(n)
      } else {
        SInteger(n)
      }
    }
    "boolean" => SBoolean(notes)
    "null" => SNull(notes)
    "union" =>
      SUnion({
        notes,
        types: array_at(j, "type").filter_map(t => {
          match t {
            String(s) => Some(s)
            _ => None
          }
        }),
      })
    "enum" => {
      let values = array_at(j, "enum").map(@jv.from_json)
      SEnum({
        notes,
        values: Vec::of(values),
        open,
        pager: pager_for(values.length(), per_page),
      })
    }
    "const" =>
      SConst({ notes, value: @jv.from_json(field(j, "const").unwrap()), })
    "ref" => SRef(scalar(j, "$ref"))
    "not" => SNot({ notes, schema: node(field(j, "not").unwrap()), })
    "never" => SNever
    "allOf" | "anyOf" | "oneOf" as kind => {
      let branches = array_at(j, kind).map(node)
      let c = {
        notes,
        branches: Vec::of(branches),
        open,
        pager: pager_for(branches.length(), per_page),
      }
      match kind {
        "allOf" => SAllOf(c)
        "anyOf" => SAnyOf(c)
        _ => SOneOf(c)
      }
    }
    _ => SAny
  }
}

// --- writing back ------------------------------------------------------------------------

///|
fn put_notes(n : Notes, out : Map[String, Json]) -> Map[String, Json] {
  if n.title != "" {
    out["title"] = Json::string(n.title)
  }
  if n.description != "" {
    out["description"] = Json::string(n.description)
  }
  out
}

///|
fn put_number(out : Map[String, Json], key : String, text : String) -> Unit {
  if text != "" {
    out[key] = Json::number(@string.parse_double(text) catch { _ => 0.0 })
  }
}

///|
/// The schema the tree stands for. Lossy by construction: keywords the family doesn't model
/// ($defs, if/then, vendor extensions) are not in the tree, so reading the output back is a
/// fixed point rather than an identity.
pub fn Schema::to_schema(self : Schema) -> Json {
  let typed = (t : String, n : Notes) => {
    put_notes(n, { "type": Json::string(t) })
  }
  match self {
    SObject(o) => {
      let out = typed("object", o.notes)
      let props = Map([])
      for p in o.properties.iter() {
        props[p.name] = p.schema.to_schema()
      }
      out["properties"] = Json::object(props)
      let required = o.properties
        .filter(p => p.required)
        .map(p => Json::string(p.name))
      if required.length() > 0 {
        out["required"] = Json::array(required.to_array())
      }
      if o.additional is Some(a) {
        out["additionalProperties"] = a.to_schema()
      }
      Json::object(out)
    }
    SArray(a) => {
      let out = typed("array", a.notes)
      if a.items is Some(items) {
        out["items"] = items.to_schema()
      }
      put_number(out, "minItems", a.min_items)
      put_number(out, "maxItems", a.max_items)
      Json::object(out)
    }
    SString(s) => {
      let out = typed("string", s.notes)
      if s.format != "" {
        out["format"] = Json::string(s.format)
      }
      if s.pattern != "" {
        out["pattern"] = Json::string(s.pattern)
      }
      put_number(out, "minLength", s.min_length)
      put_number(out, "maxLength", s.max_length)
      Json::object(out)
    }
    SNumber(n) | SInteger(n) => {
      let out = typed(
        if self is SNumber(_) {
          "number"
        } else {
          "integer"
        },
        n.notes,
      )
      put_number(out, "minimum", n.minimum)
      put_number(out, "maximum", n.maximum)
      put_number(out, "multipleOf", n.multiple_of)
      Json::object(out)
    }
    SBoolean(n) => Json::object(typed("boolean", n))
    SNull(n) => Json::object(typed("null", n))
    SUnion(u) =>
      Json::object(
        put_notes(u.notes, { "type": Json::array(u.types.map(Json::string)) }),
      )
    SEnum(e) =>
      Json::object(
        put_notes(e.notes, {
          "enum": Json::array(e.values.map(v => v.to_json_value()).to_array()),
        }),
      )
    SConst(c) =>
      Json::object(put_notes(c.notes, { "const": c.value.to_json_value() }))
    SRef(target) => { "$ref": Json::string(target) }
    SAllOf(c) | SAnyOf(c) | SOneOf(c) => {
      let key = match self {
        SAllOf(_) => "allOf"
        SAnyOf(_) => "anyOf"
        _ => "oneOf"
      }
      let out = Map([])
      out[key] = Json::array(c.branches.map(b => b.to_schema()).to_array())
      Json::object(put_notes(c.notes, out))
    }
    SNot(n) => Json::object(put_notes(n.notes, { "not": n.schema.to_schema() }))
    SAny => Json::object(Map([]))
    SNever => Json::boolean(false)
  }
}

///|
/// JSON text with sorted keys, to compare schemas whatever their key order.
pub fn canonical(j : Json) -> String {
  fn sorted(j : Json) -> Json {
    match j {
      Object(m) => {
        let keys = m.keys().to_array()
        keys.sort()
        let out = Map([])
        for k in keys {
          out[k] = sorted(m[k])
        }
        Json::object(out)
      }
      Array(xs) => Json::array(xs.map(sorted))
      other => other
    }
  }

  sorted(j).stringify()
}

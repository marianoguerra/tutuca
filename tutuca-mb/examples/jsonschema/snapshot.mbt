// The schema components' JSON, as JS's snapshot of them: a node's notes flattened into it,
// a schema tagged with its component's name as `$`.

///|
/// A node's notes, then its other fields, as JS's components keep them.
fn noted(n : Notes, rest : Array[(String, Json)]) -> Json {
  let out : Map[String, Json] = {
    "title": Json::string(n.title),
    "description": Json::string(n.description),
  }
  for e in rest {
    out[e.0] = e.1
  }
  Json::object(out)
}

///|
fn[T : ToJson] or_null(v : T?) -> Json {
  match v {
    Some(x) => x.to_json()
    None => Json::null()
  }
}

///|
pub impl ToJson for ObjectSchema with fn to_json(self) {
  noted(self.notes, [
    ("properties", self.properties.to_json()),
    ("additional", or_null(self.additional)),
    ("open", Json::boolean(self.open)),
    ("pager", or_null(self.pager)),
  ])
}

///|
pub impl ToJson for Property with fn to_json(self) {
  {
    "name": Json::string(self.name),
    "required": Json::boolean(self.required),
    "schema": ToJson::to_json(self.schema),
  }
}

///|
pub impl ToJson for ArraySchema with fn to_json(self) {
  noted(self.notes, [
    ("items", or_null(self.items)),
    ("min_items", Json::string(self.min_items)),
    ("max_items", Json::string(self.max_items)),
    ("open", Json::boolean(self.open)),
  ])
}

///|
pub impl ToJson for StringSchema with fn to_json(self) {
  noted(self.notes, [
    ("format", Json::string(self.format)),
    ("pattern", Json::string(self.pattern)),
    ("min_length", Json::string(self.min_length)),
    ("max_length", Json::string(self.max_length)),
  ])
}

///|
pub impl ToJson for NumericSchema with fn to_json(self) {
  noted(self.notes, [
    ("minimum", Json::string(self.minimum)),
    ("maximum", Json::string(self.maximum)),
    ("multiple_of", Json::string(self.multiple_of)),
  ])
}

///|
pub impl ToJson for UnionSchema with fn to_json(self) {
  noted(self.notes, [
    ("types", Json::array(self.types.map(t => Json::string(t)))),
  ])
}

///|
pub impl ToJson for EnumSchema with fn to_json(self) {
  noted(self.notes, [
    ("values", self.values.to_json()),
    ("open", Json::boolean(self.open)),
    ("pager", or_null(self.pager)),
  ])
}

///|
pub impl ToJson for ConstSchema with fn to_json(self) {
  noted(self.notes, [("value", self.value.to_json())])
}

///|
pub impl ToJson for Combinator with fn to_json(self) {
  noted(self.notes, [
    ("branches", self.branches.to_json()),
    ("open", Json::boolean(self.open)),
    ("pager", or_null(self.pager)),
  ])
}

///|
pub impl ToJson for NotSchema with fn to_json(self) {
  noted(self.notes, [("schema", ToJson::to_json(self.schema))])
}

///|
/// The state of the node's component with its name as `$`, as JS's snapshot of a field that
/// holds any schema component.
pub impl ToJson for Schema with fn to_json(self) {
  let (name, state) = match self {
    SObject(o) => ("SchemaObject", ToJson::to_json(o))
    SArray(a) => ("SchemaArray", ToJson::to_json(a))
    SString(t) => ("SchemaString", ToJson::to_json(t))
    SNumber(n) => ("SchemaNumber", ToJson::to_json(n))
    SInteger(n) => ("SchemaInteger", ToJson::to_json(n))
    SBoolean(n) => ("SchemaBoolean", noted(n, []))
    SNull(n) => ("SchemaNull", noted(n, []))
    SUnion(u) => ("SchemaUnion", ToJson::to_json(u))
    SEnum(e) => ("SchemaEnum", ToJson::to_json(e))
    SConst(c) => ("SchemaConst", ToJson::to_json(c))
    SRef(target) => ("SchemaRef", { "target": Json::string(target) })
    SAllOf(c) => ("SchemaAllOf", ToJson::to_json(c))
    SAnyOf(c) => ("SchemaAnyOf", ToJson::to_json(c))
    SOneOf(c) => ("SchemaOneOf", ToJson::to_json(c))
    SNot(n) => ("SchemaNot", ToJson::to_json(n))
    SAny => ("SchemaAny", Json::null())
    SNever => ("SchemaNever", Json::null())
  }
  let out : Map[String, Json] = { "$": Json::string(name) }
  if state is Object(m) {
    for k, v in m {
      out[k] = v
    }
  }
  Json::object(out)
}

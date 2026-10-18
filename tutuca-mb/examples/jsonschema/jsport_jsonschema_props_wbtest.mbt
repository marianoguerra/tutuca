// JS's testGenericProperties(schemaComponents) checks every schema component, not only the
// root: random states for each node kind, read from schemas of that kind built around
// gen_schema's, so the inner components get the generic properties directly.

///|
fn gpick(rs : @splitmix.RandomState, n : Int32) -> Int32 {
  rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
}

///|
fn gword(rs : @splitmix.RandomState) -> Json {
  Json::string(["", "a", "id", "x y", "Episode"][gpick(rs, 5)])
}

///|
/// `j` read as a tree, open or closed, with small pages so pagers show up.
fn read_random(rs : @splitmix.RandomState, j : Json) -> Schema {
  from_schema(j, open=gpick(rs, 2) == 0, per_page=1 + gpick(rs, 4))
}

///|
fn depth_of(size : Int32) -> Int32 {
  size % 3
}

///|
fn object_json(rs : @splitmix.RandomState, size : Int32) -> Json {
  let props = Map([])
  let required = []
  for i in 0..<(1 + gpick(rs, 3)) {
    let name = ["a", "b", "c"][i]
    props[name] = gen_schema(rs, depth_of(size))
    if gpick(rs, 2) == 0 {
      required.push(Json::string(name))
    }
  }
  {
    "type": "object",
    "title": gword(rs),
    "description": gword(rs),
    "properties": Json::object(props),
    "required": Json::array(required),
    "additionalProperties": gen_schema(rs, depth_of(size)),
  }
}

///|
impl @quickcheck.Arbitrary for Notes with fn arbitrary(_, rs) {
  guard gword(rs) is String(title) && gword(rs) is String(description) else {
    abort("not the kind asked for")
  }
  { title, description, }
}

///|
impl @quickcheck.Arbitrary for Schema with fn arbitrary(size, rs) {
  read_random(rs, gen_schema(rs, depth_of(size)))
}

///|
impl @quickcheck.Arbitrary for ObjectSchema with fn arbitrary(size, rs) {
  guard read_random(rs, object_json(rs, size)) is SObject(o) else {
    abort("not the kind asked for")
  }
  o
}

///|
impl @quickcheck.Arbitrary for Property with fn arbitrary(size, rs) {
  guard read_random(rs, object_json(rs, size)) is SObject(o) else {
    abort("not the kind asked for")
  }
  o.properties.to_array()[gpick(rs, o.properties.length())]
}

///|
impl @quickcheck.Arbitrary for ArraySchema with fn arbitrary(size, rs) {
  let j : Json = {
    "type": "array",
    "items": gen_schema(rs, depth_of(size)),
    "minItems": Json::number(gpick(rs, 3).to_double()),
    "maxItems": Json::number((3 + gpick(rs, 3)).to_double()),
  }
  guard read_random(rs, j) is SArray(a) else { abort("not the kind asked for") }
  a
}

///|
impl @quickcheck.Arbitrary for StringSchema with fn arbitrary(_, rs) {
  let j : Json = {
    "type": "string",
    "format": ["uuid", "email", "date-time", ""][gpick(rs, 4)],
    "pattern": "^[a-z]+$",
    "minLength": Json::number(gpick(rs, 3).to_double()),
    "maxLength": Json::number((3 + gpick(rs, 200)).to_double()),
  }
  guard read_random(rs, j) is SString(s) else {
    abort("not the kind asked for")
  }
  s
}

///|
impl @quickcheck.Arbitrary for NumericSchema with fn arbitrary(_, rs) {
  let j : Json = {
    "type": "number",
    "minimum": Json::number((gpick(rs, 20) - 10).to_double()),
    "maximum": Json::number((10 + gpick(rs, 20)).to_double()),
    "multipleOf": Json::number((1 + gpick(rs, 5)).to_double()),
  }
  guard read_random(rs, j) is SNumber(n) else {
    abort("not the kind asked for")
  }
  n
}

///|
impl @quickcheck.Arbitrary for UnionSchema with fn arbitrary(_, rs) {
  let types = [
      ["string", "null"],
      ["number", "string"],
      ["integer", "boolean", "null"],
    ][gpick(rs, 3)]
  guard read_random(rs, { "type": Json::array(types.map(Json::string)) })
    is SUnion(u) else {
    abort("not the kind asked for")
  }
  u
}

///|
fn enum_json(rs : @splitmix.RandomState) -> Json {
  let values = Array::makei(gpick(rs, 12), i => {
    match gpick(rs, 4) {
      0 => Json::number(i.to_double())
      1 => Json::string("v\{i}")
      2 => Json::null()
      _ => { "k": Json::number(i.to_double()) }
    }
  })
  { "enum": Json::array(values) }
}

///|
impl @quickcheck.Arbitrary for EnumSchema with fn arbitrary(_, rs) {
  guard read_random(rs, enum_json(rs)) is SEnum(e) else {
    abort("not the kind asked for")
  }
  e
}

///|
impl @quickcheck.Arbitrary for Pager with fn arbitrary(_, rs) {
  // A pager as a list of at least two pages has it.
  let n = 2 + gpick(rs, 20)
  let j : Json = {
    "enum": Json::array(Array::makei(n, i => Json::number(i.to_double()))),
  }
  guard from_schema(j, per_page=1 + gpick(rs, n - 1))
    is SEnum({ pager: Some(p), .. }) else {
    abort("not the kind asked for")
  }
  p
}

///|
impl @quickcheck.Arbitrary for ConstSchema with fn arbitrary(_, rs) {
  let value : Json = [Json::number(1), "x", Json::null(), { "a": [1, 2] }][gpick(
      rs, 4,
    )]
  guard read_random(rs, { "const": value, "title": gword(rs) }) is SConst(c) else {
    abort("not the kind asked for")
  }
  c
}

///|
impl @quickcheck.Arbitrary for Combinator with fn arbitrary(size, rs) {
  let key = ["allOf", "anyOf", "oneOf"][gpick(rs, 3)]
  let branches = Array::makei(gpick(rs, 4), _ => gen_schema(rs, depth_of(size)))
  match read_random(rs, Json::object(Map([(key, Json::array(branches))]))) {
    SAllOf(c) | SAnyOf(c) | SOneOf(c) => c
    _ => abort("a combinator")
  }
}

///|
impl @quickcheck.Arbitrary for NotSchema with fn arbitrary(size, rs) {
  guard read_random(rs, { "not": gen_schema(rs, depth_of(size)) }) is SNot(n) else {
    abort("not the kind asked for")
  }
  n
}

///|
test "every schema component has the generic properties" {
  @testing.check_component(schema_node(), count=25)
  @testing.check_component(schema_object(), count=25)
  @testing.check_component(schema_property(), count=25)
  @testing.check_component(schema_array(), count=25)
  @testing.check_component(schema_string, count=25)
  @testing.check_component(schema_number, count=25)
  @testing.check_component(schema_integer, count=25)
  @testing.check_component(schema_boolean, count=25)
  @testing.check_component(schema_null, count=25)
  @testing.check_component(schema_union, count=25)
  @testing.check_component(schema_enum(), count=25)
  @testing.check_component(schema_const, count=25)
  @testing.check_component(schema_ref, count=25)
  @testing.check_component(schema_pager, count=25)
  @testing.check_component(all_of(), count=25)
  @testing.check_component(any_of(), count=25)
  @testing.check_component(one_of(), count=25)
  @testing.check_component(schema_not(), count=25)
  @testing.check_component(schema_any, count=25)
  @testing.check_component(schema_never, count=25)
}

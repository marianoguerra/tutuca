///|
/// A schema that uses most of what the family models.
pub let sample : Json = {
  "title": "Episode",
  "description": "One entry of a podcast feed.",
  "type": "object",
  "required": ["id", "title"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
    "durationSeconds": { "type": "integer", "minimum": 0 },
    "rating": { "type": "number", "minimum": 0, "maximum": 5 },
    "explicit": { "type": "boolean" },
    "notes": { "type": ["string", "null"] },
    "kind": { "enum": ["full", "trailer", "bonus"] },
    "version": { "const": 2 },
    "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 10 },
    "author": { "$ref": "#/$defs/person" },
  },
  "additionalProperties": false,
}

///|
/// Schemas from a small grammar of the keywords the family models.
pub fn gen_schema(rs : @splitmix.RandomState, depth : Int32) -> Json {
  let pick = (n : Int32) => {
    rs.next_uint(limit=n.reinterpret_as_uint()).reinterpret_as_int()
  }
  let word = () => ["a", "b", "c", "id", "x y", ""][pick(6)]
  let leaf = () => {
    match pick(9) {
      0 => Json::boolean(true)
      1 => Json::boolean(false)
      2 => Json::object(Map([]))
      3 => { "type": "boolean" }
      4 => { "type": "null" }
      5 =>
        {
          "type": "string",
          "format": Json::string(word()),
          "minLength": Json::number(pick(5).to_double()),
        }
      6 =>
        {
          "type": Json::string(if pick(2) == 0 { "number" } else { "integer" }),
          "minimum": Json::number((pick(20) - 10).to_double()),
          "multipleOf": Json::number(pick(5).to_double()),
        }
      7 =>
        {
          "enum": Json::array([
            Json::number(pick(3).to_double()),
            Json::string(word()),
          ]),
        }
      _ => { "$ref": Json::string("#/\{word()}") }
    }
  }
  if depth <= 0 {
    return leaf()
  }
  match pick(5) {
    0 => { "not": gen_schema(rs, depth - 1) }
    1 =>
      {
        "anyOf": Json::array(
          Array::makei(pick(3), _ => gen_schema(rs, depth - 1)),
        ),
      }
    2 =>
      {
        "type": "array",
        "items": gen_schema(rs, depth - 1),
        "maxItems": Json::number(pick(4).to_double()),
      }
    3 => {
      let props = Map([])
      for _ in 0..<pick(3) {
        props[["a", "b", "c"][pick(3)]] = gen_schema(rs, depth - 1)
      }
      {
        "type": "object",
        "title": Json::string(word()),
        "properties": Json::object(props),
        "additionalProperties": gen_schema(rs, depth - 1),
      }
    }
    _ => leaf()
  }
}

///|
pub impl @quickcheck.Arbitrary for SchemaRoot with fn arbitrary(size, rs) {
  schema_tree(
    gen_schema(rs, size % 4),
    reading=if rs.next_uint(limit=2) == 0 { Semantic } else { Format },
  )
}

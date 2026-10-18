// A JSON Schema that an example value matches: types, properties, required keys and string
// formats, with array items merged into one schema across the elements. The inverse of read.

///|
fn all_chars(s : StringView, ok : (Char) -> Bool) -> Bool {
  s.iter().all(ok)
}

///|
fn is_digit(c : Char) -> Bool {
  c >= '0' && c <= '9'
}

///|
fn is_date(s : String) -> Bool {
  s.length() == 10 &&
  s.get_char(4) == Some('-') &&
  s.get_char(7) == Some('-') &&
  all_chars(s.view(end_offset=4), is_digit) &&
  all_chars(s.view(start_offset=5, end_offset=7), is_digit) &&
  all_chars(s.view(start_offset=8), is_digit)
}

///|
/// 2026-10-16T10:30, then optional :ss and .fff, then an optional zone: Z or ±hh:mm.
fn is_date_time(s : String) -> Bool {
  if s.length() < 16 ||
    !is_date(s.view(end_offset=10).to_owned()) ||
    s.get_char(10) != Some('T') {
    return false
  }
  let rest = s.view(start_offset=11).to_owned()
  let hm = rest.view(end_offset=5)
  if !(hm.get_char(2) == Some(':') &&
    all_chars(hm.view(end_offset=2), is_digit) &&
    all_chars(hm.view(start_offset=3), is_digit)) {
    return false
  }
  let mut tail = rest.view(start_offset=5).to_owned()
  if tail.has_prefix(":") &&
    tail.length() >= 3 &&
    all_chars(tail.view(start_offset=1, end_offset=3), is_digit) {
    tail = tail.view(start_offset=3).to_owned()
    if tail.has_prefix(".") {
      let mut i = 1
      while i < tail.length() && tail.get_char(i).map(is_digit).unwrap_or(false) {
        i += 1
      }
      if i == 1 {
        return false
      }
      tail = tail.view(start_offset=i).to_owned()
    }
  }
  if tail == "" || tail == "Z" {
    return true
  }
  if !(tail.has_prefix("+") || tail.has_prefix("-")) {
    return false
  }
  let zone = tail.view(start_offset=1).to_owned().replace_all(old=":", new="")
  zone.length() == 4 && all_chars(zone[:], is_digit) && tail.length() <= 6
}

///|
fn is_email(s : String) -> Bool {
  if s.iter().any(c => c is (' ' | '\t' | '\n')) {
    return false
  }
  let parts = s.split("@").to_array()
  guard parts.length() == 2 && parts[0].length() > 0 else { return false }
  let domain = parts[1].to_owned()
  match domain.find(".") {
    Some(i) =>
      i > 0 &&
      i < domain.length() - 1 &&
      domain.rev_find(".").unwrap() < domain.length() - 1
    None => false
  }
}

///|
fn is_uri(s : String) -> Bool {
  match s.find("://") {
    Some(i) if i > 0 => {
      let scheme = s.view(end_offset=i)
      let first = scheme.get_char(0).unwrap()
      ((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z')) &&
      scheme
      .iter()
      .all(c => {
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        is_digit(c) ||
        c is ('+' | '.' | '-')
      }) &&
      s.length() > i + 3 &&
      !s.view(start_offset=i + 3).iter().any(c => c is (' ' | '\t' | '\n'))
    }
    _ => false
  }
}

///|
fn format_of(s : String) -> String? {
  if is_date_time(s) {
    Some("date-time")
  } else if is_date(s) {
    Some("date")
  } else if is_email(s) {
    Some("email")
  } else if is_uri(s) {
    Some("uri")
  } else {
    None
  }
}

///|
fn typed(t : String) -> Map[String, Json] {
  { "type": Json::string(t) }
}

///|
pub fn infer_schema(value : Json) -> Json {
  match value {
    Null => Json::object(typed("null"))
    True | False => Json::object(typed("boolean"))
    Number(n, ..) =>
      Json::object(
        typed(
          if n == @math.round(n) && n.abs() < 9007199254740992.0 {
            "integer"
          } else {
            "number"
          },
        ),
      )
    String(s) =>
      match format_of(s) {
        Some(f) => { "type": "string", "format": Json::string(f) }
        None => Json::object(typed("string"))
      }
    Array(items) =>
      if items.is_empty() {
        Json::object(typed("array"))
      } else {
        let schemas = items.map(infer_schema)
        let mut merged = schemas[0]
        for s in schemas[1:] {
          merged = merge(merged, s)
        }
        { "type": "array", "items": merged }
      }
    Object(fields) => {
      let properties = Map([])
      for f in fields {
        properties[f.0] = infer_schema(f.1)
      }
      {
        "type": "object",
        "properties": Json::object(properties),
        "required": Json::array(fields.keys().map(Json::string).to_array()),
      }
    }
  }
}

///|
fn get(j : Json, key : String) -> Json? {
  match j {
    Object(m) => m.get(key)
    _ => None
  }
}

///|
fn type_of(j : Json) -> String {
  match get(j, "type") {
    Some(String(t)) => t
    _ => ""
  }
}

///|
fn is_numeric(t : String) -> Bool {
  t is ("integer" | "number")
}

///|
fn same_kind(x : String, y : String) -> Bool {
  x == y || (is_numeric(x) && is_numeric(y))
}

///|
fn branches_of(s : Json) -> Array[Json] {
  match get(s, "anyOf") {
    Some(Array(bs)) => bs
    _ => [s]
  }
}

///|
/// One schema for two that describe values of the same place.
fn merge(a : Json, b : Json) -> Json {
  if a == b {
    return a
  }
  let (ta, tb) = (type_of(a), type_of(b))
  if is_numeric(ta) && is_numeric(tb) {
    return Json::object(typed("number"))
  }
  if ta == "string" && tb == "string" {
    return Json::object(typed("string")) // Formats differ.
  }
  if ta == "array" && tb == "array" {
    return match (get(a, "items"), get(b, "items")) {
      (None, _) => b
      (_, None) => a
      (Some(ia), Some(ib)) => { "type": "array", "items": merge(ia, ib) }
    }
  }
  if ta == "object" && tb == "object" {
    let pa = match get(a, "properties") {
      Some(Object(m)) => m
      _ => Map([])
    }
    let pb = match get(b, "properties") {
      Some(Object(m)) => m
      _ => Map([])
    }
    let properties = Map([])
    for p in pa {
      properties[p.0] = p.1
    }
    for p in pb {
      properties[p.0] = match properties.get(p.0) {
        Some(x) => merge(x, p.1)
        None => p.1
      }
    }
    let required_b = match get(b, "required") {
      Some(Array(r)) => r
      _ => []
    }
    let required = match get(a, "required") {
      Some(Array(r)) => r.filter(k => required_b.contains(k))
      _ => []
    }
    return {
      "type": "object",
      "properties": Json::object(properties),
      "required": Json::array(required),
    }
  }
  // Different types: a union, merging into the branch of the same type when there is one.
  let branches = branches_of(a).copy()
  for s in branches_of(b) {
    match branches.search_by(x => same_kind(type_of(x), type_of(s))) {
      Some(i) => branches[i] = merge(branches[i], s)
      None => branches.push(s)
    }
  }
  if branches.length() == 1 {
    branches[0]
  } else {
    { "anyOf": Json::array(branches) }
  }
}

///|
/// The schema as a document: $schema and title first.
pub fn schema_document(schema : Json, title : String) -> Json {
  let out : Map[String, Json] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
  }
  if title != "" {
    out["title"] = Json::string(title)
  }
  if schema is Object(m) {
    for e in m {
      out[e.0] = e.1
    }
  }
  Json::object(out)
}

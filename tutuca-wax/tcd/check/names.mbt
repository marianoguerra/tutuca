// Names reach the runtime as the .tcd writes them: members and views in
// snake_case, types in PascalCase. Only Wax spells them differently: every
// identifier there is snake_case (a type's too, TodoItem's todo_item), with
// keywords escaped.

///|
pub fn is_snake_case(s : String) -> Bool {
  if s.is_empty() {
    return false
  }
  for i, c in s.to_array() {
    let ok = (c >= 'a' && c <= 'z') ||
      (c >= '0' && c <= '9' && i > 0) ||
      (c == '_' && i > 0)
    if !ok {
      return false
    }
  }
  true
}

///|
/// A type name: PascalCase, an uppercase letter then letters and digits, no
/// two uppercase letters in a row (Json, not JSON), so snake(s) reads it back.
pub fn is_pascal_case(s : String) -> Bool {
  if s.is_empty() {
    return false
  }
  let mut prev_upper = false
  for i, c in s.to_array() {
    let upper = c >= 'A' && c <= 'Z'
    let ok = if i == 0 {
      upper
    } else {
      upper || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
    }
    if !ok || (upper && prev_upper) {
      return false
    }
    prev_upper = upper
  }
  true
}

///|
/// TodoItem -> todo_item; a snake_case name is itself.
pub fn snake(s : String) -> String {
  let sb = StringBuilder()
  for i, c in s.to_array() {
    if c >= 'A' && c <= 'Z' {
      if i > 0 {
        sb.write_char('_')
      }
      sb.write_char(c.to_ascii_lowercase())
    } else {
      sb.write_char(c)
    }
  }
  sb.to_string()
}

///|
/// Wax's keywords (wax-mb's lib/syntax/lexer/tables.mbt), and a few more
/// kept out of the way.
let wax_keywords : Array[String] = [
  "as", "br", "const", "do", "else", "export", "fn", "if", "import", "let", "loop",
  "match", "mut", "null", "open", "rec", "return", "struct", "type", "unreachable",
  "while", "tag", "try", "catch", "throw", "self", "true", "false", "nop", "dispatch",
  "inf", "nan", "is", "become", "br_if", "br_table", "br_on_null", "br_on_non_null",
  "br_on_cast", "br_on_cast_fail", "try_legacy", "throw_ref", "cont", "suspend",
  "on", "memory", "pagesize", "shared", "descriptor", "describes",
]

///|
/// A TCD name as part of a longer Wax identifier (c_on_open): snake_case.
pub fn wax_part(s : String) -> String {
  snake(s)
}

///|
/// s as a Wax identifier of its own (a parameter, a struct field, a local):
/// snake_case, with _ after a keyword (type_). Part of a longer name
/// (c_on_open), it's wax_part's, which needs no escaping.
pub fn wax(s : String) -> String {
  let s = snake(s)
  if wax_keywords.contains(s) {
    s + "_"
  } else {
    s
  }
}

///|
/// The closest of candidates to s, when one is close enough to be a typo.
pub fn closest(s : String, candidates : Array[String]) -> String? {
  let mut best : String? = None
  let mut best_d = 1000
  for c in candidates {
    let d = edit_distance(s, c)
    if d < best_d {
      best_d = d
      best = Some(c)
    }
  }
  let limit = if s.length() <= 3 { 1 } else { 2 }
  if best_d <= limit {
    best
  } else {
    None
  }
}

///|
fn edit_distance(a : String, b : String) -> Int32 {
  let a = a.to_array()
  let b = b.to_array()
  let prev = Array::makei(b.length() + 1, i => i)
  for i in 0..<a.length() {
    let cur = Array::make(b.length() + 1, 0)
    cur[0] = i + 1
    for j in 0..<b.length() {
      let cost = if a[i] == b[j] { 0 } else { 1 }
      cur[j + 1] = @cmp.minimum(
        @cmp.minimum(prev[j + 1] + 1, cur[j] + 1),
        prev[j] + cost,
      )
    }
    for j in 0..<=b.length() {
      prev[j] = cur[j]
    }
  }
  prev[b.length()]
}

///|
/// ", did you mean x?" for a name not found among candidates, or "".
pub fn did_you_mean(s : String, candidates : Array[String]) -> String {
  match closest(s, candidates) {
    Some(c) => "; did you mean \{c}?"
    None => ""
  }
}

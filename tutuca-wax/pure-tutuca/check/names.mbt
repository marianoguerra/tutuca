// Names reach the runtime as a module writes them, and Wax too: a
// component's functions are its name, then what they are, then the member's
// name (KanbanLane_on_addCard), with keywords escaped where a name stands
// alone. And the closest name to one that isn't found, for messages.

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
/// s as a Wax identifier of its own (a parameter, a struct field, a local):
/// as written, with _ after a keyword (type_). Part of a longer name
/// (C_on_open), it needs no escaping.
pub fn wax(s : String) -> String {
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

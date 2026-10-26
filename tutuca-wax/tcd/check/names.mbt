// One name, three spellings: snake_case in TCD and in Wax (with keywords
// escaped), camelCase for the runtime strings members go by (what events
// send, property names), PascalCase for type names.

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
/// set_text -> setText.
pub fn camel(s : String) -> String {
  let sb = StringBuilder()
  let mut up = false
  for c in s {
    if c == '_' {
      up = true
    } else if up {
      sb.write_char(c.to_ascii_uppercase())
      up = false
    } else {
      sb.write_char(c)
    }
  }
  sb.to_string()
}

///|
/// json_number -> JsonNumber.
pub fn pascal(s : String) -> String {
  let c = camel(s)
  if c.is_empty() {
    return c
  }
  let chars = c.to_array()
  chars[0] = chars[0].to_ascii_uppercase()
  String::from_array(chars)
}

///|
let wax_keywords : Array[String] = [
  "as", "br", "const", "do", "else", "export", "fn", "if", "import", "let", "loop",
  "match", "mut", "null", "open", "rec", "return", "struct", "type", "unreachable",
  "while", "tag", "try", "catch", "throw", "self", "true", "false", "nop", "dispatch",
]

///|
/// A TCD name as a Wax identifier: itself, unless it's a Wax keyword.
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

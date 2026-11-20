// Constraints: a field's or an argument's, as the module's `constraints`
// data says them (int, min, max, minLength, maxLength, pattern, keyOf), in
// the form the runtime's constraint arrays are built from, and what they mean
// for a value known before anything runs.

///|
fn bound_text(b : Bound, lower : Bool) -> String {
  let n = num_text(b.value)
  match (lower, b.exclusive) {
    (true, true) => "above \{n}"
    (true, false) => "at least \{n}"
    (false, true) => "below \{n}"
    (false, false) => "at most \{n}"
  }
}

///|
fn num_text(d : Double) -> String {
  if d == d.floor() && d.abs() < 1.0e15 {
    d.to_int64().to_string()
  } else {
    d.to_string()
  }
}

///|
fn json_number(j : Json?) -> Double? {
  match j {
    Some(Number(n, ..)) => Some(n)
    _ => None
  }
}

///|
/// A constraints object (`{ int: true, min: 0, maxLength: 80, pattern: "^a",
/// keyOf: "items" }`) as a Norm; what isn't a constraint is left out (pure-js
/// typed the object already).
pub fn norm_of_json(c : Json?) -> Norm {
  let n = Norm::new()
  guard c is Some(Object(m)) else { return n }
  if m.get("int") is Some(True) {
    n.int = true
  }
  if json_number(m.get("min")) is Some(v) {
    n.lo = Some({ value: v, exclusive: false, })
  }
  if json_number(m.get("max")) is Some(v) {
    n.hi = Some({ value: v, exclusive: false, })
  }
  if json_number(m.get("minLength")) is Some(v) {
    n.len_lo = Some(v.to_int())
  }
  if json_number(m.get("maxLength")) is Some(v) {
    n.len_hi = Some(v.to_int())
  }
  if m.get("pattern") is Some(String(p)) {
    n.patterns.push(p)
  }
  if m.get("keyOf") is Some(String(f)) {
    n.key_of.push(f)
  }
  n
}

///|
/// Why no value can meet n, in words, or None.
pub fn contradiction(n : Norm) -> String? {
  if n.lo is Some(lo) && n.hi is Some(hi) {
    if lo.value > hi.value ||
      (lo.value == hi.value && (lo.exclusive || hi.exclusive)) {
      return Some(
        "it must be \{bound_text(lo, true)} and \{bound_text(hi, false)}",
      )
    }
  }
  if n.len_lo is Some(lo) && n.len_hi is Some(hi) && lo > hi {
    return Some("its length must be at least \{lo} and at most \{hi}")
  }
  None
}

///|
/// n in words: "at least 1 and at most 10".
pub fn norm_text(n : Norm) -> String {
  let parts = []
  if n.int {
    parts.push("a whole number")
  }
  if n.lo is Some(b) {
    parts.push(bound_text(b, true))
  }
  if n.hi is Some(b) {
    parts.push(bound_text(b, false))
  }
  if n.len_lo is Some(v) {
    parts.push("of length at least \{v}")
  }
  if n.len_hi is Some(v) {
    parts.push("of length at most \{v}")
  }
  for p in n.patterns {
    parts.push("matching \{p.escape()}")
  }
  for f in n.key_of {
    parts.push("a key of \{f}")
  }
  if parts.is_empty() {
    "anything of its type"
  } else {
    parts.join(" and ")
  }
}

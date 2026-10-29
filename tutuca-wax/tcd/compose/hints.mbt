// Hints on Wax's diagnostics where the message leaves the fix unsaid: the
// operators i32s take (<s, /s, %s) where a model writes the f64 ones, and
// and/or, else if, address-of, true/false, casts and names that don't
// exist. Each is keyed by the message and the source text where it points,
// so the playground, the studio's assistant and the command all get them.

///|
let i32_ops_hint : String = "on i32s, compare with <s <=s >s >=s (== and != as they are), divide with /s, take the remainder with %s; < <= > >= and / are f64's"

///|
let mix_hint : String = "an i32 and an f64 don't mix: n as f64_s makes an f64 of an i32, x as i32_s an i32 of an f64 (truncated); x.floor(), x.ceil() and x.nearest() round an f64 first. A literal with a dot is an f64, and / is f64 division: i32s divide with /s"

///|
let cast_hint : String = "as converts numbers through the signed types: x as i32_s (an f64 truncated to an i32, saturating), n as f64_s (an i32 as an f64); round first with x.floor(), x.ceil() or x.nearest()"

///|
let and_or_hint : String = "Wax's and and or are & and |, on i32s (0 or 1), and both sides are evaluated: (a == 1) & (b == 2)"

///|
let else_if_hint : String = "there's no else if: write if c { ...; return x; } and then the next if, or nest the if inside else { ... }"

///|
let address_hint : String = "there's no address-of: a struct literal ({t| ... }) already is a reference (&t), so return it, or the local holding it, as it is"

///|
let bool_hint : String = "booleans are i32s: 1 for true, 0 for false"

///|
let type_hint : String = "the value types are i32, i64, f64, js_string, js_string_opt, &T and &?T (a struct or a runtime type like &value), and the aliases you declare with type"

///|
let remainder_hint : String = "the remainder of i32s is %s (signed): n %s 2"

///|
/// The line of text at line (1-based), "" past its end.
fn line_at(text : String, line : Int32) -> String {
  let lines = text.split("\n").collect()
  if line < 1 || line > lines.length() {
    return ""
  }
  lines[line - 1].to_owned()
}

///|
/// What's on span's line from its column on, and what's before it there.
fn around(text : String, span : @diag.Span) -> (String, String) {
  let l = line_at(text, span.start.line)
  let col = span.start.col - 1
  if col < 0 || col > l.length() {
    return ("", "")
  }
  (
    l.unsafe_substring(start=col, end=l.length()),
    l.unsafe_substring(start=0, end=col),
  )
}

///|
/// The name a "The variable 'x' is not bound." message is about.
fn unbound_name(message : String) -> String? {
  let prefix = "The variable '"
  guard message.has_prefix(prefix) && message.has_suffix("' is not bound.") else {
    return None
  }
  Some(
    message.unsafe_substring(
      start=prefix.length(),
      end=message.length() - "' is not bound.".length(),
    ),
  )
}

///|
/// The functions and constants the sources declare, and the runtime's
/// exports (#[export = "name"]): what a name a .wax uses may have meant.
fn declared_names(texts : Array[String]) -> Array[String] {
  let out = []
  for text in texts {
    for line in text.split("\n") {
      let l = line.trim(chars=" \t").to_owned()
      let marker = "#[export = \""
      if l.has_prefix(marker) && l.has_suffix("\"]") {
        let name = l.unsafe_substring(start=marker.length(), end=l.length() - 2)
        if !out.contains(name) {
          out.push(name)
        }
        continue
      }
      for prefix in ["fn ", "const "] {
        if l.has_prefix(prefix) {
          let rest = l.unsafe_substring(start=prefix.length(), end=l.length())
          let mut end = 0
          while end < rest.length() &&
                (rest[end].to_int().is_ascii_alphanumeric() || rest[end] == '_') {
            end += 1
          }
          if end > 0 {
            let name = rest.unsafe_substring(start=0, end~)
            if !out.contains(name) {
              out.push(name)
            }
          }
        }
      }
    }
  }
  out
}

///|
fn Int32::is_ascii_alphanumeric(self : Int32) -> Bool {
  (self >= 'a'.to_int() && self <= 'z'.to_int()) ||
  (self >= 'A'.to_int() && self <= 'Z'.to_int()) ||
  (self >= '0'.to_int() && self <= '9'.to_int())
}

///|
/// The hint for a Wax diagnostic's message, given what's at and before where
/// it points, and the names declared (for one that isn't), or None.
fn wax_hint(
  message : String,
  at : String,
  before : String,
  names : Array[String],
) -> String? {
  // 'i32' and 'i32' once wax-mb checks two i32s as its reference does.
  if message.contains("'i32' and 'number'") ||
    message.contains("'number' and 'i32'") ||
    message.contains("'i32' and 'i32'") {
    return Some(i32_ops_hint)
  }
  if message.contains("'f64' and 'i32'") ||
    message.contains("'i32' and 'f64'") ||
    message.contains("type 'f64' but is expected to have type 'i32'") ||
    message.contains("type 'i32' but is expected to have type 'f64'") {
    return Some(mix_hint)
  }
  if message.contains("cannot be cast to the target type") {
    return Some(cast_hint)
  }
  if message.contains("Unexpected character '%'") {
    return Some(remainder_hint)
  }
  if message.contains("Expecting an expression") &&
    (
      at.has_prefix("&&") ||
      at.has_prefix("||") ||
      (before.has_suffix("&") && at.has_prefix("&")) ||
      (before.has_suffix("|") && at.has_prefix("|"))
    ) {
    return Some(and_or_hint)
  }
  if message.contains("Expecting a block") && at.has_prefix("if") {
    return Some(else_if_hint)
  }
  if message.contains("expecting '}'") && at.has_prefix("&") {
    return Some(address_hint)
  }
  if message.contains("is not a value type or a type alias") {
    return Some(type_hint)
  }
  match unbound_name(message) {
    Some("true") | Some("false") => Some(bool_hint)
    Some(name) if name.has_prefix("gs_") || name.has_prefix("gt_") =>
      Some(
        "tcd generates a gs_ or gt_ constant only for a name or text the .tcd has; declare a string of your own in the .wax's import \"'\" block (#[import = \"...\"] const s_name: js_string;)",
      )
    Some(name) =>
      match @check.closest(name, names) {
        Some(close) => Some("did you mean \{close}?")
        None => {
          // max for int_max: a name the runtime gives with a prefix.
          let prefixed = names.filter(n => {
            n.has_suffix("_\{name}") && !n.has_prefix("abi_")
          })
          prefixed.sort_by((a, b) => a.length() - b.length())
          if prefixed.is_empty() {
            Some(
              "it's neither a function the runtime gives (the reference lists them) nor a name the .tcd generates or the .wax declares",
            )
          } else {
            let shown = if prefixed.length() > 2 {
              2
            } else {
              prefixed.length()
            }
            Some("did you mean \{prefixed[:shown].to_owned().join(" or ")}?")
          }
        }
      }
    None => None
  }
}

///|
/// diags with hints on Wax's diagnostics where tcd has one, read against the
/// sources (by path) and the names they declare. A hint Wax gave is kept.
fn with_hints(
  diags : Array[@diag.Diagnostic],
  sources : Array[Source],
) -> Array[@diag.Diagnostic] {
  let texts : Map[String, String] = Map([])
  for s in sources {
    texts[s.path] = s.text
  }
  let names = declared_names(sources.map(s => s.text))
  diags.map(d => {
    if !d.code.has_prefix("wax") {
      return d
    }
    let (at, before) = match texts.get(d.span.file) {
      Some(text) => around(text, d.span)
      None => ("", "")
    }
    match wax_hint(d.message, at, before, names) {
      None => d
      Some(h) =>
        {
          ..d,
          hint: Some(
            match d.hint {
              Some(given) => "\{given}; \{h}"
              None => h
            },
          ),
        }
    }
  })
}

///|
/// Where the implementation uses an operator that's f64's when it's written
/// between spaces (< <= > >= / %): what to look at when the module didn't
/// lower and Wax didn't say where (an i32 compared with < does that).
fn f64_operators(impls : Array[Source]) -> Array[@diag.Related] {
  let out = []
  for s in impls {
    for i, view in s.text.split("\n").collect() {
      let line = view.to_owned()
      let code = match line.find("//") {
        Some(c) => line.unsafe_substring(start=0, end=c)
        None => line
      }
      if code.contains("#[import") {
        continue
      }
      for op in [" < ", " <= ", " > ", " >= ", " / ", " % "] {
        match code.find(op) {
          Some(c) => {
            let col = c + 2
            let pos = (n : Int32) => @diag.Pos::{
              line: i + 1,
              col: n,
              offset: -1,
            }
            out.push(@diag.Related::{
              span: {
                file: s.path,
                start: pos(col),
                end: pos(col + op.length() - 2),
              },
              message: "\{op.trim(chars=" ")} here: on i32s it's \{op.trim(chars=" ")}s",
            })
          }
          None => ()
        }
      }
    }
  }
  out
}

// Tokens of pure-js source, as the reference's lib/lex.js: names are ASCII,
// there are no regular expressions (a / is always division), and template
// literals are lexed here with a stack of open braces, so lookahead is copying
// the lexer's state.

///|
#derive(Eq, Debug)
pub(all) enum Kind {
  Name
  Num
  Str
  Template
  Punct
  Eof
}

///|
#derive(Debug)
pub(all) struct Token {
  kind : Kind
  /// The name, the punctuator, the cooked string or template text.
  text : String
  /// A number's value.
  number : Double
  start : Int32
  end : Int32
  newline_before : Bool
  /// num, string, template: the source text of the value.
  raw : String
  /// template: starts with a backtick (else with a brace), ends with one
  /// (else with ${), and where its text starts and ends.
  head : Bool
  tail : Bool
  value_start : Int32
  value_end : Int32
}

///|
fn token(
  kind : Kind,
  text : String,
  start : Int32,
  end : Int32,
  newline : Bool,
) -> Token {
  {
    kind,
    text,
    number: 0.0,
    start,
    end,
    newline_before: newline,
    raw: "",
    head: false,
    tail: false,
    value_start: start,
    value_end: end,
  }
}

///|
pub(all) struct Lexer {
  src : String
  mut pos : Int32
  /// "{" for a brace, "${" for a template substitution.
  mut braces : Array[String]
}

///|
pub fn Lexer::new(src : String) -> Lexer {
  { src, pos: 0, braces: [], }
}

///|
pub fn Lexer::save(self : Lexer) -> (Int32, Array[String]) {
  (self.pos, self.braces.copy())
}

///|
pub fn Lexer::restore(self : Lexer, state : (Int32, Array[String])) -> Unit {
  self.pos = state.0
  self.braces = state.1.copy()
}

///|
let punctuators : Array[String] = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>",
  "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=",
  "%=", "&=", "|=", "^=", "**", "<<", ">>", "{", "}", "(", ")", "[", "]", ";", ",",
  "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "?", ":", "=", ".",
  "@", "#",
]

///|
fn Lexer::at(self : Lexer, i : Int32) -> Int32 {
  if i >= 0 && i < self.src.length() {
    self.src[i].to_int()
  } else {
    -1
  }
}

///|
fn is_digit(c : Int32) -> Bool {
  c >= '0'.to_int() && c <= '9'.to_int()
}

///|
fn is_name_start(c : Int32) -> Bool {
  (c >= 'a'.to_int() && c <= 'z'.to_int()) ||
  (c >= 'A'.to_int() && c <= 'Z'.to_int()) ||
  c == '_'.to_int() ||
  c == '$'.to_int()
}

///|
fn is_name_part(c : Int32) -> Bool {
  is_name_start(c) || is_digit(c)
}

///|
fn is_hex(c : Int32) -> Bool {
  is_digit(c) ||
  (c >= 'a'.to_int() && c <= 'f'.to_int()) ||
  (c >= 'A'.to_int() && c <= 'F'.to_int())
}

///|
fn is_newline(c : Int32) -> Bool {
  c == 10 || c == 13 || c == 0x2028 || c == 0x2029
}

///|
fn is_space(c : Int32) -> Bool {
  c == 32 || c == 9 || c == 11 || c == 12 || c == 0xa0 || c == 0xfeff
}

///|
/// A non-ASCII code unit that could start or continue a name: anything past
/// ASCII that isn't a space or a control character (the reference asks
/// Unicode's ID_Start; either way it is rejected, only the message differs).
fn is_unicode_letter(c : Int32) -> Bool {
  c > 127 &&
  !is_space(c) &&
  !is_newline(c) &&
  !Int32::unsafe_to_char(c).is_control()
}

///|
/// How many code units the character at i takes: two for a surrogate pair
/// (a character past the BMP, an emoji), which a slice can't split.
fn Lexer::char_width(self : Lexer, i : Int32) -> Int32 {
  let c = self.at(i)
  let d = self.at(i + 1)
  if c >= 0xD800 && c <= 0xDBFF && d >= 0xDC00 && d <= 0xDFFF {
    2
  } else {
    1
  }
}

///|
fn Lexer::slice(self : Lexer, start : Int32, end : Int32) -> String {
  self.src.exact_view(start~, end~).to_owned()
}

///|
fn Lexer::starts_with(self : Lexer, p : String, at : Int32) -> Bool {
  if at + p.length() > self.src.length() {
    return false
  }
  for i in 0..<p.length() {
    if self.src[at + i] != p[i] {
      return false
    }
  }
  true
}

///|
/// Skips spaces and comments; true when it crossed a line break.
fn Lexer::skip(self : Lexer) -> Bool raise @diag.Stop {
  let n = self.src.length()
  let mut newline = false
  while self.pos < n {
    let c = self.at(self.pos)
    if is_newline(c) {
      newline = true
      self.pos += 1
    } else if is_space(c) {
      self.pos += 1
    } else if c == '/'.to_int() && self.at(self.pos + 1) == '/'.to_int() {
      while self.pos < n && !is_newline(self.at(self.pos)) {
        self.pos += 1
      }
    } else if c == '/'.to_int() && self.at(self.pos + 1) == '*'.to_int() {
      let mut close = -1
      for i in (self.pos + 2)..<(n - 1) {
        if self.at(i) == '*'.to_int() && self.at(i + 1) == '/'.to_int() {
          close = i
          break
        }
      }
      if close == -1 {
        raise @diag.syntax_error(
          "unterminated comment",
          self.pos,
          end=self.pos + 2,
        )
      }
      for i in self.pos..<close {
        if is_newline(self.at(i)) {
          newline = true
        }
      }
      self.pos = close + 2
    } else if c == '<'.to_int() && self.starts_with("<!--", self.pos) {
      raise @diag.syntax_error(
        "HTML comments are not JavaScript in strict mode",
        self.pos,
        end=self.pos + 4,
      )
    } else {
      break
    }
  }
  newline
}

///|
pub fn Lexer::next(self : Lexer) -> Token raise @diag.Stop {
  let newline = self.skip()
  let start = self.pos
  if start >= self.src.length() {
    return token(Eof, "", start, start, newline)
  }
  let c = self.at(start)
  if is_name_start(c) {
    return self.name(start, newline)
  }
  if c == '\\'.to_int() {
    raise @diag.excluded_at(IdentifierEscape, start, start + 2)
  }
  if is_unicode_letter(c) {
    raise @diag.excluded_at(IdentifierEscape, start, start + 1)
  }
  if is_digit(c) || (c == '.'.to_int() && is_digit(self.at(start + 1))) {
    return self.number(start, newline)
  }
  if c == '"'.to_int() || c == '\''.to_int() {
    return self.string(start, newline)
  }
  if c == '`'.to_int() {
    return self.template(start, start + 1, true, newline)
  }
  if c == '}'.to_int() && self.braces.last() == Some("${") {
    ignore(self.braces.pop())
    return self.template(start, start + 1, false, newline)
  }
  for p in punctuators {
    if !self.starts_with(p, start) {
      continue
    }
    // a?.5:1 is a conditional, not a chain.
    if p == "?." && is_digit(self.at(start + 2)) {
      continue
    }
    self.pos = start + p.length()
    if p == "{" {
      self.braces.push("{")
    }
    if p == "}" {
      ignore(self.braces.pop())
    }
    return token(Punct, p, start, self.pos, newline)
  }
  raise @diag.syntax_error(
    "unexpected character \{self.slice(start, start + 1).escape()}",
    start,
  )
}

///|
fn Lexer::name(
  self : Lexer,
  start : Int32,
  newline : Bool,
) -> Token raise @diag.Stop {
  let mut i = start
  while i < self.src.length() && is_name_part(self.at(i)) {
    i += 1
  }
  if self.at(i) == '\\'.to_int() {
    raise @diag.excluded_at(IdentifierEscape, i, i + 2)
  }
  if is_unicode_letter(self.at(i)) {
    raise @diag.excluded_at(IdentifierEscape, i, i + 1)
  }
  self.pos = i
  token(Name, self.slice(start, i), start, i, newline)
}

///|
fn Lexer::number(
  self : Lexer,
  start : Int32,
  newline : Bool,
) -> Token raise @diag.Stop {
  let n = self.src.length()
  let mut i = start
  // Digits that ok accepts, with _ between two of them.
  let digits = (ok : (Int32) -> Bool) => {
    let from = i
    while i < n &&
          (
            ok(self.at(i)) ||
            (
              self.at(i) == '_'.to_int() &&
              ok(self.at(i - 1)) &&
              ok(self.at(i + 1))
            )
          ) {
      i += 1
    }
    i > from
  }
  let mut base = 10
  if self.at(i) == '0'.to_int() &&
    "xXoObB".contains_char(Int32::unsafe_to_char(self.at(i + 1).max(0))) {
    let b = Int32::unsafe_to_char(self.at(i + 1)).to_ascii_lowercase()
    base = if b == 'x' { 16 } else if b == 'o' { 8 } else { 2 }
    i += 2
    let ok = if base == 16 {
      is_hex
    } else if base == 8 {
      c => c >= '0'.to_int() && c <= '7'.to_int()
    } else {
      c => c == '0'.to_int() || c == '1'.to_int()
    }
    if !digits(ok) {
      raise @diag.syntax_error(
        "expected digits after the base prefix",
        start,
        end=i,
      )
    }
  } else {
    if self.at(i) == '0'.to_int() && is_digit(self.at(i + 1)) {
      raise @diag.excluded_at(LegacyOctal, start, start + 2)
    }
    ignore(digits(is_digit))
    if self.at(i) == '.'.to_int() {
      i += 1
      ignore(digits(is_digit))
    }
    if self.at(i) == 'e'.to_int() || self.at(i) == 'E'.to_int() {
      i += 1
      if self.at(i) == '+'.to_int() || self.at(i) == '-'.to_int() {
        i += 1
      }
      if !digits(is_digit) {
        raise @diag.syntax_error(
          "expected digits in the exponent",
          start,
          end=i,
        )
      }
    }
  }
  if self.at(i) == 'n'.to_int() {
    raise @diag.excluded_at(Bigint, start, i + 1)
  }
  if i < n && (is_name_part(self.at(i)) || self.at(i) == '\\'.to_int()) {
    raise @diag.syntax_error("a number can't be followed by a letter", i)
  }
  self.pos = i
  let raw = self.slice(start, i)
  let clean = raw.replace_all(old="_", new="")
  let value = if base == 10 {
    let text = if clean.has_prefix(".") { "0" + clean } else { clean }
    @string.parse_double(text) catch {
      _ => raise @diag.syntax_error("bad number", start, end=i)
    }
  } else {
    let mut v = 0.0
    for k in 2..<clean.length() {
      let d = Int32::unsafe_to_char(clean[k].to_int()).to_ascii_lowercase()
      let dv = if d >= '0' && d <= '9' {
        d.to_int() - '0'.to_int()
      } else {
        d.to_int() - 'a'.to_int() + 10
      }
      v = v * base.to_double() + dv.to_double()
    }
    v
  }
  { ..token(Num, raw, start, i, newline), number: value, raw, }
}

///|
/// One escape at i (the backslash): its text and the index after it.
fn Lexer::escape(self : Lexer, i : Int32) -> (String, Int32) raise @diag.Stop {
  let c = self.at(i + 1)
  if c == -1 {
    raise @diag.syntax_error("unterminated string", i)
  }
  let ch = Int32::unsafe_to_char(c)
  match ch {
    'n' => return ("\n", i + 2)
    't' => return ("\t", i + 2)
    'r' => return ("\r", i + 2)
    'b' => return ("\u{8}", i + 2)
    'f' => return ("\u{c}", i + 2)
    'v' => return ("\u{b}", i + 2)
    '\'' | '"' | '\\' | '`' | '$' => return (ch.to_string(), i + 2)
    _ => ()
  }
  if ch == '0' && !is_digit(self.at(i + 2)) {
    return ("\u{0}", i + 2)
  }
  if is_digit(c) {
    raise @diag.excluded_at(LegacyOctal, i, i + 2)
  }
  if c == 13 {
    return ("", if self.at(i + 2) == 10 { i + 3 } else { i + 2 })
  }
  if is_newline(c) {
    return ("", i + 2)
  }
  let hex = (from : Int32, len : Int32) => {
    let mut v = 0
    for k in from..<(from + len) {
      let d = self.at(k)
      if !is_hex(d) {
        return None
      }
      let dc = Int32::unsafe_to_char(d).to_ascii_lowercase()
      v = v * 16 +
        (if dc >= '0' && dc <= '9' {
          dc.to_int() - '0'.to_int()
        } else {
          dc.to_int() - 'a'.to_int() + 10
        })
    }
    Some(v)
  }
  if ch == 'x' {
    match hex(i + 2, 2) {
      Some(v) => return (String::make(1, Int32::unsafe_to_char(v)), i + 4)
      None => raise @diag.syntax_error("bad \\x escape", i, end=i + 4)
    }
  }
  if ch == 'u' {
    if self.at(i + 2) == '{'.to_int() {
      let mut close = -1
      for k in (i + 3)..<self.src.length() {
        if self.at(k) == '}'.to_int() {
          close = k
          break
        }
      }
      let cp = if close > i + 3 { hex(i + 3, close - i - 3) } else { None }
      match cp {
        Some(v) if v <= 0x10ffff =>
          return (String::make(1, Int32::unsafe_to_char(v)), close + 1)
        _ => raise @diag.syntax_error("bad \\u{} escape", i, end=close + 1)
      }
    }
    match hex(i + 2, 4) {
      Some(v) => {
        // A lone surrogate stays one code unit, as in JavaScript.
        let sb = StringBuilder()
        sb.write_char(Int32::unsafe_to_char(v))
        return (sb.to_string(), i + 6)
      }
      None => raise @diag.syntax_error("bad \\u escape", i, end=i + 6)
    }
  }
  // A needless escape stands for its character.
  (self.slice(i + 1, i + 2), i + 2)
}

///|
fn Lexer::string(
  self : Lexer,
  start : Int32,
  newline : Bool,
) -> Token raise @diag.Stop {
  let quote = self.at(start)
  let mut i = start + 1
  let value = StringBuilder()
  while true {
    let c = self.at(i)
    if c == -1 || c == 10 || c == 13 {
      raise @diag.syntax_error("unterminated string", start, end=i)
    }
    if c == quote {
      break
    }
    if c == '\\'.to_int() {
      let (text, after) = self.escape(i)
      value.write_string(text)
      i = after
    } else {
      let w = self.char_width(i)
      value.write_string(self.slice(i, i + w))
      i += w
    }
  }
  self.pos = i + 1
  let raw = self.slice(start, self.pos)
  { ..token(Str, value.to_string(), start, self.pos, newline), raw, }
}

///|
/// A template chunk from value_start (after ` or }) to the next ` or ${.
fn Lexer::template(
  self : Lexer,
  start : Int32,
  value_start : Int32,
  head : Bool,
  newline : Bool,
) -> Token raise @diag.Stop {
  let mut i = value_start
  let cooked = StringBuilder()
  while true {
    let c = self.at(i)
    if c == -1 {
      raise @diag.syntax_error("unterminated template literal", start, end=i)
    }
    if c == '`'.to_int() ||
      (c == '$'.to_int() && self.at(i + 1) == '{'.to_int()) {
      break
    }
    if c == '\\'.to_int() {
      let (text, after) = self.escape(i)
      cooked.write_string(text)
      i = after
    } else if c == 13 {
      cooked.write_string("\n")
      i += if self.at(i + 1) == 10 { 2 } else { 1 }
    } else {
      let w = self.char_width(i)
      cooked.write_string(self.slice(i, i + w))
      i += w
    }
  }
  let tail = self.at(i) == '`'.to_int()
  let end = if tail { i + 1 } else { i + 2 }
  let raw = self
    .slice(value_start, i)
    .replace_all(old="\r\n", new="\n")
    .replace_all(old="\r", new="\n")
  if !tail {
    self.braces.push("${")
  }
  self.pos = end
  {
    ..token(Template, cooked.to_string(), start, end, newline),
    raw,
    head,
    tail,
    value_start,
    value_end: i,
  }
}

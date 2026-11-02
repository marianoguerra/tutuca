///|
/// A decode failure, with the reason and the position in plain words.
pub(all) suberror DecodeError {
  DecodeError(String)
}

///|
pub fn DecodeError::message(self : DecodeError) -> String {
  match self {
    DecodeError(s) => s
  }
}

///|
pub fn decode_value(text : String) -> @model.Value raise DecodeError {
  let r = Reader::{ text, pos: 0, }
  let v = r.value()
  r.end()
  v
}

///|
pub fn decode_message(text : String) -> @model.Message raise DecodeError {
  let r = Reader::{ text, pos: 0, }
  let m = r.message()
  r.end()
  m
}

///|
priv struct Reader {
  text : String
  mut pos : Int32
}

///|
fn Reader::fail(self : Reader, what : String) -> Unit raise DecodeError {
  let mut line = 1
  let mut start = 0
  for i in 0..<self.pos {
    if i < self.text.length() && self.text[i].to_int() == 10 {
      line += 1
      start = i + 1
    }
  }
  raise DecodeError("\{what} at line \{line}, col \{self.pos - start + 1}")
}

///|
/// The code unit at pos, or -1 at the end.
fn Reader::cur(self : Reader) -> Int32 {
  if self.pos < self.text.length() {
    self.text[self.pos].to_int()
  } else {
    -1
  }
}

///|
fn Reader::peek(self : Reader) -> Int32 {
  while self.pos < self.text.length() {
    let c = self.text[self.pos].to_int()
    if c != 32 && c != 9 && c != 10 && c != 13 {
      break
    }
    self.pos += 1
  }
  self.cur()
}

///|
fn Reader::expect(self : Reader, ch : Char) -> Unit raise DecodeError {
  if self.peek() != ch.to_int() {
    self.fail("expected \"\{ch}\"")
  }
  self.pos += 1
}

///|
fn Reader::eat(self : Reader, ch : Char) -> Bool {
  if self.peek() != ch.to_int() {
    return false
  }
  self.pos += 1
  true
}

///|
fn Reader::end(self : Reader) -> Unit raise DecodeError {
  if self.peek() != -1 {
    self.fail("unexpected text after the value")
  }
}

///|
fn Reader::word(self : Reader, w : String) -> Unit raise DecodeError {
  if !self.text.clamped_view(start=self.pos).has_prefix(w) {
    self.fail("unexpected character")
  }
  self.pos += w.length()
}

///|
fn Reader::value(self : Reader) -> @model.Value raise DecodeError {
  let c = self.peek()
  match c {
    '{' => Object(self.object())
    '[' => self.array_form()
    '"' => String(self.string())
    't' => {
      self.word("true")
      Bool(true)
    }
    'f' => {
      self.word("false")
      Bool(false)
    }
    'n' => {
      self.word("null")
      Null
    }
    -1 => {
      self.fail("unexpected end of input")
      Null
    }
    _ =>
      if c == '-' || (c >= '0' && c <= '9') {
        self.number()
      } else {
        self.fail("unexpected character")
        Null
      }
  }
}

///|
fn is_digit(c : Int32) -> Bool {
  c >= '0' && c <= '9'
}

///|
/// -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)? : an Int without fraction and exponent, else
/// a Double.
fn Reader::number(self : Reader) -> @model.Value raise DecodeError {
  let start = self.pos
  if self.cur() == '-' {
    self.pos += 1
  }
  if self.cur() == '0' {
    self.pos += 1
  } else if is_digit(self.cur()) {
    while is_digit(self.cur()) {
      self.pos += 1
    }
  } else {
    self.fail("malformed number")
  }
  let mut integral = true
  if self.cur() == '.' &&
    self.pos + 1 < self.text.length() &&
    is_digit(self.text[self.pos + 1].to_int()) {
    integral = false
    self.pos += 1
    while is_digit(self.cur()) {
      self.pos += 1
    }
  }
  if self.cur() == 'e' || self.cur() == 'E' {
    let save = self.pos
    self.pos += 1
    if self.cur() == '+' || self.cur() == '-' {
      self.pos += 1
    }
    if is_digit(self.cur()) {
      integral = false
      while is_digit(self.cur()) {
        self.pos += 1
      }
    } else {
      self.pos = save
    }
  }
  let src = self.text.exact_view(start~, end=self.pos)
  if integral {
    let n = @string.parse_int64(src) catch {
      _ => {
        self.fail("an integer outside the Int range (i64)")
        0L
      }
    }
    return Int(n)
  }
  let x = @string.parse_double(src) catch {
    _ => {
      self.fail("malformed number")
      0.0
    }
  }
  Double(x)
}

///|
fn hex_digit(c : Int32) -> Int32 {
  if c >= '0' && c <= '9' {
    c - '0'
  } else if c >= 'a' && c <= 'f' {
    c - 'a' + 10
  } else if c >= 'A' && c <= 'F' {
    c - 'A' + 10
  } else {
    -1
  }
}

///|
fn Reader::string(self : Reader) -> String raise DecodeError {
  let t = self.text
  if self.cur() != '"' {
    self.fail("expected a string")
  }
  self.pos += 1
  let sb = StringBuilder()
  let mut start = self.pos
  while true {
    if self.pos >= t.length() {
      self.fail("unterminated string")
    }
    let c = t[self.pos].to_int()
    if c == '"' {
      break
    }
    if c < 32 {
      self.fail("a control character in a string")
    }
    if c != '\\' {
      self.pos += 1
      continue
    }
    sb.write_substring(t, start, self.pos - start)
    let e = if self.pos + 1 < t.length() {
      t[self.pos + 1].to_int()
    } else {
      -1
    }
    self.pos += 2
    match e {
      '"' | '\\' | '/' => sb.write_char(Int32::unsafe_to_char(e))
      'b' => sb.write_char('\b')
      'f' => sb.write_char('\u{0c}')
      'n' => sb.write_char('\n')
      'r' => sb.write_char('\r')
      't' => sb.write_char('\t')
      'u' => {
        let mut u = 0
        for k in 0..<4 {
          let d = if self.pos + k < t.length() {
            hex_digit(t[self.pos + k].to_int())
          } else {
            -1
          }
          if d < 0 {
            self.fail("a malformed \\u escape")
          }
          u = u * 16 + d
        }
        // A lone surrogate is caught below, once the whole string is known.
        sb.write_char(Int32::unsafe_to_char(u))
        self.pos += 4
      }
      _ => {
        self.pos -= 2
        self.fail("an unknown escape")
      }
    }
    start = self.pos
  }
  sb.write_substring(t, start, self.pos - start)
  self.pos += 1
  let out = sb.to_string()
  if !well_formed(out) {
    self.fail("a lone surrogate in a string")
  }
  out
}

///|
/// `[e…]`: the elements of an encoded Array.
fn Reader::elements(self : Reader) -> Array[@model.Value] raise DecodeError {
  self.expect('[')
  let items = []
  if self.eat(']') {
    return items
  }
  items.push(self.value())
  while self.eat(',') {
    items.push(self.value())
  }
  self.expect(']')
  items
}

///|
fn Reader::object(self : Reader) -> @model.OMap raise DecodeError {
  self.expect('{')
  let m = @model.OMap::new()
  if self.eat('}') {
    return m
  }
  while true {
    if self.peek() != '"' {
      self.fail("expected a key")
    }
    let k = self.string()
    if m.find(k) is Some(_) {
      self.fail("a duplicate key \{quote(k)}")
    }
    self.expect(':')
    m.push(k, self.value())
    if !self.eat(',') {
      break
    }
  }
  self.expect('}')
  m
}

///|
fn quote(s : String) -> String {
  let sb = StringBuilder()
  write_string(sb, s) catch {
    _ => return "\"…\""
  }
  sb.to_string()
}

///|
fn arity(tag : String) -> Int32 {
  match tag {
    "num" | "bytes" | "inst" | "ref" | "set" => 1
    "#" => 2
    "node" => 3
    _ => -1
  }
}

///|
fn Reader::array_form(self : Reader) -> @model.Value raise DecodeError {
  let at = self.pos
  self.expect('[')
  let c = self.peek()
  if c == '[' {
    let items = self.elements()
    self.expect(']')
    return Array(items)
  }
  if c != '"' {
    self.pos = at
    self.fail(
      "an array must be an escaped Array [[…]] or a tagged form [\"tag\", …]",
    )
  }
  let tag = self.string()
  if arity(tag) < 0 {
    self.pos = at
    self.fail("an unknown tag \{quote(tag)}")
  }
  let v = self.tagged(tag)
  if self.peek() == ',' {
    self.fail("too many arguments for \"\{tag}\"")
  }
  self.expect(']')
  v
}

///|
fn Reader::string_arg(self : Reader, tag : String) -> String raise DecodeError {
  if !self.eat(',') {
    self.fail("\"\{tag}\" takes \{arity(tag)} argument(s)")
  }
  if self.peek() != '"' {
    self.fail("\"\{tag}\" expects a string argument")
  }
  self.string()
}

///|
fn Reader::encoded_array_arg(
  self : Reader,
  tag : String,
) -> Array[@model.Value] raise DecodeError {
  if !self.eat(',') {
    self.fail("\"\{tag}\" takes \{arity(tag)} argument(s)")
  }
  if self.peek() != '[' {
    self.fail("\"\{tag}\" expects an Array [[…]]")
  }
  self.expect('[')
  if self.peek() != '[' {
    self.fail("\"\{tag}\" expects an Array [[…]]")
  }
  let items = self.elements()
  self.expect(']')
  items
}

///|
fn is_decimal_int(s : String) -> Bool {
  let n = s.length()
  let mut i = 0
  if i < n && s[i].to_int() == '-' {
    i += 1
  }
  if i >= n {
    return false
  }
  if s[i].to_int() == '0' {
    return i + 1 == n
  }
  while i < n {
    if !is_digit(s[i].to_int()) {
      return false
    }
    i += 1
  }
  true
}

///|
fn Reader::tagged(
  self : Reader,
  tag : String,
) -> @model.Value raise DecodeError {
  match tag {
    "num" => {
      let s = self.string_arg(tag)
      match s {
        "NaN" => Double(@double.not_a_number)
        "Infinity" => Double(@double.infinity)
        "-Infinity" => Double(@double.neg_infinity)
        "-0" => Double(-0.0)
        _ => {
          self.fail(
            "\"num\" takes NaN, Infinity, -Infinity or -0, not \{quote(s)}",
          )
          Null
        }
      }
    }
    "bytes" => {
      let s = self.string_arg(tag)
      match base64_decode(s) {
        Some(b) => Bytes(b)
        None => {
          self.fail("malformed base64")
          Null
        }
      }
    }
    "inst" => {
      let s = self.string_arg(tag)
      if !is_decimal_int(s) {
        self.fail("an Instant must be a decimal integer string")
      }
      let ns = @string.parse_int64(s) catch {
        _ => {
          self.fail("an Instant outside the i64 range")
          0L
        }
      }
      Instant(ns)
    }
    "ref" => Ref(self.string_arg(tag))
    "set" => {
      let items = self.encoded_array_arg(tag)
      for i in 1..<items.length() {
        for j in 0..<i {
          if @model.equal(items[i], items[j]) {
            self.fail("a Set with two equal elements")
          }
        }
      }
      Set(items)
    }
    "#" => {
      let type_id = self.string_arg(tag)
      if type_id == "" {
        self.fail("an empty type_id")
      }
      if !self.eat(',') {
        self.fail("\"#\" takes 2 arguments")
      }
      Typed(type_id, self.value())
    }
    _ => {
      let name = self.string_arg(tag)
      if !self.eat(',') {
        self.fail("\"node\" takes 3 arguments")
      }
      if self.peek() != '{' {
        self.fail("\"node\" expects an attributes object")
      }
      let attrs = self.object()
      let children = self.encoded_array_arg(tag)
      Node(name, attrs, children)
    }
  }
}

///|
fn Reader::message(self : Reader) -> @model.Message raise DecodeError {
  self.expect('{')
  let seen : Array[String] = []
  let mut id : String? = None
  let mut kind : String? = None
  let mut data : @model.Value? = None
  let mut children : Array[@model.Message]? = None
  let mut meta = @model.OMap::new()
  if !self.eat('}') {
    while true {
      if self.peek() != '"' {
        self.fail("expected a key")
      }
      let k = self.string()
      if seen.contains(k) {
        self.fail("a duplicate key \{quote(k)}")
      }
      seen.push(k)
      self.expect(':')
      match k {
        "id" => {
          if self.peek() != '"' {
            self.fail("a message id must be a string")
          }
          id = Some(self.string())
        }
        "kind" => {
          if self.peek() != '"' {
            self.fail("a message kind must be a string")
          }
          kind = Some(self.string())
        }
        "data" => data = Some(self.value())
        "messages" => {
          let list = []
          self.expect('[')
          if !self.eat(']') {
            list.push(self.message())
            while self.eat(',') {
              list.push(self.message())
            }
            self.expect(']')
          }
          children = Some(list)
        }
        "meta" => meta = self.meta()
        _ => self.fail("an unknown message key \{quote(k)}")
      }
      if !self.eat(',') {
        break
      }
    }
    self.expect('}')
  }
  guard id is Some(id) else {
    self.fail("a message without \"id\"")
    panic()
  }
  guard kind is Some(kind) else {
    self.fail("a message without \"kind\"")
    panic()
  }
  let payload : @model.Payload = match (data, children) {
    (Some(v), None) => Data(v)
    (None, Some(l)) => Messages(l)
    _ => {
      self.fail("a message needs exactly one of \"data\" and \"messages\"")
      panic()
    }
  }
  { id, kind, payload, meta, }
}

///|
fn Reader::meta(self : Reader) -> @model.OMap raise DecodeError {
  self.expect('{')
  let m = @model.OMap::new()
  if self.eat('}') {
    return m
  }
  while true {
    if self.peek() != '"' {
      self.fail("expected a dialect URI")
    }
    let uri = self.string()
    if m.find(uri) is Some(_) {
      self.fail("a duplicate dialect \{quote(uri)}")
    }
    self.expect(':')
    if self.peek() != '{' {
      self.fail("a dialect's headers must be an object")
    }
    let headers = self.object()
    for i, k in headers.keys {
      if !headers.vals[i].is_scalar() {
        self.fail("header \{quote(k)} is not a Scalar")
      }
    }
    m.push(uri, Object(headers))
    if !self.eat(',') {
      break
    }
  }
  self.expect('}')
  m
}

///|
fn b64_index(c : Int32) -> Int32 {
  if c >= 'A' && c <= 'Z' {
    c - 'A'
  } else if c >= 'a' && c <= 'z' {
    c - 'a' + 26
  } else if c >= '0' && c <= '9' {
    c - '0' + 52
  } else if c == '+' {
    62
  } else if c == '/' {
    63
  } else {
    -1
  }
}

///|
/// Strict, padded base64: the length is a multiple of 4, `=` only at the end, and the bits
/// the padding drops are zero.
fn base64_decode(s : String) -> Bytes? {
  let n = s.length()
  if n % 4 != 0 {
    return None
  }
  let mut pad = 0
  if n > 0 && s[n - 1].to_int() == '=' {
    pad = 1
    if s[n - 2].to_int() == '=' {
      pad = 2
    }
  }
  let out : Array[Byte] = []
  let mut i = 0
  while i < n {
    let mut x = 0
    for k in 0..<4 {
      let c = s[i + k].to_int()
      let last = i + 4 == n
      let d = if c == '=' && last && k >= 4 - pad { 0 } else { b64_index(c) }
      if d < 0 {
        return None
      }
      x = (x << 6) | d
    }
    out.push((x >> 16).to_byte())
    if !(i + 4 == n && pad == 2) {
      out.push(((x >> 8) & 255).to_byte())
    }
    if !(i + 4 == n && pad >= 1) {
      out.push((x & 255).to_byte())
    }
    i += 4
  }
  if pad == 2 && (out.length() == 0 || (decode_tail(s) & 0xf) != 0) {
    return None
  }
  if pad == 1 && (decode_tail(s) & 0x3) != 0 {
    return None
  }
  Some(Bytes::from_array(out))
}

///|
/// The value of the last data character before the padding.
fn decode_tail(s : String) -> Int32 {
  let mut i = s.length() - 1
  while s[i].to_int() == '=' {
    i -= 1
  }
  b64_index(s[i].to_int())
}

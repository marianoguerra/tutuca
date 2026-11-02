///|
/// Encoding fails only on values the format can't hold: a lone surrogate in a string or an
/// empty type_id.
pub(all) suberror EncodeError {
  EncodeError(String)
}

///|
pub fn encode_value(v : @model.Value) -> String raise EncodeError {
  let sb = StringBuilder()
  write_value(sb, v)
  sb.to_string()
}

///|
pub fn encode_message(m : @model.Message) -> String raise EncodeError {
  let sb = StringBuilder()
  write_message(sb, m)
  sb.to_string()
}

///|
/// The JSON text of a finite Double other than -0: shortest round-trip (the same digits as
/// ECMAScript's Number::toString on every target), with `.0` when it has no `.` or exponent.
pub fn double_text(x : Double) -> String {
  let s = x.to_string()
  if s.contains(".") || s.contains("e") || s.contains("E") {
    s
  } else {
    s + ".0"
  }
}

///|
const HEX : String = "0123456789abcdef"

///|
/// A string as JSON.stringify writes it.
pub fn write_string(sb : StringBuilder, s : String) -> Unit raise EncodeError {
  if !well_formed(s) {
    raise EncodeError("a string has a lone surrogate")
  }
  sb.write_char('"')
  let mut start = 0
  for i in 0..<s.length() {
    let c = s[i].to_int()
    if c >= 0x20 && c != 0x22 && c != 0x5c {
      continue
    }
    sb.write_substring(s, start, i - start)
    start = i + 1
    match c {
      0x22 => sb.write_string("\\\"")
      0x5c => sb.write_string("\\\\")
      0x08 => sb.write_string("\\b")
      0x0c => sb.write_string("\\f")
      0x0a => sb.write_string("\\n")
      0x0d => sb.write_string("\\r")
      0x09 => sb.write_string("\\t")
      _ => {
        sb.write_string("\\u00")
        sb.write_char(at(HEX, c >> 4))
        sb.write_char(at(HEX, c & 15))
      }
    }
  }
  sb.write_substring(s, start, s.length() - start)
  sb.write_char('"')
}

///|
/// No lone surrogates.
pub fn well_formed(s : String) -> Bool {
  let n = s.length()
  let mut i = 0
  while i < n {
    let c = s[i].to_int()
    if c >= 0xd800 && c <= 0xdbff {
      if i + 1 >= n {
        return false
      }
      let d = s[i + 1].to_int()
      if d < 0xdc00 || d > 0xdfff {
        return false
      }
      i += 2
      continue
    }
    if c >= 0xdc00 && c <= 0xdfff {
      return false
    }
    i += 1
  }
  true
}

///|
pub fn write_value(
  sb : StringBuilder,
  v : @model.Value,
) -> Unit raise EncodeError {
  match v {
    Null => sb.write_string("null")
    Bool(b) => sb.write_string(if b { "true" } else { "false" })
    Int(n) => sb.write_string(n.to_string())
    Double(x) =>
      if x.is_nan() {
        sb.write_string("[\"num\",\"NaN\"]")
      } else if x.is_pos_inf() {
        sb.write_string("[\"num\",\"Infinity\"]")
      } else if x.is_neg_inf() {
        sb.write_string("[\"num\",\"-Infinity\"]")
      } else if x == 0.0 && x.reinterpret_as_int64() != 0L {
        sb.write_string("[\"num\",\"-0\"]")
      } else {
        sb.write_string(double_text(x))
      }
    String(s) => write_string(sb, s)
    Bytes(b) => {
      sb.write_string("[\"bytes\",\"")
      sb.write_string(base64_encode(b))
      sb.write_string("\"]")
    }
    Instant(ns) => {
      sb.write_string("[\"inst\",\"")
      sb.write_string(ns.to_string())
      sb.write_string("\"]")
    }
    Ref(uri) => {
      sb.write_string("[\"ref\",")
      write_string(sb, uri)
      sb.write_char(']')
    }
    Array(items) => {
      sb.write_char('[')
      write_list(sb, items)
      sb.write_char(']')
    }
    Object(m) => write_object(sb, m)
    Set(items) => {
      sb.write_string("[\"set\",[")
      write_list(sb, items)
      sb.write_string("]]")
    }
    Typed(type_id, value) => {
      if type_id == "" {
        raise EncodeError("a Typed has an empty type_id")
      }
      sb.write_string("[\"#\",")
      write_string(sb, type_id)
      sb.write_char(',')
      write_value(sb, value)
      sb.write_char(']')
    }
    Node(tag, attrs, children) => {
      sb.write_string("[\"node\",")
      write_string(sb, tag)
      sb.write_char(',')
      write_object(sb, attrs)
      sb.write_string(",[")
      write_list(sb, children)
      sb.write_string("]]")
    }
  }
}

///|
/// `[e…]`, inside the escaping brackets the caller writes.
fn write_list(
  sb : StringBuilder,
  items : Array[@model.Value],
) -> Unit raise EncodeError {
  sb.write_char('[')
  for i, e in items {
    if i > 0 {
      sb.write_char(',')
    }
    write_value(sb, e)
  }
  sb.write_char(']')
}

///|
pub fn write_object(
  sb : StringBuilder,
  m : @model.OMap,
) -> Unit raise EncodeError {
  sb.write_char('{')
  for i, k in m.keys {
    if i > 0 {
      sb.write_char(',')
    }
    write_string(sb, k)
    sb.write_char(':')
    write_value(sb, m.vals[i])
  }
  sb.write_char('}')
}

///|
pub fn write_message(
  sb : StringBuilder,
  m : @model.Message,
) -> Unit raise EncodeError {
  sb.write_string("{\"id\":")
  write_string(sb, m.id)
  sb.write_string(",\"kind\":")
  write_string(sb, m.kind)
  match m.payload {
    Messages(children) => {
      sb.write_string(",\"messages\":[")
      for i, child in children {
        if i > 0 {
          sb.write_char(',')
        }
        write_message(sb, child)
      }
      sb.write_char(']')
    }
    Data(v) => {
      sb.write_string(",\"data\":")
      write_value(sb, v)
    }
  }
  if m.meta.length() > 0 {
    sb.write_string(",\"meta\":")
    write_object(sb, m.meta)
  }
  sb.write_char('}')
}

///|
const B64 : String = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

///|
/// RFC 4648 §4, padded.
fn base64_encode(b : Bytes) -> String {
  let sb = StringBuilder()
  let n = b.length()
  let mut i = 0
  while i + 2 < n {
    let x = (b[i].to_int() << 16) | (b[i + 1].to_int() << 8) | b[i + 2].to_int()
    sb.write_char(at(B64, x >> 18))
    sb.write_char(at(B64, (x >> 12) & 63))
    sb.write_char(at(B64, (x >> 6) & 63))
    sb.write_char(at(B64, x & 63))
    i += 3
  }
  if n - i == 1 {
    let x = b[i].to_int() << 16
    sb.write_char(at(B64, x >> 18))
    sb.write_char(at(B64, (x >> 12) & 63))
    sb.write_string("==")
  } else if n - i == 2 {
    let x = (b[i].to_int() << 16) | (b[i + 1].to_int() << 8)
    sb.write_char(at(B64, x >> 18))
    sb.write_char(at(B64, (x >> 12) & 63))
    sb.write_char(at(B64, (x >> 6) & 63))
    sb.write_char('=')
  }
  sb.to_string()
}

///|
/// The i-th character of an ASCII table.
fn at(table : String, i : Int32) -> Char {
  table.get_char(i).unwrap()
}

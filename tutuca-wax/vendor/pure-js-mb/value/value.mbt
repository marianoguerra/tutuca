// Values of a run, as JavaScript has them for pure-js programs: undefined,
// null, booleans, numbers (doubles), strings (UTF-16), lists and objects
// (records and dictionaries are both objects, as in JavaScript), host handles,
// host functions (by qualified name), modules, and callbacks. Lists and objects
// are references, compared by identity, and may be frozen, as `this` is.

///|
pub(all) struct ListRef {
  items : Array[Value]
  mut frozen : Bool
}

///|
pub(all) struct ObjRef {
  props : Map[String, Value]
  mut frozen : Bool
}

///|
/// A host object: its fields, and methods the runtime answers by
/// "<name>.<method>".
pub(all) struct HandleRef {
  name : String
  fields : Map[String, Value]
}

///|
/// A callback: an arrow and what it closes over, opaque to this package.
pub(all) struct Callback {
  call : (Array[Value]) -> Value raise RunError
}

///|
pub(all) enum Value {
  Undefined
  Null
  Bool(Bool)
  Num(Double)
  Str(String)
  List(ListRef)
  Obj(ObjRef)
  Handle(HandleRef)
  HostFn(String)
  Module(String)
  Fn(Callback)
}

///|
/// How a run stops early: an error JavaScript would throw (it ends the run as
/// terminated), an operation whose behaviour pure-js leaves undefined, or the
/// interpreter's limits (undefined too).
pub(all) suberror RunError {
  Thrown(kind~ : String, message~ : String)
  UndefinedBehaviour(String)
  Limit(String)
}

///|
pub fn type_error(message : String) -> RunError {
  Thrown(kind="TypeError", message~)
}

///|
pub fn list(items : Array[Value]) -> Value {
  List({ items, frozen: false, })
}

///|
pub fn obj(props : Map[String, Value]) -> Value {
  Obj({ props, frozen: false, })
}

///|
/// A number as JavaScript's String(n) writes it.
pub fn number_text(n : Double) -> String {
  if n != n {
    "NaN"
  } else if n == @double.infinity {
    "Infinity"
  } else if n == @double.neg_infinity {
    "-Infinity"
  } else {
    n.to_string()
  }
}

///|
pub fn type_of(v : Value) -> String {
  match v {
    Undefined => "undefined"
    Null | List(_) | Obj(_) | Handle(_) | Module(_) => "object"
    Bool(_) => "boolean"
    Num(_) => "number"
    Str(_) => "string"
    HostFn(_) | Fn(_) => "function"
  }
}

///|
pub fn truthy(v : Value) -> Bool {
  match v {
    Undefined | Null => false
    Bool(b) => b
    Num(n) => n == n && n != 0.0
    Str(s) => s != ""
    _ => true
  }
}

///|
/// ===: numbers and strings by value, everything else by identity.
pub fn strict_equal(a : Value, b : Value) -> Bool {
  match (a, b) {
    (Undefined, Undefined) | (Null, Null) => true
    (Bool(x), Bool(y)) => x == y
    (Num(x), Num(y)) => x == y
    (Str(x), Str(y)) => x == y
    (List(x), List(y)) => physical_equal(x, y)
    (Obj(x), Obj(y)) => physical_equal(x, y)
    (Handle(x), Handle(y)) => physical_equal(x, y)
    (HostFn(x), HostFn(y)) | (Module(x), Module(y)) => x == y
    (Fn(x), Fn(y)) => physical_equal(x, y)
    _ => false
  }
}

///|
/// SameValueZero, what includes compares with: NaN is NaN.
pub fn same_value_zero(a : Value, b : Value) -> Bool {
  match (a, b) {
    (Num(x), Num(y)) => x == y || (x != x && y != y)
    _ => strict_equal(a, b)
  }
}

///|
/// JavaScript's ToString, for what a template or + converts.
pub fn to_js_string(v : Value) -> String {
  match v {
    Undefined => "undefined"
    Null => "null"
    Bool(b) => b.to_string()
    Num(n) => number_text(n)
    Str(s) => s
    List(l) =>
      l.items
      .map(x => {
        match x {
          Undefined | Null => ""
          _ => to_js_string(x)
        }
      })
      .join(",")
    Obj(_) | Handle(_) | Module(_) => "[object Object]"
    HostFn(_) | Fn(_) => "function () { [native code] }"
  }
}

///|
fn is_js_space(c : Char) -> Bool {
  c == ' ' ||
  c == '\t' ||
  c == '\n' ||
  c == '\r' ||
  c == '\u{b}' ||
  c == '\u{c}' ||
  c == '\u{a0}' ||
  c == '\u{feff}' ||
  c == '\u{2028}' ||
  c == '\u{2029}' ||
  c == '\u{1680}' ||
  (c >= '\u{2000}' && c <= '\u{200a}') ||
  c == '\u{202f}' ||
  c == '\u{205f}' ||
  c == '\u{3000}'
}

///|
/// JavaScript's String.prototype.trim, and its ends.
pub fn js_trim(s : String, start~ : Bool = true, end~ : Bool = true) -> String {
  let chars = s.iter().collect()
  let mut i = 0
  let mut j = chars.length()
  if start {
    while i < j && is_js_space(chars[i]) {
      i += 1
    }
  }
  if end {
    while j > i && is_js_space(chars[j - 1]) {
      j -= 1
    }
  }
  String::from_array(chars[i:j])
}

///|
/// A decimal number as JavaScript's StringNumericLiteral reads it, or None.
fn decimal_literal(s : String) -> Double? {
  if s == "" {
    return None
  }
  let mut i = 0
  let n = s.length()
  if s[0] == '+' || s[0] == '-' {
    i = 1
  }
  let rest = s.exact_view(start=i).to_owned()
  if rest == "Infinity" {
    return Some(
      if s[0] == '-' {
        @double.neg_infinity
      } else {
        @double.infinity
      },
    )
  }
  let mut digits = 0
  let mut j = i
  while j < n && s[j] >= '0' && s[j] <= '9' {
    j += 1
    digits += 1
  }
  if j < n && s[j] == '.' {
    j += 1
    while j < n && s[j] >= '0' && s[j] <= '9' {
      j += 1
      digits += 1
    }
  }
  if digits == 0 {
    return None
  }
  if j < n && (s[j] == 'e' || s[j] == 'E') {
    j += 1
    if j < n && (s[j] == '+' || s[j] == '-') {
      j += 1
    }
    let from = j
    while j < n && s[j] >= '0' && s[j] <= '9' {
      j += 1
    }
    if j == from {
      return None
    }
  }
  if j != n {
    return None
  }
  let text = s.replace_all(old="+", new="")
  let text = if text.has_prefix(".") {
    "0" + text
  } else if text.has_prefix("-.") {
    "-0" + text.exact_view(start=1).to_owned()
  } else {
    text
  }
  let text = if text.has_suffix(".") { text + "0" } else { text }
  let text = text
    .replace_all(old=".e", new=".0e")
    .replace_all(old=".E", new=".0E")
  Some(@string.parse_double(text)) catch {
    _ => None
  }
}

///|
/// JavaScript's ToNumber.
pub fn to_number(v : Value) -> Double {
  match v {
    Undefined => @double.not_a_number
    Null => 0.0
    Bool(b) => if b { 1.0 } else { 0.0 }
    Num(n) => n
    Str(s0) => {
      let s = js_trim(s0)
      if s == "" {
        return 0.0
      }
      if s.length() > 2 && s[0] == '0' {
        let base = match s[1] {
          'x' | 'X' => 16
          'o' | 'O' => 8
          'b' | 'B' => 2
          _ => 0
        }
        if base != 0 {
          let mut acc = 0.0
          for k in 2..<s.length() {
            let d = digit_value(s[k].to_int())
            if d < 0 || d >= base {
              return @double.not_a_number
            }
            acc = acc * base.to_double() + d.to_double()
          }
          return acc
        }
      }
      decimal_literal(s).unwrap_or(@double.not_a_number)
    }
    List(l) => to_number(Str(to_js_string(List(l))))
    _ => @double.not_a_number
  }
}

///|
/// A digit's value in any base up to 36, or -1.
pub fn digit_value(c : Int32) -> Int32 {
  if c >= '0'.to_int() && c <= '9'.to_int() {
    c - '0'.to_int()
  } else if c >= 'a'.to_int() && c <= 'z'.to_int() {
    c - 'a'.to_int() + 10
  } else if c >= 'A'.to_int() && c <= 'Z'.to_int() {
    c - 'A'.to_int() + 10
  } else {
    -1
  }
}

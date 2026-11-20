///|
/// A string as JSON.stringify quotes it.
pub fn json_quote(s : String) -> String {
  let sb = StringBuilder()
  sb.write_char('"')
  for i in 0..<s.length() {
    let c = s[i].to_int()
    match c {
      0x22 => sb.write_string("\\\"")
      0x5c => sb.write_string("\\\\")
      0x08 => sb.write_string("\\b")
      0x0c => sb.write_string("\\f")
      0x0a => sb.write_string("\\n")
      0x0d => sb.write_string("\\r")
      0x09 => sb.write_string("\\t")
      _ => {
        let lone_high = c >= 0xd800 &&
          c <= 0xdbff &&
          !(i + 1 < s.length() &&
          s[i + 1].to_int() >= 0xdc00 &&
          s[i + 1].to_int() <= 0xdfff)
        let lone_low = c >= 0xdc00 &&
          c <= 0xdfff &&
          !(i > 0 && s[i - 1].to_int() >= 0xd800 && s[i - 1].to_int() <= 0xdbff)
        if c < 0x20 || lone_high || lone_low {
          let digits = "0123456789abcdef"
          sb.write_string("\\u")
          for shift in [12, 8, 4, 0] {
            sb.write_char(
              Int32::unsafe_to_char(digits[(c >> shift) & 15].to_int()),
            )
          }
        } else {
          sb.write_string(s.exact_view(start=i, end=i + 1).to_owned())
        }
      }
    }
  }
  sb.write_char('"')
  sb.to_string()
}

///|
/// JSON.stringify(v, null, space): None where JavaScript gives undefined.
pub fn stringify(v : Value, space~ : Int32 = 0) -> String? {
  let indent = " ".repeat(space.max(0).min(10))
  fn go(v : Value, depth : String) -> String? {
    match v {
      Undefined | HostFn(_) | Fn(_) => None
      Null => Some("null")
      Bool(b) => Some(b.to_string())
      Num(n) =>
        Some(
          if n != n || n == @double.infinity || n == @double.neg_infinity {
            "null"
          } else {
            number_text(n)
          },
        )
      Str(s) => Some(json_quote(s))
      List(l) => {
        if l.items.length() == 0 {
          return Some("[]")
        }
        let inner = depth + indent
        let parts = l.items.map(x => go(x, inner).unwrap_or("null"))
        Some(
          if indent == "" {
            "[\{parts.join(",")}]"
          } else {
            "[\n\{inner}\{parts.join(",\n" + inner)}\n\{depth}]"
          },
        )
      }
      Obj({ props, .. }) | Handle({ fields: props, .. }) => {
        let inner = depth + indent
        let parts = []
        for k, x in props {
          match go(x, inner) {
            Some(text) =>
              parts.push(
                "\{json_quote(k)}:\{if indent == "" { "" } else { " " }}\{text}",
              )
            None => ()
          }
        }
        if parts.length() == 0 {
          return Some("{}")
        }
        Some(
          if indent == "" {
            "{\{parts.join(",")}}"
          } else {
            "{\n\{inner}\{parts.join(",\n" + inner)}\n\{depth}}"
          },
        )
      }
      Module(_) => Some("{}")
    }
  }

  go(v, "")
}

///|
/// The value as JSON data (what JSON.parse(JSON.stringify(v)) gives), or None
/// where JSON has nothing for it.
pub fn to_json(v : Value) -> Json? {
  match v {
    Undefined | HostFn(_) | Fn(_) => None
    Null => Some(Json::null())
    Bool(b) => Some(Json::boolean(b))
    Num(n) =>
      Some(
        if n != n || n == @double.infinity || n == @double.neg_infinity {
          Json::null()
        } else {
          Json::number(n)
        },
      )
    Str(s) => Some(Json::string(s))
    List(l) =>
      Some(Json::array(l.items.map(x => to_json(x).unwrap_or(Json::null()))))
    Obj({ props, .. }) | Handle({ fields: props, .. }) => {
      let m : Map[String, Json] = Map([])
      for k, x in props {
        match to_json(x) {
          Some(j) => m[k] = j
          None => ()
        }
      }
      Some(Json::object(m))
    }
    Module(_) => Some(Json::object(Map([])))
  }
}

///|
/// JSON data as a value; reserved keys (__proto__, toString, ...) are dropped,
/// as the standard host's JSON.parse does.
pub fn from_json(j : Json) -> Value {
  match j {
    Null => Null
    True => Bool(true)
    False => Bool(false)
    Number(n, ..) => Num(n)
    String(s) => Str(s)
    Array(xs) => list(xs.map(from_json))
    Object(m) => {
      let props : Map[String, Value] = Map([])
      for k, x in m {
        if !@tables.is_reserved(k) {
          props[k] = from_json(x)
        }
      }
      obj(props)
    }
  }
}

///|
/// JSON.parse.
pub fn parse_json(text : String) -> Value raise RunError {
  let j = @json.parse(text) catch {
    _ => raise Thrown(kind="SyntaxError", message="Unexpected token in JSON")
  }
  from_json(j)
}

///|
/// The value frozen all the way down, as Object.freeze does it.
pub fn deep_freeze(v : Value) -> Value {
  match v {
    List(l) => {
      for x in l.items {
        ignore(deep_freeze(x))
      }
      l.frozen = true
    }
    Obj(o) => {
      for _, x in o.props {
        ignore(deep_freeze(x))
      }
      o.frozen = true
    }
    _ => ()
  }
  v
}

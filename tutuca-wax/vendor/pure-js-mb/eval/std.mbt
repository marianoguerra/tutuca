// The standard host's implementations, as the reference's lib/std.js:
// JavaScript's functions, written out with its edge cases.

///|
fn num_arg(args : Array[Value], i : Int32) -> Double {
  @value.to_number(arg(args, i))
}

///|
fn is_finite(n : Double) -> Bool {
  n == n && n != @double.infinity && n != @double.neg_infinity
}

///|
fn js_round(x : Double) -> Double {
  if !is_finite(x) || x == 0.0 {
    return x
  }
  let r = x.floor()
  let out = if x - r >= 0.5 { r + 1.0 } else { r }
  if out == 0.0 && x < 0.0 {
    -0.0
  } else {
    out
  }
}

///|
fn js_max(args : Array[Value], is_max : Bool) -> Double {
  let mut acc = if is_max { @double.neg_infinity } else { @double.infinity }
  let mut nan = false
  for a in args {
    let n = @value.to_number(a)
    if n != n {
      nan = true
    } else if is_max {
      if n > acc || (n == 0.0 && acc == 0.0 && 1.0 / acc < 0.0) {
        acc = n
      }
    } else if n < acc || (n == 0.0 && acc == 0.0 && 1.0 / n < 0.0) {
      acc = n
    }
  }
  if nan {
    @double.not_a_number
  } else {
    acc
  }
}

///|
fn trim_start(s : String) -> String {
  @value.js_trim(s, end=false)
}

///|
fn parse_int(text : String, radix : Double) -> Double {
  let mut s = trim_start(text)
  let mut sign = 1.0
  if s.has_prefix("-") || s.has_prefix("+") {
    if s.has_prefix("-") {
      sign = -1.0
    }
    s = s.exact_view(start=1).to_owned()
  }
  let mut r = if radix != radix || !is_finite(radix) {
    0
  } else {
    radix.trunc().to_int()
  }
  let mut strip = true
  if r != 0 {
    if r < 2 || r > 36 {
      return @double.not_a_number
    }
    if r != 16 {
      strip = false
    }
  } else {
    r = 10
  }
  if strip && (s.has_prefix("0x") || s.has_prefix("0X")) {
    s = s.exact_view(start=2).to_owned()
    r = 16
  }
  let mut acc = 0.0
  let mut any = false
  for i in 0..<s.length() {
    let d = @value.digit_value(s[i].to_int())
    if d < 0 || d >= r {
      break
    }
    acc = acc * r.to_double() + d.to_double()
    any = true
  }
  if any {
    sign * acc
  } else {
    @double.not_a_number
  }
}

///|
fn parse_float(text : String) -> Double {
  let s = trim_start(text)
  let n = s.length()
  let mut i = 0
  if i < n && (s[i] == '+' || s[i] == '-') {
    i += 1
  }
  if s.exact_view(start=i).has_prefix("Infinity") {
    return if s.has_prefix("-") {
      @double.neg_infinity
    } else {
      @double.infinity
    }
  }
  let digits_from = i
  while i < n && s[i] >= '0' && s[i] <= '9' {
    i += 1
  }
  let mut digits = i - digits_from
  if i < n && s[i] == '.' {
    let before = i
    i += 1
    let f = i
    while i < n && s[i] >= '0' && s[i] <= '9' {
      i += 1
    }
    digits += i - f
    if digits == 0 {
      i = before
    }
  }
  if digits == 0 {
    return @double.not_a_number
  }
  if i < n && (s[i] == 'e' || s[i] == 'E') {
    let mut j = i + 1
    if j < n && (s[j] == '+' || s[j] == '-') {
      j += 1
    }
    let f = j
    while j < n && s[j] >= '0' && s[j] <= '9' {
      j += 1
    }
    if j > f {
      i = j
    }
  }
  @value.to_number(Str(s.exact_view(end=i).to_owned()))
}

///|
fn keys_of(v : Value) -> Array[String] {
  match v {
    Obj(o) => o.props.keys().collect()
    Handle(h) => h.fields.keys().collect()
    List(l) => (0).until(l.items.length()).map(i => i.to_string()).collect()
    Str(s) => (0).until(s.length()).map(i => i.to_string()).collect()
    _ => []
  }
}

///|
fn values_of(v : Value) -> Array[Value] {
  match v {
    Obj(o) => o.props.values().collect()
    Handle(h) => h.fields.values().collect()
    List(l) => l.items.copy()
    _ => []
  }
}

///|
/// A standard host function, or None when q isn't one.
pub fn std_call(q : String, args : Array[Value]) -> Value? raise RunError {
  let x = num_arg(args, 0)
  let v : Value = match q {
    "Math.max" => Num(js_max(args, true))
    "Math.min" => Num(js_max(args, false))
    "Math.abs" => Num(x.abs())
    "Math.floor" => Num(x.floor())
    "Math.ceil" => Num(x.ceil())
    "Math.round" => Num(js_round(x))
    "Math.trunc" => Num(x.trunc())
    "Math.sign" =>
      Num(if x != x || x == 0.0 { x } else if x > 0.0 { 1.0 } else { -1.0 })
    "Number.isInteger" =>
      Bool(
        match arg(args, 0) {
          Num(n) => is_finite(n) && n.trunc() == n
          _ => false
        },
      )
    "Number.isFinite" => Bool(arg(args, 0) is Num(n) && is_finite(n))
    "Number.isNaN" => Bool(arg(args, 0) is Num(n) && n != n)
    "Number.parseInt" =>
      Num(parse_int(@value.to_js_string(arg(args, 0)), num_arg(args, 1)))
    "Number.parseFloat" => Num(parse_float(@value.to_js_string(arg(args, 0))))
    "JSON.stringify" => {
      let space = if args.length() >= 3 {
        num_arg(args, 2).trunc().to_int()
      } else {
        0
      }
      match @value.stringify(arg(args, 0), space~) {
        Some(s) => Str(s)
        None => Undefined
      }
    }
    "JSON.parse" => @value.parse_json(@value.to_js_string(arg(args, 0)))
    "Object.keys" => @value.list(keys_of(arg(args, 0)).map(k => Value::Str(k)))
    "Object.entries" => {
      let o = arg(args, 0)
      let ks = keys_of(o)
      let vs = values_of(o)
      @value.list(ks.mapi((i, k) => @value.list([Str(k), vs[i]])))
    }
    "Object.fromEntries" => {
      let props : Map[String, Value] = Map([])
      match arg(args, 0) {
        List(l) =>
          for e in l.items {
            match e {
              List(pair) => {
                let key = @value.to_js_string(
                  pair.items.get(0).unwrap_or(Undefined),
                )
                // A reserved key is undefined, as setting one by a computed key is.
                if @tables.is_reserved(key) {
                  raise UndefinedBehaviour("setting the key \"\{key}\"")
                }
                props[key] = pair.items.get(1).unwrap_or(Undefined)
              }
              _ =>
                raise @value.type_error("Iterator value is not an entry object")
            }
          }
        _ => raise @value.type_error("object is not iterable")
      }
      @value.obj(props)
    }
    "Object.hasOwn" =>
      Bool(keys_of(arg(args, 0)).contains(@value.to_js_string(arg(args, 1))))
    "Array.isArray" => Bool(arg(args, 0) is List(_))
    "String" => Str(@value.to_js_string(arg(args, 0)))
    "Number" => Num(if args.length() == 0 { 0.0 } else { x })
    _ => return None
  }
  Some(v)
}

///|
/// The standard host's runtime, asking fallback for everything else (a
/// handle's methods, the embedder's modules); without one, a call to something
/// else is an operation the run can't do, so undefined.
pub fn Runtime::std(
  fallback? : (String, Value, Array[Value]) -> Value raise RunError,
) -> Runtime {
  {
    call: (q, this_, args) => {
      match std_call(q, args) {
        Some(v) => v
        None =>
          match fallback {
            Some(f) => f(q, this_, args)
            None =>
              raise UndefinedBehaviour("the host has no implementation of \{q}")
          }
      }
    },
  }
}

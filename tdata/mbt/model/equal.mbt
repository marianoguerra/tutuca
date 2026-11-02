///|
/// Structural equality (docs/spec.md §1.2): order-insensitive for maps and sets, Int never equal
/// to Double, Doubles compared by bits with every NaN equal.
pub fn equal(a : Value, b : Value) -> Bool {
  match (a, b) {
    (Null, Null) => true
    (Bool(x), Bool(y)) => x == y
    (Int(x), Int(y)) => x == y
    (Double(x), Double(y)) => same_double(x, y)
    (String(x), String(y)) => x == y
    (Bytes(x), Bytes(y)) => x == y
    (Instant(x), Instant(y)) => x == y
    (Ref(x), Ref(y)) => x == y
    (Array(x), Array(y)) => equal_lists(x, y)
    (Object(x), Object(y)) => equal_maps(x, y)
    (Set(x), Set(y)) =>
      x.length() == y.length() &&
      x.iter().all(e => y.iter().any(f => equal(e, f)))
    (Typed(t, x), Typed(u, y)) => t == u && equal(x, y)
    (Node(t, xa, xc), Node(u, ya, yc)) =>
      t == u && equal_maps(xa, ya) && equal_lists(xc, yc)
    _ => false
  }
}

///|
fn same_double(x : Double, y : Double) -> Bool {
  if x.is_nan() {
    return y.is_nan()
  }
  x.reinterpret_as_int64() == y.reinterpret_as_int64()
}

///|
fn equal_lists(x : Array[Value], y : Array[Value]) -> Bool {
  if x.length() != y.length() {
    return false
  }
  for i, e in x {
    if !equal(e, y[i]) {
      return false
    }
  }
  true
}

///|
pub fn equal_maps(x : OMap, y : OMap) -> Bool {
  if x.length() != y.length() {
    return false
  }
  for i, k in x.keys {
    match y.get(k) {
      Some(v) => if !equal(x.vals[i], v) { return false }
      None => return false
    }
  }
  true
}

///|
pub fn equal_messages(a : Message, b : Message) -> Bool {
  if a.id != b.id || a.kind != b.kind || !equal_maps(a.meta, b.meta) {
    return false
  }
  match (a.payload, b.payload) {
    (Data(x), Data(y)) => equal(x, y)
    (Messages(x), Messages(y)) => equal_message_lists(x, y)
    _ => false
  }
}

///|
pub fn equal_message_lists(x : Array[Message], y : Array[Message]) -> Bool {
  if x.length() != y.length() {
    return false
  }
  for i, m in x {
    if !equal_messages(m, y[i]) {
      return false
    }
  }
  true
}

///|
/// The order of two values for tq's `<` and friends: numbers (Int and Double, compared exactly),
/// Strings by code point, Instants by time. None when they don't compare (other kinds, NaN).
pub fn compare(a : Value, b : Value) -> Int32? {
  match (a, b) {
    (Int(x), Int(y)) => Some(x.compare(y))
    (Double(x), Double(y)) => compare_doubles(x, y)
    (Int(x), Double(y)) => compare_int_double(x, y)
    (Double(x), Int(y)) =>
      match compare_int_double(y, x) {
        Some(c) => Some(-c)
        None => None
      }
    (String(x), String(y)) => Some(compare_code_points(x, y))
    (Instant(x), Instant(y)) => Some(x.compare(y))
    _ => None
  }
}

///|
fn compare_doubles(x : Double, y : Double) -> Int32? {
  if x.is_nan() || y.is_nan() {
    return None
  }
  if x < y {
    Some(-1)
  } else if x > y {
    Some(1)
  } else {
    Some(0)
  }
}

///|
/// An Int against a Double, exactly (no rounding of the Int to a Double).
fn compare_int_double(i : Int64, d : Double) -> Int32? {
  if d.is_nan() {
    return None
  }
  // 2^63: every Int is below it, and -2^63 is the least Int.
  if d >= 9223372036854775808.0 {
    return Some(-1)
  }
  if d < -9223372036854775808.0 {
    return Some(1)
  }
  let t = d.trunc()
  let ti = t.to_int64()
  if i < ti {
    return Some(-1)
  }
  if i > ti {
    return Some(1)
  }
  // Equal integer parts: the fraction decides.
  let frac = d - t
  if frac > 0.0 {
    Some(-1)
  } else if frac < 0.0 {
    Some(1)
  } else {
    Some(0)
  }
}

///|
/// Code point order, which differs from UTF-16 code unit order above the BMP.
fn compare_code_points(x : String, y : String) -> Int32 {
  let xs = x.to_array()
  let ys = y.to_array()
  let n = if xs.length() < ys.length() { xs.length() } else { ys.length() }
  for i in 0..<n {
    let c = xs[i].to_int().compare(ys[i].to_int())
    if c != 0 {
      return c
    }
  }
  xs.length().compare(ys.length())
}

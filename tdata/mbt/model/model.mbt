///|
/// A tdata Value (docs/spec.md §1). Int is an i64 and Double an f64, and they are different
/// values: `Int(1)` never equals `Double(1.0)`. An Instant is nanoseconds since the Unix epoch.
pub(all) enum Value {
  Null
  Bool(Bool)
  Int(Int64)
  Double(Double)
  String(String)
  Bytes(Bytes)
  Instant(Int64)
  Ref(String)
  Array(Array[Value])
  Object(OMap)
  Set(Array[Value])
  Typed(String, Value)
  Node(String, OMap, Array[Value])
}

///|
/// An insertion-ordered map from String keys, looked up linearly: Objects, attributes, headers
/// and meta. Keys are unique; `push` assumes the caller checked.
pub(all) struct OMap {
  keys : Array[String]
  vals : Array[Value]
}

///|
pub fn OMap::new() -> OMap {
  { keys: [], vals: [], }
}

///|
pub fn OMap::length(self : OMap) -> Int32 {
  self.keys.length()
}

///|
pub fn OMap::find(self : OMap, key : String) -> Int32? {
  for i, k in self.keys {
    if k == key {
      return Some(i)
    }
  }
  None
}

///|
pub fn OMap::get(self : OMap, key : String) -> Value? {
  match self.find(key) {
    Some(i) => Some(self.vals[i])
    None => None
  }
}

///|
pub fn OMap::push(self : OMap, key : String, v : Value) -> Unit {
  self.keys.push(key)
  self.vals.push(v)
}

///|
/// A message's payload: a Value, or child messages (never both).
pub(all) enum Payload {
  Data(Value)
  Messages(Array[Message])
}

///|
/// A Message. `meta` maps each dialect URI to an Object of Scalar headers.
pub(all) struct Message {
  id : String
  kind : String
  payload : Payload
  meta : OMap
}

///|
pub fn Value::is_scalar(self : Value) -> Bool {
  match self {
    Null
    | Bool(_)
    | Int(_)
    | Double(_)
    | String(_)
    | Bytes(_)
    | Instant(_)
    | Ref(_) => true
    _ => false
  }
}

///|
/// The kind's name, as tq's `type` reports it.
pub fn Value::kind_name(self : Value) -> String {
  match self {
    Null => "null"
    Bool(_) => "bool"
    Int(_) => "int"
    Double(_) => "double"
    String(_) => "string"
    Bytes(_) => "bytes"
    Instant(_) => "instant"
    Ref(_) => "ref"
    Array(_) => "array"
    Object(_) => "object"
    Set(_) => "set"
    Typed(_, _) => "typed"
    Node(_, _, _) => "node"
  }
}

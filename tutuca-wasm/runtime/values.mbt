// pure-js's values, as the runtime sees them: opaque, made and read through
// the functions every compiled module exports. A component's state is these,
// so nothing is converted between the runtime and a component's code.

///|
#external
pub type Val

///|
extern "wasm" fn v_kind(v : Val) -> Int32 = "values" "v_kind"

///|
extern "wasm" fn v_const(n : Int32) -> Val = "values" "v_const"

///|
extern "wasm" fn v_num(x : Double) -> Val = "values" "v_num"

///|
extern "wasm" fn v_str(s : String) -> Val = "values" "v_str"

///|
extern "wasm" fn v_num_of(v : Val) -> Double = "values" "v_num_of"

///|
extern "wasm" fn v_str_of(v : Val) -> String = "values" "v_str_of"

///|
extern "wasm" fn v_len(v : Val) -> Int32 = "values" "v_len"

///|
extern "wasm" fn v_key(v : Val, i : Int32) -> String = "values" "v_key"

///|
extern "wasm" fn v_at(v : Val, i : Int32) -> Val = "values" "v_at"

///|
extern "wasm" fn list_new() -> Val = "values" "list_new"

///|
extern "wasm" fn list_add(l : Val, v : Val) = "values" "list_add"

///|
extern "wasm" fn obj_new() -> Val = "values" "obj_new"

///|
extern "wasm" fn obj_put(o : Val, k : String, v : Val) = "values" "obj_put"

///|
extern "wasm" fn obj_get(o : Val, k : String) -> Val = "values" "obj_get"

///|
extern "wasm" fn v_freeze(v : Val) -> Val = "values" "freeze"

///|
/// "" for what has no class.
extern "wasm" fn v_class(v : Val) -> String = "values" "v_class"

///|
extern "wasm" fn v_set_class(v : Val, name : String) = "values" "v_set_class"

///|
extern "wasm" fn v_copy(v : Val) -> Val = "values" "v_copy"

///|
extern "wasm" fn v_frozen(v : Val) -> Bool = "values" "v_frozen"

///|
extern "wasm" fn v_same(a : Val, b : Val) -> Bool = "values" "v_same"

///|
extern "wasm" fn v_share(prev : Val, next : Val) -> Val = "values" "v_share"

///|
extern "wasm" fn v_handle(name : String, fields : Val) -> Val = "values" "v_handle"

///|
extern "wasm" fn v_handle_name(v : Val) -> String = "values" "v_handle_name"

///|
/// What a value is.
priv enum Kind {
  Undefined
  Null
  Bool(Bool)
  Num
  Str
  List
  Obj
  Handle
}

///|
fn kind(v : Val) -> Kind {
  match v_kind(v) {
    0 => Undefined
    1 => Null
    2 => Bool(false)
    3 => Bool(true)
    4 => Num
    5 => Str
    6 => List
    7 => Obj
    _ => Handle
  }
}

///|
fn undefined() -> Val {
  v_const(0)
}

///|
fn null_() -> Val {
  v_const(1)
}

///|
fn bool(b : Bool) -> Val {
  v_const(if b { 3 } else { 2 })
}

///|
fn is_undefined(v : Val) -> Bool {
  v_kind(v) == 0
}

///|
fn list_of(items : Array[Val]) -> Val {
  let l = list_new()
  for x in items {
    list_add(l, x)
  }
  l
}

///|
/// A list's items; nothing for what isn't one.
fn items(v : Val) -> Array[Val] {
  let out = []
  if v_kind(v) == 6 {
    for i in 0..<v_len(v) {
      out.push(v_at(v, i))
    }
  }
  out
}

///|
/// A record's keys, in the order they were set; nothing for what isn't one.
fn keys(v : Val) -> Array[String] {
  let out = []
  if v_kind(v) == 7 {
    for i in 0..<v_len(v) {
      out.push(v_key(v, i))
    }
  }
  out
}

///|
/// A record's member, undefined when it has none or isn't a record.
fn get(o : Val, k : String) -> Val {
  if v_kind(o) == 7 {
    obj_get(o, k)
  } else {
    undefined()
  }
}

///|
fn has(o : Val, k : String) -> Bool {
  keys(o).contains(k)
}

///|
fn from_json(j : Json) -> Val {
  match j {
    Null => null_()
    True => bool(true)
    False => bool(false)
    Number(n, ..) => v_num(n)
    String(s) => v_str(s)
    Array(xs) => list_of(xs.map(from_json))
    Object(m) => {
      let o = obj_new()
      for k, x in m {
        obj_put(o, k, from_json(x))
      }
      o
    }
  }
}

///|
/// A value as JSON: a component as its fields, undefined members left out.
fn to_json(v : Val) -> Json {
  match kind(v) {
    Undefined | Null => Json::null()
    Bool(b) => Json::boolean(b)
    Num => {
      let n = v_num_of(v)
      if n != n || n - n != 0.0 {
        Json::null()
      } else {
        Json::number(n)
      }
    }
    Str => Json::string(v_str_of(v))
    List => Json::array(items(v).map(to_json))
    Obj => {
      let m : Map[String, Json] = Map([])
      for i in 0..<v_len(v) {
        let x = v_at(v, i)
        if !is_undefined(x) {
          m[v_key(v, i)] = to_json(x)
        }
      }
      Json::object(m)
    }
    Handle => Json::object(Map([]))
  }
}

///|
/// A value against plain data: what an enum's member is, what a key is.
fn equals_json(v : Val, j : Json) -> Bool {
  match (kind(v), j) {
    (Null, Null) => true
    (Bool(a), True) => a
    (Bool(a), False) => !a
    (Num, Number(n, ..)) => v_num_of(v) == n
    (Str, String(s)) => v_str_of(v) == s
    _ => false
  }
}

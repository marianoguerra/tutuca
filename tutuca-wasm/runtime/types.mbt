// A component's types, as tutuca's src/core/model/types.js: data ({ type:
// kind, ... }) compiled once, each able to say whether a value is one of its
// own and to make one (the value given when it is valid, its default
// otherwise).

///|
extern "wasm" fn regex_test(pattern : String, text : String) -> Bool = "tutuca" "regex_test"

///|
/// What went wrong making a value. no_default: there was nothing valid to
/// make, which a caller may answer with something else.
priv suberror Fault {
  Fault(String, no_default~ : Bool)
}

///|
fn prefixed(prefix : String, e : Fault) -> Fault {
  let Fault(message, no_default~) = e
  Fault("\{prefix}: \{message}", no_default~)
}

///|
priv enum Ty {
  Any
  Str
  Boolean
  Number
  Enum(Array[Json])
  Option(Type)
  List(Type)
  Map(Type)
  Record(Array[(String, Type)])
  OneOf(Array[Type])
  Index(String)
  Component(Array[String])
}

///|
priv struct Type {
  ty : Ty
  default : Json?
  int : Bool
  min : Double?
  max : Double?
  min_length : Int32?
  max_length : Int32?
  pattern : String?
}

///|
fn compile_type(data : Json) -> Type raise Fault {
  let d : Map[String, Json] = match data {
    String(k) => { "type": Json::string(k) }
    Object(m) => m
    _ =>
      raise Fault(
        "a type is a kind's name or { type: kind, ... }",
        no_default=false,
      )
  }
  let sub = (key : String) => {
    match d.get(key) {
      Some(x) => compile_type(x)
      None => compile_type(Json::string("any"))
    }
  }
  let ty : Ty = match d.get("type") {
    Some(String("any")) => Any
    Some(String("string")) => Str
    Some(String("boolean")) => Boolean
    Some(String("number")) => Number
    Some(String("enum")) =>
      match d.get("values") {
        Some(Array(xs)) => Enum(xs)
        _ => raise Fault("an enum needs values", no_default=false)
      }
    Some(String("option")) => Option(sub("of"))
    Some(String("array")) => List(sub("of"))
    Some(String("map")) => Map(sub("of"))
    Some(String("record")) =>
      match d.get("fields") {
        Some(Object(fields)) => {
          let shape = []
          for k, f in fields {
            shape.push((k, compile_type(f)))
          }
          Record(shape)
        }
        _ =>
          raise Fault(
            "a record's fields must map names to types",
            no_default=false,
          )
      }
    Some(String("oneOf")) =>
      match d.get("of") {
        Some(Array(xs)) => {
          let types = []
          for x in xs {
            types.push(compile_type(x))
          }
          OneOf(types)
        }
        _ =>
          raise Fault(
            "a oneOf's of must be an array of types",
            no_default=false,
          )
      }
    Some(String("index")) =>
      match d.get("keyOf") {
        Some(String(f)) => Index(f)
        _ => raise Fault("an index needs keyOf", no_default=false)
      }
    Some(String("component")) =>
      match d.get("of") {
        Some(String(n)) => Component([n])
        Some(Array(ns)) =>
          Component(
            ns.filter_map(n => {
              match n {
                String(s) => Some(s)
                _ => None
              }
            }),
          )
        _ => Component([])
      }
    _ => raise Fault("not a type's kind", no_default=false)
  }
  let number = (key : String) => {
    match d.get(key) {
      Some(Number(n, ..)) => Some(n)
      _ => None
    }
  }
  let min = number("min")
  let max = number("max")
  // A number's default is 0, moved into its bounds.
  let default = match d.get("default") {
    Some(v) => Some(v)
    None =>
      if ty is Number {
        let zero = match (min, max) {
          (Some(lo), _) if 0.0 < lo => lo
          (_, Some(hi)) if 0.0 > hi => hi
          _ => 0.0
        }
        Some(Json::number(zero))
      } else {
        None
      }
  }
  {
    ty,
    default,
    int: d.get("int") is Some(True),
    min,
    max,
    min_length: number("minLength").map(n => n.to_int()),
    max_length: number("maxLength").map(n => n.to_int()),
    pattern: match d.get("pattern") {
      Some(String(p)) => Some(p)
      _ => None
    },
  }
}

///|
/// How long a value is, for minLength and maxLength: a record's keys, a
/// list's items, a string's units.
fn length_of(v : Val) -> Int32 {
  match kind(v) {
    Str => v_str_of(v).length()
    List | Obj => v_len(v)
    _ => 0
  }
}

///|
fn is_integer(v : Val) -> Bool {
  if !(kind(v) is Num) {
    return false
  }
  let n = v_num_of(v)
  n - n == 0.0 && n.floor() == n
}

///|
fn Type::meets_constraints(self : Type, v : Val) -> Bool {
  if self.int && !is_integer(v) {
    return false
  }
  // As JavaScript compares: what isn't a number is never within a bound.
  let within = (bound : Double?, ok : (Double, Double) -> Bool) => {
    match bound {
      None => true
      Some(b) => kind(v) is Num && ok(v_num_of(v), b)
    }
  }
  if !within(self.min, (n, b) => n >= b) || !within(self.max, (n, b) => n <= b) {
    return false
  }
  if self.min_length is Some(n) && length_of(v) < n {
    return false
  }
  if self.max_length is Some(n) && length_of(v) > n {
    return false
  }
  match self.pattern {
    Some(p) => kind(v) is Str && regex_test(p, v_str_of(v))
    None => true
  }
}

///|
/// The keys of the field an index is into: a list's positions, a map's keys.
fn index_keys(owner : Val?, field : String) -> Array[Json] {
  guard owner is Some(o) else { return [] }
  let at = get(o, field)
  match kind(at) {
    List => Array::makei(v_len(at), i => Json::number(i.to_double()))
    Obj => keys(at).map(Json::string)
    _ => []
  }
}

///|
fn Type::is_valid_value(
  self : Type,
  v : Val,
  scope : Scope,
  owner : Val?,
) -> Bool {
  match self.ty {
    Any => true
    Str => kind(v) is Str
    Boolean => kind(v) is Bool(_)
    Number => kind(v) is Num && v_num_of(v) - v_num_of(v) == 0.0
    Enum(members) => members.iter().any(m => equals_json(v, m))
    Option(of) => kind(v) is Null || of.is_valid(v, scope, owner)
    List(of) =>
      kind(v) is List && items(v).iter().all(x => of.is_valid(x, scope, owner))
    Map(of) =>
      kind(v) is Obj &&
      Array::makei(v_len(v), i => v_at(v, i))
      .iter()
      .all(x => of.is_valid(x, scope, owner))
    Record(shape) => {
      if !(kind(v) is Obj) {
        return false
      }
      if keys(v).iter().any(k => !shape.iter().any(f => f.0 == k)) {
        return false
      }
      shape.iter().all(f => f.1.is_valid(get(v, f.0), scope, owner))
    }
    OneOf(types) => types.iter().any(t => t.is_valid(v, scope, owner))
    Index(field) =>
      match owner {
        None => is_integer(v) || kind(v) is Str
        Some(_) => index_keys(owner, field).iter().any(k => equals_json(v, k))
      }
    Component(names) => {
      guard scope.spec_of(v) is Some(spec) else { return false }
      names.length() == 0 ||
      names
      .iter()
      .any(name => {
        // An interface is implemented by what says so, and by the component
        // registered under its name.
        (scope.lookup_spec(name) is Some(registered) && registered.n == spec.n) ||
        (scope.has_interface(name) && spec.implements.contains(name))
      })
    }
  }
}

///|
/// Whether a value is one this type takes. A missing one never is: it takes
/// the default.
fn Type::is_valid(self : Type, v : Val, scope : Scope, owner : Val?) -> Bool {
  if is_undefined(v) {
    return false
  }
  self.is_valid_value(v, scope, owner) && self.meets_constraints(v)
}

///|
fn Type::make_default(
  self : Type,
  scope : Scope,
  owner : Val?,
) -> Val raise Fault {
  match self.default {
    Some(d) => return from_json(d)
    None => ()
  }
  match self.ty {
    Any | Option(_) => null_()
    Str => v_str("")
    Boolean => bool(false)
    Number => v_num(0.0)
    Enum(members) => from_json(members[0])
    List(_) => list_new()
    Map(_) => obj_new()
    Record(shape) => {
      let o = obj_new()
      for f in shape {
        let made = f.1.make(undefined(), scope, owner) catch {
          e => raise prefixed(f.0, e)
        }
        obj_put(o, f.0, made)
      }
      o
    }
    OneOf(types) => types[0].make(undefined(), scope, owner)
    Index(field) =>
      match index_keys(owner, field) {
        [first, ..] => from_json(first)
        [] =>
          raise Fault(
            "\{field} has no key for a required index, make it an option",
            no_default=true,
          )
      }
    Component(names) => {
      guard names.get(0) is Some(name) else {
        raise Fault(
          "a required component with no name has no default, pass one or name it",
          no_default=true,
        )
      }
      if scope.has_interface(name) {
        raise Fault(
          "\{name} is an interface, so it has no default: pass a component",
          no_default=true,
        )
      }
      scope.make(name, undefined())
    }
  }
}

///|
/// The value given when it is one of this type's, its default otherwise.
fn Type::make(
  self : Type,
  v : Val,
  scope : Scope,
  owner : Val?,
) -> Val raise Fault {
  if self.is_valid(v, scope, owner) {
    return v
  }
  let made = self.make_default(scope, owner)
  if !self.meets_constraints(made) {
    raise Fault("has no default that meets its constraints", no_default=true)
  }
  made
}

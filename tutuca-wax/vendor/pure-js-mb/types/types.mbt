// The types the checker works with, as the reference's lib/types.js: a closed
// set of kinds. Containers (lists, tuples, dictionaries, records) say whether
// the program may change them (mutable) and whether that holds for what they
// contain too (deep): a draft is deep and mutable, a read value deep and
// immutable, a fresh literal mutable at its top and holding what it was given.

///|
#derive(Eq, Debug)
pub(all) struct Field {
  ty : Ty
  optional : Bool
  read_only : Bool
}

///|
#derive(Eq, Debug)
pub(all) struct Param {
  name : String
  ty : Ty
  optional : Bool
  rest : Bool
}

///|
#derive(Eq, Debug)
pub(all) struct Sig {
  type_params : Array[String]
  params : Array[Param]
  result : Ty
}

///|
/// What a namespace record knows of itself: its path and its entries' names.
#derive(Eq, Debug)
pub(all) struct Namespace {
  path : String
  entries : Array[String]
}

///|
#derive(Eq, Debug)
pub(all) enum Ty {
  NumberT
  StringT
  BooleanT
  NullT
  UndefinedT
  UnknownT
  VoidT
  NeverT
  LitT(@ast.Lit)
  ListT(elem~ : Ty, mutable~ : Bool, deep~ : Bool)
  TupleT(elems~ : Array[Ty], mutable~ : Bool, deep~ : Bool)
  DictT(value~ : Ty, mutable~ : Bool, deep~ : Bool)
  /// ns: a module's namespace, whose entries code neither reads nor calls.
  RecordT(
    name~ : String?,
    fields~ : Map[String, Field],
    methods~ : Map[String, Array[Sig]],
    mutable~ : Bool,
    deep~ : Bool,
    ns~ : Namespace?
  )
  UnionT(Array[Ty])
  /// A named host type, resolved by the host (records refer to each other by name).
  RefT(name~ : String, mutable~ : Bool)
  /// A host object, nominal: only its fields and methods reach it.
  HandleT(
    name~ : String,
    fields~ : Map[String, Field],
    methods~ : Map[String, Array[Sig]]
  )
  /// A host function or method: its overloads. Only ever called.
  FnT(Array[Sig])
  /// A host namespace: only its members reach it.
  ModuleT(String)
  /// A type parameter of a signature.
  VarT(String)
}

///|
pub fn primitive(name : String) -> Ty? {
  match name {
    "number" => Some(NumberT)
    "string" => Some(StringT)
    "boolean" => Some(BooleanT)
    "null" => Some(NullT)
    "undefined" => Some(UndefinedT)
    "unknown" => Some(UnknownT)
    "void" => Some(VoidT)
    "never" => Some(NeverT)
    _ => None
  }
}

///|
pub fn list(elem : Ty, mutable~ : Bool = false, deep~ : Bool = true) -> Ty {
  ListT(elem~, mutable~, deep~)
}

///|
pub fn Ty::is_container(self : Ty) -> Bool {
  self is (ListT(..) | TupleT(..) | DictT(..) | RecordT(..))
}

///|
/// The top-level mutability of a container or a ref; false for anything else.
pub fn Ty::top_mut(self : Ty) -> Bool {
  match self {
    ListT(mutable~, ..)
    | TupleT(mutable~, ..)
    | DictT(mutable~, ..)
    | RecordT(mutable~, ..)
    | RefT(mutable~, ..) => mutable
    _ => false
  }
}

///|
/// t with mutability m, for it and (lazily, as they're reached) what it holds.
pub fn with_mut(t : Ty, m : Bool) -> Ty {
  match t {
    ListT(elem~, ..) => ListT(elem~, mutable=m, deep=true)
    TupleT(elems~, ..) => TupleT(elems~, mutable=m, deep=true)
    DictT(value~, ..) => DictT(value~, mutable=m, deep=true)
    RecordT(name~, fields~, methods~, ns~, ..) =>
      RecordT(name~, fields~, methods~, mutable=m, deep=true, ns~)
    RefT(name~, ..) => RefT(name~, mutable=m)
    UnionT(ts) => union(ts.map(u => with_mut(u, m)))
    _ => t
  }
}

///|
/// A fresh container: the program may change it, what it holds is as typed.
pub fn fresh(t : Ty) -> Ty {
  match t {
    ListT(elem~, ..) => ListT(elem~, mutable=true, deep=false)
    TupleT(elems~, ..) => TupleT(elems~, mutable=true, deep=false)
    DictT(value~, ..) => DictT(value~, mutable=true, deep=false)
    RecordT(name~, fields~, methods~, ns~, ..) =>
      RecordT(name~, fields~, methods~, mutable=true, deep=false, ns~)
    _ => t
  }
}

///|
fn inner(mutable : Bool, deep : Bool, t : Ty) -> Ty {
  if deep {
    with_mut(t, mutable)
  } else {
    t
  }
}

///|
pub fn elem_of(t : Ty) -> Ty {
  match t {
    ListT(elem~, mutable~, deep~) => inner(mutable, deep, elem)
    _ => UnknownT
  }
}

///|
pub fn tuple_elem_of(t : Ty, i : Int32) -> Ty {
  match t {
    TupleT(elems~, mutable~, deep~) => inner(mutable, deep, elems[i])
    _ => UnknownT
  }
}

///|
pub fn dict_value_of(t : Ty) -> Ty {
  match t {
    DictT(value~, mutable~, deep~) => inner(mutable, deep, value)
    _ => UnknownT
  }
}

///|
/// The type a field reads as: its type, or undefined too when it's optional.
pub fn field_type_of(t : Ty, f : Field) -> Ty {
  let ty = match t {
    RecordT(mutable~, deep~, ..) => inner(mutable, deep, f.ty)
    _ => f.ty
  }
  if f.optional {
    union([ty, UndefinedT])
  } else {
    ty
  }
}

///|
fn is_literal_of(l : Ty, base : Ty) -> Bool {
  match (l, base) {
    (LitT(LNum(_)), NumberT)
    | (LitT(LStr(_)), StringT)
    | (LitT(LBool(_)), BooleanT) => true
    _ => false
  }
}

///|
fn base_of_lit(l : @ast.Lit) -> Ty {
  match l {
    LNum(_) => NumberT
    LStr(_) => StringT
    LBool(_) => BooleanT
    LNull => NullT
  }
}

///|
fn lit_falsy(l : @ast.Lit) -> Bool {
  match l {
    LNum(n) => n == 0.0 || n != n
    LStr(s) => s == ""
    LBool(b) => !b
    LNull => true
  }
}

///|
fn set_mut(t : Ty, m : Bool) -> Ty {
  match t {
    ListT(elem~, deep~, ..) => ListT(elem~, mutable=m, deep~)
    TupleT(elems~, deep~, ..) => TupleT(elems~, mutable=m, deep~)
    DictT(value~, deep~, ..) => DictT(value~, mutable=m, deep~)
    RecordT(name~, fields~, methods~, deep~, ns~, ..) =>
      RecordT(name~, fields~, methods~, mutable=m, deep~, ns~)
    RefT(name~, ..) => RefT(name~, mutable=m)
    _ => t
  }
}

///|
/// Unions, normalized: flat, without duplicates, literals absorbed by their base.
pub fn union(types : ArrayView[Ty]) -> Ty {
  let flat = []
  for t in types {
    match t {
      UnionT(ts) => flat.push_iter(ts.iter())
      NeverT => ()
      _ => flat.push(t)
    }
  }
  if flat.iter().any(t => t is UnknownT) {
    return UnknownT
  }
  let out : Array[Ty] = []
  let keys : Map[String, Int32] = Map([])
  for t in flat {
    let key = type_key(t)
    match keys.get(key) {
      Some(at) => {
        // The same type twice: what may change only when both may.
        if t.is_container() || t is RefT(..) {
          out[at] = set_mut(out[at], out[at].top_mut() && t.top_mut())
        }
        continue
      }
      None => ()
    }
    keys[key] = out.length()
    out.push(t)
  }
  let bases = out.filter(t => t is (NumberT | StringT | BooleanT))
  let mut result = out.filter(t => {
    !(t is LitT(l) && bases.contains(base_of_lit(l)))
  })
  let has_true = result.iter().any(t => t is LitT(LBool(true)))
  let has_false = result.iter().any(t => t is LitT(LBool(false)))
  if has_true && has_false {
    result = result.filter(t => !(t is LitT(LBool(_))))
    result.push(BooleanT)
  }
  match result.length() {
    0 => NeverT
    1 => result[0]
    _ => UnionT(result)
  }
}

///|
pub fn members(t : Ty) -> Array[Ty] {
  match t {
    UnionT(ts) => ts
    NeverT => []
    _ => [t]
  }
}

///|
pub fn filter_union(t : Ty, keep : (Ty) -> Bool) -> Ty {
  union(members(t).filter(keep))
}

///|
pub fn widen(t : Ty) -> Ty {
  match t {
    LitT(l) => base_of_lit(l)
    UnionT(ts) => union(ts.map(widen))
    _ => t
  }
}

///|
pub fn is_nullish(t : Ty) -> Bool {
  t is (NullT | UndefinedT | VoidT)
}

///|
pub fn has_nullish(t : Ty) -> Bool {
  members(t).iter().any(is_nullish)
}

///|
pub fn remove_nullish(t : Ty) -> Ty {
  filter_union(t, u => !is_nullish(u))
}

///|
pub fn is_booleanish(t : Ty) -> Bool {
  members(t).iter().all(u => u is (BooleanT | LitT(LBool(_))))
}

///|
/// A test takes a boolean, or a value that may be null or undefined, so that no
/// number or string is converted to a boolean behind the program's back.
pub fn is_testable(t : Ty) -> Bool {
  t is NeverT || (!(t is UnknownT) && (is_booleanish(t) || has_nullish(t)))
}

///|
pub fn is_primitive(t : Ty) -> Bool {
  members(t).iter().all(u => u is (NumberT | StringT | BooleanT | LitT(_)))
}

///|
pub fn is_numberish(t : Ty) -> Bool {
  members(t).iter().all(u => u is (NumberT | LitT(LNum(_))))
}

///|
pub fn is_stringish(t : Ty) -> Bool {
  members(t).iter().all(u => u is (StringT | LitT(LStr(_))))
}

///|
fn can_be_falsy(u : Ty) -> Bool {
  is_nullish(u) ||
  u is (BooleanT | NumberT | StringT) ||
  (match u {
    LitT(l) => lit_falsy(l)
    _ => false
  })
}

///|
pub fn narrow_truthy(t : Ty, sense : Bool) -> Ty {
  if sense {
    filter_union(t, u => !is_nullish(u) && !(u is LitT(l) && lit_falsy(l)))
  } else {
    filter_union(t, can_be_falsy)
  }
}

///|
/// typeof's answer for a type, or None when it may be several.
fn typeof_tag(u : Ty) -> String? {
  match u {
    NumberT => Some("number")
    StringT => Some("string")
    BooleanT => Some("boolean")
    UndefinedT | VoidT => Some("undefined")
    LitT(LNum(_)) => Some("number")
    LitT(LStr(_)) => Some("string")
    LitT(LBool(_)) => Some("boolean")
    LitT(LNull)
    | NullT
    | ListT(..)
    | TupleT(..)
    | DictT(..)
    | RecordT(..)
    | RefT(..)
    | HandleT(..) => Some("object")
    FnT(_) => Some("function")
    _ => None
  }
}

///|
pub fn narrow_typeof(t : Ty, tag : String, sense : Bool) -> Ty {
  if t is UnknownT {
    if !sense {
      return t
    }
    return match tag {
      "string" => StringT
      "number" => NumberT
      "boolean" => BooleanT
      "undefined" => UndefinedT
      _ => t
    }
  }
  filter_union(t, u => {
    match typeof_tag(u) {
      None => true
      Some(ut) => if sense { ut == tag } else { ut != tag }
    }
  })
}

///|
fn equal_to(u : Ty, v : Ty) -> Bool {
  type_key(u) == type_key(v) || (u is VoidT && v is UndefinedT)
}

///|
/// x === v and x !== v, for v a literal, null or undefined.
pub fn narrow_equals(t : Ty, v : Ty, sense : Bool) -> Ty {
  if t is UnknownT {
    return if sense { v } else { t }
  }
  if sense {
    let replaced = union(
      members(t).map(u => {
        match v {
          LitT(l) if base_of_lit(l) == u => v
          _ => u
        }
      }),
    )
    filter_union(replaced, u => equal_to(u, v))
  } else {
    filter_union(t, u => !equal_to(u, v))
  }
}

///|
/// A short text that is the same for types that are the same (mutability aside).
pub fn type_key(t : Ty) -> String {
  type_to_string(t)
}

///|
/// Assignability: whether a value of type s may go where t is expected.
/// Mutability is not part of it: what may change is decided at the place that
/// changes it. resolve turns a ref into what it names; bindings, when given,
/// binds type parameters of t as it goes.
pub(all) struct Relation {
  resolve_ref : (Ty) -> Ty
  bindings : Map[String, Ty]?
  assuming : Array[String]
}

///|
pub fn Relation::new(
  resolve_ref : (Ty) -> Ty,
  bindings? : Map[String, Ty],
) -> Relation {
  { resolve_ref, bindings, assuming: [], }
}

///|
pub fn Relation::resolve(self : Relation, t0 : Ty) -> Ty {
  let mut t = t0
  while t is RefT(..) {
    t = (self.resolve_ref)(t)
  }
  t
}

///|
pub fn Relation::assignable(self : Relation, s0 : Ty, t0 : Ty) -> Bool {
  let s = self.resolve(s0)
  let t = self.resolve(t0)
  if t is VarT(name) {
    match self.bindings {
      None => return s is VarT(n) && n == name
      Some(bindings) =>
        match bindings.get(name) {
          None => {
            bindings[name] = widen(s)
            return true
          }
          Some(bound) => {
            if self.assignable(s, bound) {
              return true
            }
            // A later argument may widen what an earlier one bound: [] then [1].
            if self.assignable(bound, widen(s)) {
              bindings[name] = widen(s)
              return true
            }
            return false
          }
        }
    }
  }
  if s is NeverT {
    return true
  }
  if t is UnknownT {
    return !(s is (HandleT(..) | FnT(_) | ModuleT(_) | VoidT))
  }
  if s is UnionT(ss) {
    return ss.iter().all(u => self.assignable(u, t))
  }
  if t is UnionT(ts) {
    return ts.iter().any(u => self.assignable(s, u))
  }
  match t {
    NumberT | StringT | BooleanT => s == t || is_literal_of(s, t)
    NullT | UndefinedT => s == t
    VoidT => s is (VoidT | UndefinedT)
    LitT(tl) => s is LitT(sl) && sl == tl
    ListT(..) =>
      match s {
        ListT(..) => self.assignable(elem_of(s), elem_of(t))
        TupleT(elems~, ..) =>
          elems
          .mapi((i, _) => i)
          .iter()
          .all(i => self.assignable(tuple_elem_of(s, i), elem_of(t)))
        _ => false
      }
    TupleT(elems=te, ..) =>
      match s {
        TupleT(elems=se, ..) =>
          se.length() == te.length() &&
          se
          .mapi((i, _) => i)
          .iter()
          .all(i => self.assignable(tuple_elem_of(s, i), tuple_elem_of(t, i)))
        _ => false
      }
    DictT(..) =>
      match s {
        DictT(..) => self.assignable(dict_value_of(s), dict_value_of(t))
        RecordT(fields~, methods~, ..) =>
          methods.length() == 0 &&
          fields
          .values()
          .all(f => self.assignable(field_type_of(s, f), dict_value_of(t)))
        _ => false
      }
    RecordT(..) => s is RecordT(..) && self.record_assignable(s, t)
    HandleT(name=tn, ..) => s is HandleT(name=sn, ..) && sn == tn
    _ => false
  }
}

///|
fn Relation::record_assignable(self : Relation, s : Ty, t : Ty) -> Bool {
  guard s is RecordT(name=sname, fields=sfields, methods=smethods, ..) &&
    t is RecordT(name=tname, fields=tfields, methods=tmethods, ..) else {
    return false
  }
  if sname is Some(a) && tname == Some(a) {
    return true
  }
  let key = "\{type_key(s)}<:\{type_key(t)}"
  if self.assuming.contains(key) {
    return true
  }
  self.assuming.push(key)
  let ok = (fn() {
    for name, tf in tfields {
      match sfields.get(name) {
        None => if !tf.optional { return false }
        Some(sf) => {
          if sf.optional && !tf.optional {
            return false
          }
          if !self.assignable(field_type_of(s, sf), field_type_of(t, tf)) {
            return false
          }
        }
      }
    }
    for name, _ in tmethods {
      if smethods.get(name) is None {
        return false
      }
    }
    true
  })()
  ignore(self.assuming.pop())
  ok
}

///|
/// t with what its references name followed, through unions: an alias of a
/// union (type T = "a" | "b") is its members, as a comparison sees them.
fn Relation::expand(self : Relation, t : Ty, seen : Array[String]) -> Ty {
  let out = []
  for m in members(t) {
    match m {
      RefT(name~, ..) if !seen.contains(name) => {
        let r = self.resolve(m)
        if r is UnionT(_) {
          out.append(members(self.expand(r, [..seen, name])))
        } else {
          out.push(r)
        }
      }
      _ => out.push(m)
    }
  }
  union(out[:])
}

///|
/// Whether === between the two can ever be true: TypeScript rejects a
/// comparison that can't.
pub fn Relation::comparable(self : Relation, a0 : Ty, b0 : Ty) -> Bool {
  let a = self.expand(a0, [])
  let b = self.expand(b0, [])
  if has_nullish(a) ||
    has_nullish(b) ||
    a is (UnknownT | NeverT) ||
    b is (UnknownT | NeverT) {
    return true
  }
  members(a)
  .iter()
  .any(x => {
    members(b).iter().any(y => self.overlap(self.resolve(x), self.resolve(y)))
  })
}

///|
fn Relation::overlap(self : Relation, x : Ty, y : Ty) -> Bool {
  match (x, y) {
    (LitT(a), LitT(b)) => a == b
    (LitT(a), _) => base_of_lit(a) == y
    (_, LitT(b)) => base_of_lit(b) == x
    _ => self.assignable(x, y) || self.assignable(y, x)
  }
}

///|
/// Member access and calls, links of a chain: (type, short), short when an
/// optional link may make the whole chain undefined.
fn Checker::link(self : Checker, e : @ast.Expr, env : Env) -> (Ty, Bool) {
  match e {
    Call(..) => self.call(e, env)
    Member(object~, property~, computed~, optional~, ..) => {
      let (obj0, s0) = self.object(object, env)
      let mut obj_t = obj0
      let mut short = s0
      if optional {
        if @types.has_nullish(obj_t) {
          short = true
        }
        obj_t = @types.remove_nullish(obj_t)
      }
      if computed {
        return (self.index(e, obj_t, env), short)
      }
      guard property is Ident(p) else { return (UnknownT, short) }
      let name = p.name
      if obj_t is ModuleT(m) {
        match self.host.find_member(m, name) {
          None => {
            self.error(UnknownMember, p.span, "the module \{m} has no \{name}")
            return (NeverT, short)
          }
          Some(found) => return (found.ty, short)
        }
      }
      if @tables.is_module_only(name) {
        self.error(
          ReservedName,
          p.span,
          "only a module's member may be called \{name}",
        )
        return (NeverT, short)
      }
      match self.path_key(e) {
        Some(key) =>
          match env.refine.get(key) {
            Some(t) => return (t, short)
            None => ()
          }
        None => ()
      }
      (self.property(e, obj_t, name), short)
    }
    _ => (self.expr(e, env, None), false)
  }
}

///|
/// The object of a member or the receiver of a method: a link when it is one.
fn Checker::object(self : Checker, e : @ast.Expr, env : Env) -> (Ty, Bool) {
  match e {
    Member(..) | Call(..) => {
      let r = self.link(e, env)
      // Its mode too, so the member it is the object of has one.
      self.set_mode(e, self.compute_mode(e, r.0))
      r
    }
    _ => (self.expr(e, env, None), false)
  }
}

///|
fn member_object(e : @ast.Expr) -> @ast.Expr {
  match e {
    Member(object~, ..) => object
    _ => e
  }
}

///|
fn member_property_span(e : @ast.Expr) -> @ast.Span {
  match e {
    Member(property~, ..) => property.span()
    _ => e.span()
  }
}

///|
fn Checker::property(
  self : Checker,
  e : @ast.Expr,
  obj0 : Ty,
  name : String,
) -> Ty {
  let mut obj_t = obj0
  let object = member_object(e)
  if @types.has_nullish(obj_t) {
    self.error(
      PossiblyNull,
      object.span(),
      "\{self.describe(object)} may be \{show(@types.filter_union(obj_t, @types.is_nullish))}: check it first, or use ?.",
    )
    obj_t = @types.remove_nullish(obj_t)
  }
  let out = []
  for u0 in @types.members(self.expand(obj_t)) {
    let u = self.resolve(u0)
    match self.property_of(e, u, name) {
      None => return NeverT
      Some(t) => out.push(t)
    }
  }
  @types.union(out)
}

///|
fn receiver_kind(u : Ty) -> @tables.Receiver? {
  match u {
    ListT(..) | TupleT(..) => Some(ListReceiver)
    StringT | LitT(LStr(_)) => Some(StringReceiver)
    NumberT | LitT(LNum(_)) => Some(NumberReceiver)
    _ => None
  }
}

///|
fn Checker::property_of(
  self : Checker,
  e : @ast.Expr,
  u : Ty,
  name : String,
) -> Ty? {
  let object = member_object(e)
  let where_ = self.describe(object)
  let pspan = member_property_span(e)
  match u {
    RecordT(ns=Some(ns), ..) if ns.entries.contains(name) => {
      self.error(
        EntryAccess,
        pspan,
        "\{where_}.\{name} is an entry the embedder calls, not something code reads or calls: move what both need to a function",
      )
      None
    }
    RecordT(fields~, methods~, ..) | HandleT(fields~, methods~, ..) => {
      match fields.get(name) {
        Some(f) =>
          return Some(
            if u is HandleT(..) {
              @types.with_mut(@types.field_type_of(u, f), false)
            } else {
              @types.field_type_of(u, f)
            },
          )
        None => ()
      }
      if methods.get(name) is Some(_) {
        self.error(
          MethodNotCalled,
          pspan,
          "\{name} is a method of \{show(u)}: call it",
        )
        return None
      }
      self.error(UnknownProperty, pspan, "\{show(u)} has no \{name}")
      None
    }
    DictT(..) => {
      self.error(
        DictDotAccess,
        pspan,
        "\{where_} is a dictionary: read it as \{where_}[\{@types.json_string(name)}]",
      )
      None
    }
    UnknownT => {
      self.error(
        UnknownMember,
        e.span(),
        "nothing is known of \{where_} (it is unknown): narrow it first, with typeof",
      )
      None
    }
    _ => {
      match receiver_kind(u) {
        Some(kind) => {
          if name == "length" && @tables.has_length(kind) {
            return Some(NumberT)
          }
          if @tables.find_method(kind, name) is Some(_) {
            self.error(MethodNotCalled, pspan, "\{name} is a method: call it")
            return None
          }
        }
        None => ()
      }
      self.error(UnknownProperty, pspan, "\{show(u)} has no property \{name}")
      None
    }
  }
}

///|
fn Checker::index(self : Checker, e : @ast.Expr, obj0 : Ty, env : Env) -> Ty {
  guard e is Member(object~, property~, ..) else { return UnknownT }
  let kt = self.value(property, env, None)
  let mut obj_t = obj0
  if @types.has_nullish(obj_t) {
    self.error(
      PossiblyNull,
      object.span(),
      "\{self.describe(object)} may be \{show(@types.filter_union(obj_t, @types.is_nullish))}: check it first",
    )
    obj_t = @types.remove_nullish(obj_t)
  }
  let out = []
  for u0 in @types.members(self.expand(obj_t)) {
    let u = self.resolve(u0)
    if u is (ListT(..) | TupleT(..)) || receiver_kind(u) == Some(StringReceiver) {
      if !@types.is_numberish(kt) {
        self.error(
          IndexType,
          property.span(),
          "a list or a string is indexed by a number; \{self.describe(property)} is \{show(kt)}",
        )
        return UnknownT
      }
      match (u, kt) {
        (TupleT(elems~, ..), LitT(LNum(n))) if n.to_int().to_double() == n &&
          n >= 0.0 &&
          n < elems.length().to_double() =>
          out.push(@types.tuple_elem_of(u, n.to_int()))
        (TupleT(elems~, ..), _) => {
          let all = elems.mapi((i, _) => @types.tuple_elem_of(u, i))
          all.push(UndefinedT)
          out.push(@types.union(all))
        }
        (ListT(..), _) =>
          out.push(@types.union([@types.elem_of(u), UndefinedT]))
        _ => out.push(@types.union([StringT, UndefinedT]))
      }
    } else if u is DictT(..) {
      if !@types.is_stringish(kt) {
        self.error(
          IndexType,
          property.span(),
          "a dictionary is indexed by a string; \{self.describe(property)} is \{show(kt)}",
        )
        return UnknownT
      }
      out.push(@types.union([@types.dict_value_of(u), UndefinedT]))
    } else if u is RecordT(..) {
      self.error(
        RecordComputedKey,
        e.span(),
        "\{self.describe(object)} is a record: read its fields by name, or make it a dictionary",
      )
      return UnknownT
    } else {
      self.error(
        IndexType,
        e.span(),
        "\{self.describe(object)} is \{show(u)}, which can't be indexed",
      )
      return UnknownT
    }
  }
  @types.union(out)
}

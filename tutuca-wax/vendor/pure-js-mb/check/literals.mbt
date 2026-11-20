///|
/// Literals: fresh values, which the program may change; their elements are
/// what they were given. An expected type flows into them.
fn Checker::array_literal(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  expected0 : Ty?,
) -> Ty {
  guard e is ArrayLit(elements, span~) else { return UnknownT }
  let expected = expected0.map(t => self.resolve(@types.remove_nullish(t)))
  match expected {
    Some(TupleT(elems~, ..) as tuple) if !elements
      .iter()
      .any(x => x is Some(Spread(_, ..))) => {
      let out = elements.mapi((i, x) => {
        match x {
          None => @types.UndefinedT
          Some(x) =>
            self.value(
              x,
              env,
              if i < elems.length() {
                Some(@types.tuple_elem_of(tuple, i))
              } else {
                None
              },
            )
        }
      })
      return TupleT(elems=out, mutable=true, deep=false)
    }
    _ => ()
  }
  let exp_elem = match expected {
    Some(ListT(..) as l) => Some(@types.elem_of(l))
    _ => None
  }
  let parts = []
  for x in elements {
    match x {
      None => ()
      Some(Spread(arg, span=sspan)) => {
        let st = self.resolve(self.value(arg, env, None))
        let held = match st {
          ListT(..) => {
            parts.push(@types.elem_of(st))
            Some(@types.elem_of(st))
          }
          TupleT(elems~, ..) => {
            for i, _ in elems {
              parts.push(@types.tuple_elem_of(st, i))
            }
            Some(
              @types.union(elems.mapi((i, _) => @types.tuple_elem_of(st, i))),
            )
          }
          _ => {
            self.error(
              SpreadType,
              sspan,
              "only a list can be spread into a list; \{self.describe(arg)} is \{show(st)}",
            )
            None
          }
        }
        match (exp_elem, held) {
          (Some(el), Some(h)) if !self.assignable(h, el) =>
            self.error(
              NotAssignable,
              sspan,
              "\{self.describe(arg)} holds \{show(h)}, where \{show(el)} is expected",
            )
          _ => ()
        }
      }
      // What the list is said to hold is what each element must be.
      Some(x) => {
        let t = self.value(x, env, exp_elem)
        match exp_elem {
          Some(el) if !self.assignable(t, el) =>
            self.error(
              NotAssignable,
              x.span(),
              "\{self.describe(x)} is \{show(t)}, where \{show(el)} is expected",
            )
          _ => ()
        }
        parts.push(t)
      }
    }
  }
  match exp_elem {
    Some(el) => return ListT(elem=el, mutable=true, deep=false)
    None => ()
  }
  if parts.length() == 0 {
    self.error(
      EmptyArrayType,
      span,
      "nothing says what this empty list holds: annotate it, const xs: string[] = [];",
    )
    return ListT(elem=UnknownT, mutable=true, deep=false)
  }
  ListT(elem=@types.union(parts.map(@types.widen)), mutable=true, deep=false)
}

///|
fn key_name(k : @ast.PropKey) -> String {
  match k {
    KIdent(id) => id.name
    KLit(LStr(s), ..) => s
    KLit(LNum(n), ..) => @types.number_text(n)
    KLit(v, ..) => @types.lit_text(v)
    KComputed(_) => ""
  }
}

///|
fn Checker::object_literal(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  expected0 : Ty?,
) -> Ty {
  guard e is ObjectLit(members, span~) else { return UnknownT }
  let expected = expected0.map(t => self.resolve(@types.remove_nullish(t)))
  let exp_record = match expected {
    Some(RecordT(..) as r) => Some(r)
    _ => None
  }
  let exp_dict = match expected {
    Some(DictT(..) as d) => Some(d)
    _ => None
  }
  let fields : Map[String, @types.Field] = Map([])
  let mut dict_values : Array[Ty]? = None
  let seen = []
  for m in members {
    match m {
      // A namespace's: the module checks its entries.
      Method(..) => ()
      SpreadMember(arg, span=sspan) => {
        let st = self.resolve(self.value(arg, env, None))
        match st {
          RecordT(fields=sf, ..) =>
            for n, f in sf {
              fields[n] = {
                ty: @types.field_type_of(st, f),
                optional: f.optional,
                read_only: false,
              }
            }
          DictT(..) => {
            let vs = dict_values.unwrap_or([])
            vs.push(@types.dict_value_of(st))
            dict_values = Some(vs)
          }
          _ =>
            self.error(
              SpreadType,
              sspan,
              "only a record or a dictionary can be spread into an object; \{self.describe(arg)} is \{show(st)}",
            )
        }
      }
      Prop(key=KComputed(_), value~, ..) => ignore(self.value(value, env, None))
      Prop(key~, value~, ..) => {
        let name = key_name(key)
        if seen.contains(name) {
          self.error(DuplicateKey, key.span(), "\{name} is given twice")
        }
        seen.push(name)
        let mut fexp : Ty? = None
        match exp_record {
          Some(RecordT(fields=rf, ..) as rec) =>
            match rf.get(name) {
              None =>
                self.error(
                  ExcessProperty,
                  key.span(),
                  "\{show(rec)} has no field \{name}",
                )
              Some(f) => fexp = Some(@types.field_type_of(rec, f))
            }
          _ =>
            match exp_dict {
              Some(d) => fexp = Some(@types.dict_value_of(d))
              None => ()
            }
        }
        let t = self.value(value, env, fexp)
        match fexp {
          Some(fe) if !self.assignable(t, fe) =>
            self.error(
              NotAssignable,
              value.span(),
              "\{name} is \{show(fe)}; this is \{show(t)}",
            )
          _ => ()
        }
        fields[name] = {
          ty: fexp.unwrap_or(@types.widen(t)),
          optional: false,
          read_only: false,
        }
      }
    }
  }
  match exp_record {
    Some(RecordT(fields=rf, ..) as rec) => {
      let missing = []
      for n, f in rf {
        if !f.optional && fields.get(n) is None {
          missing.push(n)
        }
      }
      if missing.length() > 0 {
        self.error(
          MissingProperty,
          span,
          "\{show(rec)} needs \{missing.join(", ")}",
        )
      }
    }
    _ => ()
  }
  if dict_values is Some(_) || exp_dict is Some(_) {
    let values = dict_values.unwrap_or([]).copy()
    for _, f in fields {
      values.push(f.ty)
    }
    let value = match exp_dict {
      Some(d) => @types.dict_value_of(d)
      None =>
        @types.union(if values.length() == 0 { [UnknownT] } else { values })
    }
    return DictT(value~, mutable=true, deep=false)
  }
  match exp_record {
    Some(RecordT(name=Some(n), fields=rf, methods~, ..)) if fields
      .keys()
      .all(k => rf.contains(k)) =>
      return RecordT(
        name=Some(n),
        fields=rf,
        methods~,
        mutable=true,
        deep=true,
        ns=None,
      )
    _ => ()
  }
  RecordT(
    name=None,
    fields~,
    methods=Map([]),
    mutable=true,
    deep=false,
    ns=None,
  )
}

///|
/// Assignments: to a field of a record, an element of a list, a key of a
/// dictionary, all of them mutable. After it, the place is known to hold what
/// was assigned.
fn Checker::assignment(self : Checker, e : @ast.Expr, env : Env) -> Unit {
  guard e is Assign(op~, left~, right~, span~) else { return }
  if left is Ident(_) {
    return self.assign_name(e, env)
  }
  guard left is Member(object~, property~, computed~, ..) else {
    ignore(self.value(right, env, None))
    return
  }
  let (obj0, _) = self.object(object, env)
  let mut obj_t = obj0
  if @types.has_nullish(obj_t) {
    self.error(
      PossiblyNull,
      object.span(),
      "\{self.describe(object)} may be \{show(@types.filter_union(obj_t, @types.is_nullish))}: check it first",
    )
    obj_t = @types.remove_nullish(obj_t)
  }
  let o = self.resolve(
    match obj_t {
      UnionT(ts) => ts[0]
      _ => obj_t
    },
  )
  let where_ = self.describe(object)
  let mut place_t : Ty = UnknownT
  let mut ok = true
  if computed {
    let kt = self.value(property, env, None)
    match o {
      ListT(..) => {
        if !@types.is_numberish(kt) {
          self.error(
            IndexType,
            property.span(),
            "a list is indexed by a number; \{self.describe(property)} is \{show(kt)}",
          )
        }
        place_t = @types.elem_of(o)
      }
      DictT(..) => {
        if !@types.is_stringish(kt) {
          self.error(
            IndexType,
            property.span(),
            "a dictionary is indexed by a string; \{self.describe(property)} is \{show(kt)}",
          )
        }
        place_t = @types.dict_value_of(o)
      }
      RecordT(..) => {
        self.error(
          RecordComputedKey,
          left.span(),
          "\{where_} is a record: set its fields by name",
        )
        ok = false
      }
      _ => {
        self.error(
          ImmutableTarget,
          left.span(),
          "\{where_} is \{show(o)}, which can't be changed",
        )
        ok = false
      }
    }
  } else {
    let name = match property {
      Ident(p) => p.name
      _ => ""
    }
    match o {
      RecordT(fields~, ..) =>
        match fields.get(name) {
          None => {
            self.error(
              UnknownProperty,
              property.span(),
              "\{show(o)} has no field \{name}",
            )
            ok = false
          }
          Some(f) =>
            if f.read_only {
              self.error(
                ReadonlyProperty,
                property.span(),
                "\{name} is read-only",
              )
              ok = false
            } else {
              place_t = @types.field_type_of(o, f)
            }
        }
      DictT(..) => {
        self.error(
          DictDotAccess,
          property.span(),
          "\{where_} is a dictionary: set it as \{where_}[\{@types.json_string(name)}]",
        )
        ok = false
      }
      UnknownT => {
        self.error(
          UnknownMember,
          left.span(),
          "nothing is known of \{where_} (it is unknown)",
        )
        ok = false
      }
      _ => {
        self.error(
          ImmutableTarget,
          left.span(),
          "\{where_} is \{show(o)}, whose properties can't be set",
        )
        ok = false
      }
    }
  }
  if ok && o.is_container() && !o.top_mut() {
    match self.read_only_help(object) {
      Some(h) =>
        self.error(
          ImmutableTarget,
          left.span(),
          "\{where_} is read-only here",
          help=h,
        )
      None =>
        self.error(ImmutableTarget, left.span(), "\{where_} is read-only here")
    }
  }
  let r = self.value(right, env, if ok { Some(place_t) } else { None })
  if op == "=" {
    if ok && !self.assignable(r, place_t) {
      self.error(
        NotAssignable,
        right.span(),
        "\{self.describe(left)} is \{show(place_t)}; this is \{show(r)}",
      )
    }
  } else {
    let numeric = @types.is_numberish(place_t) && @types.is_numberish(r)
    let strings = op == "+=" &&
      @types.is_stringish(place_t) &&
      @types.is_stringish(r)
    if ok && !numeric && !strings {
      let what = if op == "+=" {
        "two numbers or two strings"
      } else {
        "two numbers"
      }
      self.error(
        OperandType,
        span,
        "\{op} takes \{what}; here \{show(place_t)} and \{show(r)}",
      )
    }
  }
  match self.path_key(left) {
    Some(key) => {
      env.forget_under(Some(key))
      env.refine[key] = if op == "=" { r } else { @types.widen(place_t) }
    }
    None => env.forget_under(self.path_key(object))
  }
}

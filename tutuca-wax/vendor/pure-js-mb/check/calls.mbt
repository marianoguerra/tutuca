///|
/// What a call calls: its overloads, the type parameters already bound (a
/// list's T), its qualified name, and, for a method, the table's row and the
/// receiver.
priv struct Target {
  sigs : Array[@types.Sig]
  bindings : Map[String, Ty]
  qualified : String
  describe : String
  row : @tables.Method?
  receiver : Ty?
  receiver_key : String?
  receiver_node : @ast.Expr?
  /// A module's helper: whether its result is fresh, the parameters it may change.
  fresh : Bool
  mut_params : Array[String]?
}

///|
fn target(
  sigs : Array[@types.Sig],
  qualified : String,
  describe : String,
) -> Target {
  {
    sigs,
    bindings: Map([]),
    qualified,
    describe,
    row: None,
    receiver: None,
    receiver_key: None,
    receiver_node: None,
    fresh: false,
    mut_params: None,
  }
}

///|
fn Checker::is_module(self : Checker, e : @ast.Expr) -> Bool {
  match e {
    Ident(id) =>
      self.scope.lookup(id.name) is None &&
      self.host.binding(id.name) is Some(ModuleBinding(_, ..))
    _ => false
  }
}

///|
/// Calls: of a host function (or callable module), of a module's member, of a
/// method of a list, string or number, of a record's or handle's method.
fn Checker::call(self : Checker, e : @ast.Expr, env : Env) -> (Ty, Bool) {
  guard e is Call(callee~, args~, ..) else { return (UnknownT, false) }
  let mut tgt : Target? = None
  let mut short = false
  match callee {
    Member(object~, property=Ident(p), computed=false, ..) if @tables.is_module_only(
        p.name,
      ) &&
      !self.is_module(object) => {
      self.error(
        ReservedName,
        p.span,
        "only a module's member may be called \{p.name}",
      )
      return (NeverT, false)
    }
    _ => ()
  }
  match callee {
    Member(object~, computed=false, optional~, ..) => {
      let (recv0, s0) = self.object(object, env)
      let mut recv = recv0
      short = s0
      if optional {
        if @types.has_nullish(recv) {
          short = true
        }
        recv = @types.remove_nullish(recv)
      }
      tgt = self.method_target(callee, recv)
    }
    Ident(id) => {
      let b = self.scope.lookup(id.name)
      let t = self.expr(callee, env, None)
      match t {
        FnT(sigs) =>
          tgt = Some({
            ..target(sigs, b.bind(x => x.qualified).unwrap_or(id.name), id.name),
            fresh: b.map(x => x.fresh).unwrap_or(false),
            mut_params: b.bind(x => x.mut_params),
          })
        ModuleT(_) =>
          match self.host.binding(id.name) {
            Some(ModuleBinding(_, call=Some(FnT(sigs)))) =>
              tgt = Some(target(sigs, id.name, id.name))
            _ =>
              self.error(
                NotCallable,
                callee.span(),
                "the module \{id.name} can't be called: call one of its members",
              )
          }
        UnknownT => ()
        _ =>
          self.error(
            NotCallable,
            callee.span(),
            "\{id.name} is \{show(t)}, not a function",
          )
      }
    }
    _ => {
      ignore(self.expr(callee, env, None))
      self.error(
        NotCallable,
        callee.span(),
        "only functions the host provides and methods can be called",
      )
    }
  }
  guard tgt is Some(target) else {
    for a in args {
      match a {
        Arrow(_) => ()
        Spread(x, ..) => ignore(self.quietly(() => self.value(x, env, None)))
        _ => ignore(self.quietly(() => self.value(a, env, None)))
      }
    }
    return (NeverT, short)
  }
  if self.deterministic && self.host.is_nondeterministic(target.qualified) {
    self.error(
      NondeterministicCall,
      callee.span(),
      "\{target.qualified} depends on more than its arguments, and the check asks for a deterministic program",
    )
  }
  let result = self.apply_sigs(e, target, env)
  // What the program may change after the call.
  let t = match target.row {
    Some(row) if row.self_ => target.receiver.unwrap_or(result)
    Some(row) if row.fresh => @types.fresh(result)
    Some(_) => result
    None =>
      if target.fresh {
        @types.with_mut(result, true)
      } else if self.host.is_fresh(target.qualified) {
        @types.fresh(result)
      } else {
        @types.with_mut(result, false)
      }
  }
  // A call may change what it is given that may change, and its receiver.
  let changes_receiver = match target.row {
    Some(row) => row.mutates
    None =>
      match target.receiver {
        Some(r) => r.top_mut()
        None => false
      }
  }
  if changes_receiver {
    env.forget_under(target.receiver_key)
  }
  if target.row is None {
    for a in args {
      let x = match a {
        Spread(x, ..) => x
        _ => a
      }
      env.forget_under(self.path_key(x))
    }
  }
  (t, short)
}

///|
fn Checker::method_target(
  self : Checker,
  callee : @ast.Expr,
  recv0 : Ty,
) -> Target? {
  guard callee is Member(object~, property=Ident(p), ..) else { return None }
  let name = p.name
  let describe = "\{self.describe(object)}.\{name}"
  let receiver_key = self.path_key(object)
  if recv0 is ModuleT(m) {
    match self.host.find_member(m, name) {
      None => {
        self.error(UnknownMember, p.span, "the module \{m} has no \{name}")
        return None
      }
      Some(found) =>
        match found.ty {
          FnT(sigs) => return Some(target(sigs, found.qualified, describe))
          other => {
            self.error(
              NotCallable,
              callee.span(),
              "\{m}.\{name} is \{show(other)}, not a function",
            )
            return None
          }
        }
    }
  }
  if @tables.is_module_only(name) {
    self.error(
      ReservedName,
      p.span,
      "only a module's member may be called \{name}",
    )
    return None
  }
  let mut recv = self.expand(recv0)
  if @types.has_nullish(recv) {
    self.error(
      PossiblyNull,
      object.span(),
      "\{self.describe(object)} may be \{show(@types.filter_union(recv, @types.is_nullish))}: check it first, or use ?.",
    )
    recv = @types.remove_nullish(recv)
  }
  if recv is UnionT(ts) {
    let kinds = ts.map(u => receiver_kind(self.resolve(u)))
    let first = kinds[0]
    let same = kinds.iter().all(k => k == first)
    if same && first == Some(StringReceiver) {
      recv = StringT
    } else if same && first == Some(NumberReceiver) {
      recv = NumberT
    } else {
      self.error(
        MethodOnUnion,
        callee.span(),
        "\{self.describe(object)} is \{show(recv)}: narrow it to one kind before calling \{name}",
      )
      return None
    }
  }
  let r = self.resolve(recv)
  if r is NeverT {
    return None
  }
  match receiver_kind(r) {
    Some(kind) => {
      guard @tables.find_method(kind, name) is Some(row) else {
        let what = if kind is ListReceiver {
          "a list"
        } else {
          "a \{receiver_name(kind)}"
        }
        self.error(
          UnknownMethod,
          p.span,
          "\{what} has no method \{name} in pure-js",
        )
        return None
      }
      let elem = match (kind, r) {
        (ListReceiver, TupleT(elems~, ..)) =>
          @types.union(elems.mapi((i, _) => @types.tuple_elem_of(r, i)))
        (ListReceiver, _) => @types.elem_of(r)
        _ => UnknownT
      }
      if row.mutates && !r.top_mut() {
        match self.read_only_help(object) {
          Some(h) =>
            self.error(
              ImmutableTarget,
              callee.span(),
              "\{name} changes \{self.describe(object)}, which is read-only here",
              help=h,
            )
          None =>
            self.error(
              ImmutableTarget,
              callee.span(),
              "\{name} changes \{self.describe(object)}, which is read-only here",
            )
        }
      }
      if row.primitive && !@types.is_primitive(elem) {
        self.error(
          OperandType,
          callee.span(),
          "\{name} converts the elements to strings; \{self.describe(object)} holds \{show(elem)}",
        )
      }
      Some({
        sigs: method_sigs.get("\{receiver_name(kind)}.\{name}").unwrap_or([]),
        bindings: { "T": elem },
        qualified: "\{receiver_name(kind)}.\{name}",
        describe,
        row: Some(row),
        receiver: Some(r),
        receiver_key,
        receiver_node: Some(object),
        fresh: false,
        mut_params: None,
      })
    }
    None =>
      match r {
        RecordT(ns=Some(ns), ..) if ns.entries.contains(name) => {
          self.error(
            EntryAccess,
            p.span,
            "\{describe} is an entry the embedder calls, not something code calls: move what both need to a function",
          )
          None
        }
        RecordT(fields~, methods~, ..) | HandleT(fields~, methods~, ..) => {
          let owner = match r {
            RecordT(name=Some(n), ..) | HandleT(name=n, ..) => n
            _ => "record"
          }
          match methods.get(name) {
            None => {
              if fields.get(name) is Some(_) {
                self.error(
                  NotCallable,
                  callee.span(),
                  "\{describe} is a field, not a method",
                )
              } else {
                self.error(
                  UnknownMethod,
                  p.span,
                  "\{show(r)} has no method \{name}",
                )
              }
              None
            }
            Some(sigs) =>
              Some({
                sigs,
                bindings: Map([]),
                qualified: "\{owner}.\{name}",
                describe,
                row: None,
                receiver: Some(r),
                receiver_key,
                receiver_node: None,
                fresh: false,
                mut_params: None,
              })
          }
        }
        UnknownT => {
          self.error(
            UnknownMember,
            callee.span(),
            "nothing is known of \{self.describe(object)} (it is unknown): narrow it first",
          )
          None
        }
        _ => {
          self.error(UnknownMethod, p.span, "\{show(r)} has no method \{name}")
          None
        }
      }
  }
}

///|
fn Checker::read_only_help(self : Checker, node : @ast.Expr) -> String? {
  guard self.path_key(node) is Some(key) && key.has_prefix("this") else {
    return None
  }
  match self.draft_name {
    None => Some("this is read-only")
    Some(d) =>
      Some("this is read-only: change \{d}\{key.exact_view(start=4)} instead")
  }
}

///|
/// The result of calling target with e's arguments: the first overload they fit.
fn Checker::apply_sigs(
  self : Checker,
  e : @ast.Expr,
  target : Target,
  env : Env,
) -> Ty {
  let sigs = target.sigs
  if sigs.length() == 1 {
    return self.apply_sig(e, sigs[0], target.bindings.copy(), env, target)
  }
  for s in sigs {
    let attempt = env.copy()
    let (_, failed) = self.quietly(() => {
      self.apply_sig(e, s, target.bindings.copy(), attempt, target)
    })
    // Run it again keeping what it found (it reported nothing).
    if !failed {
      return self.apply_sig(e, s, target.bindings.copy(), env, target)
    }
  }
  let shown = sigs.map(s => "  \{@types.sig_to_string(s)}").join("\n")
  self.error(
    NoMatchingOverload,
    e.span(),
    "\{target.describe} takes its arguments as one of:\n\{shown}",
  )
  NeverT
}

///|
fn plural(n : Int32) -> String {
  if n == 1 {
    ""
  } else {
    "s"
  }
}

///|
fn Checker::apply_sig(
  self : Checker,
  e : @ast.Expr,
  s : @types.Sig,
  bindings : Map[String, Ty],
  env : Env,
  target : Target,
) -> Ty {
  guard e is Call(args~, ..) else { return UnknownT }
  let params = s.params
  let rest_at = params.search_by(p => p.rest).unwrap_or(-1)
  let required = params.filter(p => !p.optional && !p.rest).length()
  let param_for = (i : Int32) => {
    if rest_at != -1 && i >= rest_at {
      Some(params[rest_at])
    } else {
      params.get(i)
    }
  }
  let has_spread = args.iter().any(a => a is Spread(_, ..))
  if args.length() < required && !has_spread {
    let least = if required == params.length() { "" } else { "at least " }
    self.error(
      WrongArity,
      e.span(),
      "\{target.describe} takes \{least}\{required} argument\{plural(required)}, here \{args.length()}",
    )
  }
  if rest_at == -1 && args.length() > params.length() {
    self.error(
      WrongArity,
      e.span(),
      "\{target.describe} takes at most \{params.length()} argument\{plural(params.length())}, here \{args.length()}",
    )
  }
  let rel = self.rel(bindings~)
  let param_type = (p : @types.Param) => {
    if p.rest {
      @types.elem_of(self.resolve(p.ty))
    } else {
      p.ty
    }
  }
  let arrows = []
  for i, a in args {
    guard param_for(i) is Some(p) else { continue }
    match a {
      Arrow(f) => arrows.push((f, p))
      Spread(arg, span~) => {
        let st = self.resolve(self.value(arg, env, None))
        if !p.rest {
          self.error(
            SpreadType,
            span,
            "a spread argument goes in a rest parameter; \{target.describe}'s parameter \{p.name} isn't one",
          )
          continue
        }
        let elem = match st {
          ListT(..) => Some(@types.elem_of(st))
          TupleT(elems~, ..) =>
            Some(
              @types.union(elems.mapi((j, _) => @types.tuple_elem_of(st, j))),
            )
          _ => None
        }
        guard elem is Some(el) else {
          self.error(
            SpreadType,
            span,
            "only a list can be spread; \{self.describe(arg)} is \{show(st)}",
          )
          continue
        }
        let pt = @types.elem_of(self.resolve(p.ty))
        if !rel.assignable(el, pt) {
          self.error(
            ArgumentType,
            span,
            "\{self.describe(arg)} holds \{show(el)}, where \{p.name} takes \{show(@types.subst(pt, bindings))}",
          )
        }
      }
      _ => {
        let exp = @types.subst(param_type(p), bindings)
        let t = self.value(
          a,
          env,
          if @types.has_vars(exp) {
            None
          } else {
            Some(exp)
          },
        )
        match target.mut_params {
          Some(names) if names.contains(p.name) && !self.may_change(t) =>
            self.error(
              ImmutableArgument,
              a.span(),
              "\{target.describe} may change its parameter \{p.name}, and \{self.describe(a)} is read-only here",
              help="declare the parameter Readonly<...> if \{target.describe} doesn't change it",
            )
          _ => ()
        }
        let pt = param_type(p)
        if !rel.assignable(t, pt) {
          self.error(
            ArgumentType,
            a.span(),
            "\{p.name} of \{target.describe} takes \{show(@types.subst(pt, bindings))}; \{self.describe(a)} is \{show(t)}",
          )
        }
      }
    }
  }
  for pair in arrows {
    let (f, p) = pair
    let ft = self.resolve(@types.subst(p.ty, bindings))
    guard ft is FnT(fsigs) && fsigs.length() == 1 else {
      self.error(
        ArgumentType,
        f.span,
        "\{p.name} of \{target.describe} takes \{show(ft)}, not a function",
      )
      continue
    }
    let cb = fsigs[0]
    let declared = match p.ty {
      FnT(psigs) => Some(psigs[0])
      _ => None
    }
    let result = self.arrow(f, cb, env, target, declared)
    // The callback's own result: bind what it says, then check against it.
    let original = match p.ty {
      FnT(psigs) => psigs[0].result
      _ => cb.result
    }
    if !rel.assignable(result, original) {
      let at = match f.body {
        ExprBody(x) => x.span()
        BlockBody(b) => b.span
      }
      self.error(
        ArgumentType,
        at,
        "the callback must return \{show(@types.subst(original, bindings))}; it returns \{show(result)}",
      )
    }
  }
  @types.ground(@types.subst(s.result, bindings))
}

///|
/// A callback; its parameters that are the receiver's elements (T in the
/// method's signature) are of the receiver's mode, a draft's elements drafts
/// at its place.
fn Checker::arrow(
  self : Checker,
  a : @ast.Func,
  cb : @types.Sig,
  env : Env,
  target : Target,
  declared : @types.Sig?,
) -> Ty {
  let receiver_mode = target.receiver_node.map(n => self.mode_of(n))
  let receiver_place = match (receiver_mode, target.receiver_node) {
    (Some("draft"), Some(n)) => self.place_of(n)
    _ => None
  }
  if a.params.length() > cb.params.length() {
    self.error(
      CallbackArity,
      a.span,
      "\{target.describe} gives its callback \{cb.params.length()} argument\{plural(cb.params.length())}; this one takes \{a.params.length()}",
    )
  }
  // Inside a callback, what was known of properties is not: TypeScript forgets
  // it, as the callback could run when they have changed. Names stay.
  let inner = env.copy()
  for k in inner.refine.keys().collect() {
    if k.contains(".") || k == "this" {
      inner.refine.remove(k)
    }
  }
  self.push_scope()
  for i, param in a.params {
    let mut ty = match cb.params.get(i) {
      None => @types.UnknownT
      Some(p) => p.ty
    }
    if @types.has_vars(ty) {
      let what = match param {
        PIdent(id) => id.name
        _ => "this parameter"
      }
      self.error(
        CallbackType,
        param.span(),
        "the type of \{what} can't be inferred here: annotate it",
      )
      ty = UnknownT
    }
    match param.ann() {
      Some(node) => {
        let ann = self.annotation(node, ty.top_mut())
        if !self.assignable(ty, ann) {
          self.error(
            ParamType,
            node.span(),
            "\{target.describe} gives \{show(ty)} here, not \{show(ann)}",
          )
        }
        ty = ann
      }
      None => ()
    }
    let element = receiver_mode == Some("draft") &&
      (match declared {
        Some(d) =>
          match d.params.get(i) {
            Some({ ty: VarT("T"), .. }) => true
            _ => false
          }
        None => false
      })
    self.bind_pattern(
      param,
      ty,
      kind="callback",
      mode?=if element { Some("draft") } else { None },
      place?=if element { receiver_place.map(pl => "\{pl}[*]") } else { None },
    )
  }
  let expected = if @types.has_vars(cb.result) || cb.result is UnknownT {
    None
  } else {
    Some(cb.result)
  }
  let t = match a.body {
    ExprBody(x) => self.value(x, inner, expected)
    BlockBody(_) => self.block_callback(a, inner, expected)
  }
  self.pop_scope()
  // What the callback may have changed through calls is forgotten outside too.
  let changes = callback_changes(a)
  for k, v in env.refine.copy() {
    let property = k.contains(".") || k == "this"
    let forget = if property { changes } else { inner.refine.get(k) != Some(v) }
    if forget {
      env.refine.remove(k)
    }
  }
  t
}

///|
/// Whether a callback calls anything that may change a value: a mutating
/// method, a host function given a value.
fn callback_changes(a : @ast.Func) -> Bool {
  let mut changes = false
  let visit = (e : @ast.Expr) => {
    if e is Call(callee~, ..) {
      match callee {
        Member(property=Ident(p), computed=false, ..) =>
          match @tables.find_method(ListReceiver, p.name) {
            Some(row) => if row.mutates { changes = true }
            None => changes = true
          }
        _ => changes = true
      }
    }
  }
  match a.body {
    ExprBody(x) => each_expr(x, visit)
    BlockBody(b) =>
      for x in b.body {
        each_expr_in_stmt(x, visit)
      }
  }
  changes
}

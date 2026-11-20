// Modes, places and the flow of loops and lets, as the reference's check.js:
// what a value is to whoever changes it (computeMode, placeOf), for-of and the
// statements it may change (forOf, forgetChangedIn), whether a value may be
// changed all the way down (mayChange), callbacks with a block body, and
// assignments to a let.

///|
fn Checker::mode_of(self : Checker, e : @ast.Expr) -> String {
  self.modes.get(node_key(expr_kind(e), e.span())).unwrap_or("value")
}

///|
fn Checker::set_mode(self : Checker, e : @ast.Expr, mode : String) -> Unit {
  self.modes[node_key(expr_kind(e), e.span())] = mode
}

///|
/// What a value is to whoever changes it: a draft's (part of a value the
/// entry gave to be changed), fresh (made here), read, or a plain value.
fn Checker::compute_mode(self : Checker, e : @ast.Expr, t : Ty) -> String {
  let ms = @types.members(t)
  if !containerish(t) {
    return if ms.iter().any(u => u is HandleT(..)) { "read" } else { "value" }
  }
  if !ms.iter().any(u => (u.is_container() || u is RefT(..)) && u.top_mut()) {
    return "read"
  }
  match e {
    Ident(id) =>
      match self.scope.lookup(id.name) {
        Some(b) => b.mode
        None => "read"
      }
    This(_) => self.this_mode
    Member(object~, ..) =>
      if self.mode_of(object) == "draft" {
        "draft"
      } else {
        "fresh"
      }
    Chain(inner, ..) => self.mode_of(inner)
    Call(callee=Member(object~, property=Ident(p), computed=false, ..), ..) =>
      match @tables.find_method(ListReceiver, p.name) {
        Some(row) if row.self_ =>
          if self.mode_of(object) == "draft" {
            "draft"
          } else {
            "fresh"
          }
        _ => "fresh"
      }
    Cond(cons~, alt~, ..) =>
      if self.mode_of(cons) == "draft" || self.mode_of(alt) == "draft" {
        "draft"
      } else {
        "fresh"
      }
    Logical(left~, right~, ..) =>
      if self.mode_of(left) == "draft" || self.mode_of(right) == "draft" {
        "draft"
      } else {
        "fresh"
      }
    _ => "fresh"
  }
}

///|
/// Where a draft's value is, as a path from a name: next.items[i].done. None
/// when it isn't one path.
fn Checker::place_of(self : Checker, e : @ast.Expr) -> String? {
  match e {
    Ident(id) =>
      match self.scope.lookup(id.name) {
        Some(b) => b.place
        None => None
      }
    This(_) => Some("this")
    Member(object~, property~, computed~, ..) =>
      match self.place_of(object) {
        None => None
        Some(o) =>
          if !computed {
            match property {
              Ident(p) => Some("\{o}.\{p.name}")
              _ => None
            }
          } else {
            match property {
              Lit(LNull, ..) => Some("\{o}[null]")
              Lit(v, ..) => Some("\{o}[\{@types.type_to_string(LitT(v))}]")
              Ident(k) =>
                match self.scope.lookup(k.name) {
                  Some(b) if b.kind != "let" => Some("\{o}[\{k.name}]")
                  _ => None
                }
              _ => None
            }
          }
      }
    _ => None
  }
}

///|
/// Every expression under a statement, parents first, functions' bodies too.
fn each_expr_in_stmt(s : @ast.Stmt, f : (@ast.Expr) -> Unit) -> Unit {
  match s {
    VarDecl(decls~, ..) =>
      for d in decls {
        each_expr_in_pattern(d.id, f)
        if d.init is Some(e) {
          each_expr(e, f)
        }
      }
    ExprStmt(e, ..) => each_expr(e, f)
    If(cond~, cons~, alt~, ..) => {
      each_expr(cond, f)
      each_expr_in_stmt(cons, f)
      if alt is Some(a) {
        each_expr_in_stmt(a, f)
      }
    }
    BlockStmt(b) =>
      for x in b.body {
        each_expr_in_stmt(x, f)
      }
    Return(arg, ..) => if arg is Some(e) { each_expr(e, f) }
    ForOf(left~, right~, body~, ..) => {
      each_expr_in_stmt(left, f)
      each_expr(right, f)
      each_expr_in_stmt(body, f)
    }
    Try(block~, handler~, finalizer~, ..) => {
      for x in block.body {
        each_expr_in_stmt(x, f)
      }
      if handler is Some(h) {
        for x in h.body.body {
          each_expr_in_stmt(x, f)
        }
      }
      if finalizer is Some(b) {
        for x in b.body {
          each_expr_in_stmt(x, f)
        }
      }
    }
    Throw(e, ..) => each_expr(e, f)
    Break(_) | Continue(_) => ()
  }
}

///|
fn each_expr_in_pattern(p : @ast.Pattern, f : (@ast.Expr) -> Unit) -> Unit {
  match p {
    PIdent(_) => ()
    PArray(elements~, ..) =>
      for e in elements {
        if e is Some(x) {
          each_expr_in_pattern(x, f)
        }
      }
    PObject(props~, ..) =>
      for prop in props {
        match prop {
          PPProp(key~, value~, ..) => {
            if key is KComputed(k) {
              each_expr(k, f)
            }
            each_expr_in_pattern(value, f)
          }
          PPRest(..) => ()
        }
      }
    PRest(arg~, ..) => each_expr_in_pattern(arg, f)
    PAssign(left~, right~, ..) => {
      each_expr_in_pattern(left, f)
      each_expr(right, f)
    }
  }
}

///|
fn each_expr_in_func(fn_ : @ast.Func, f : (@ast.Expr) -> Unit) -> Unit {
  for p in fn_.params {
    each_expr_in_pattern(p, f)
  }
  match fn_.body {
    ExprBody(x) => each_expr(x, f)
    BlockBody(b) =>
      for x in b.body {
        each_expr_in_stmt(x, f)
      }
  }
}

///|
fn each_expr(e : @ast.Expr, f : (@ast.Expr) -> Unit) -> Unit {
  f(e)
  match e {
    Ident(_) | This(_) | Lit(_, ..) => ()
    Template(exprs~, ..) =>
      for x in exprs {
        each_expr(x, f)
      }
    ArrayLit(es, ..) =>
      for x in es {
        if x is Some(y) {
          each_expr(y, f)
        }
      }
    ObjectLit(ms, ..) =>
      for m in ms {
        match m {
          Prop(key~, value~, ..) => {
            if key is KComputed(k) {
              each_expr(k, f)
            }
            each_expr(value, f)
          }
          SpreadMember(x, ..) => each_expr(x, f)
          Method(func~, ..) => each_expr_in_func(func, f)
        }
      }
    Member(object~, property~, ..) => {
      each_expr(object, f)
      each_expr(property, f)
    }
    Call(callee~, args~, ..) => {
      each_expr(callee, f)
      for x in args {
        each_expr(x, f)
      }
    }
    Spread(x, ..) | Chain(x, ..) | Unary(arg=x, ..) | Update(arg=x, ..) =>
      each_expr(x, f)
    Binary(left~, right~, ..)
    | Logical(left~, right~, ..)
    | Assign(left~, right~, ..) => {
      each_expr(left, f)
      each_expr(right, f)
    }
    Cond(cond~, cons~, alt~, ..) => {
      each_expr(cond, f)
      each_expr(cons, f)
      each_expr(alt, f)
    }
    Arrow(fn_) => each_expr_in_func(fn_, f)
  }
}

///|
/// What a statement may change, forgotten in env: names it assigns, places it
/// sets, and what is under anything it calls.
fn Checker::forget_changed_in(self : Checker, s : @ast.Stmt, env : Env) -> Unit {
  each_expr_in_stmt(s, e => {
    match e {
      Assign(left~, ..) => {
        let key = match left {
          Ident(id) => Some(id.name)
          _ => self.path_key(left)
        }
        if key is Some(k) {
          env.refine.remove(k)
          env.forget_under(key)
        }
        if left is Member(object~, ..) {
          env.forget_under(self.path_key(object))
        }
      }
      Call(..) =>
        for k in env.refine.keys().collect() {
          if k.contains(".") || k == "this" {
            env.refine.remove(k)
          }
        }
      _ => ()
    }
  })
}

///|
/// for (const x of xs): xs a list, a tuple or a string, walked as it was when
/// the loop began. The body runs any number of times, so what it changes isn't
/// known when it starts; after the loop what was known is what holds after
/// every way out of it.
fn Checker::for_of(self : Checker, s : @ast.Stmt, env : Env) -> Env? {
  guard s is ForOf(left=VarDecl(kind~, decls~, ..), right~, body~, ..) else {
    return Some(env)
  }
  let it = self.value(right, env, None)
  let r = self.resolve(self.expand(it))
  let mut elem = match r {
    ListT(..) => @types.elem_of(r)
    TupleT(elems~, ..) =>
      @types.union(elems.mapi((i, _) => @types.tuple_elem_of(r, i)))
    _ =>
      if receiver_kind(r) == Some(StringReceiver) {
        StringT
      } else {
        let message = "for-of walks a list or a string; \{self.describe(right)} is \{show(it)}"
        if r is DictT(..) {
          self.error(
            NotIterable,
            right.span(),
            message,
            help="walk Object.entries(...), Object.keys(...) or Object.values(...)",
          )
        } else {
          self.error(NotIterable, right.span(), message)
        }
        UnknownT
      }
  }
  let start = env.copy()
  self.forget_changed_in(body, start)
  self.loops.push([])
  self.push_scope()
  let d = decls[0]
  let mode = self.mode_of(right)
  let place = if mode == "draft" { self.place_of(right) } else { None }
  match d.id.ann() {
    Some(node) => {
      let ann = self.annotation(node, elem.top_mut())
      if !self.assignable(elem, ann) {
        self.error(
          ParamType,
          node.span(),
          "the loop gives \{show(elem)}, not \{show(ann)}",
        )
      }
      elem = ann
    }
    None => ()
  }
  self.bind_pattern(
    d.id,
    elem,
    kind~,
    mode?=if mode == "draft" { Some("draft") } else { None },
    place?=place.map(p => "\{p}[*]"),
  )
  let end = self.statement(body, start.copy())
  self.pop_scope()
  let exits = self.loops.pop().unwrap_or([])
  let mut out = join(Some(start), end)
  for x in exits {
    out = join(out, Some(x))
  }
  out
}

///|
/// Whether a value may be changed all the way down, as a parameter that isn't
/// Readonly may be.
fn Checker::may_change(self : Checker, t0 : Ty) -> Bool {
  let seen = []
  fn go(t : Ty) -> Bool {
    match t {
      UnionT(ts) => ts.iter().all(u => go(u))
      RefT(name~, mutable~) =>
        if seen.contains(name) {
          true
        } else {
          seen.push(name)
          let r = self.resolve(t)
          // An alias of a union is its members; one of what isn't a container
          // can't change.
          if r is UnionT(_) {
            go(r)
          } else if !mutable {
            !r.is_container() && !(r is HandleT(..))
          } else {
            go(r)
          }
        }
      _ =>
        if !t.is_container() {
          true
        } else if !t.top_mut() {
          false
        } else {
          match t {
            ListT(deep=true, ..)
            | TupleT(deep=true, ..)
            | DictT(deep=true, ..)
            | RecordT(deep=true, ..) => true
            ListT(elem~, ..) => go(elem)
            TupleT(elems~, ..) => elems.iter().all(u => go(u))
            DictT(value~, ..) => go(value)
            RecordT(fields~, ..) => fields.values().all(f => go(f.ty))
            _ => true
          }
        }
    }
  }

  go(t0)
}

///|
/// A callback with a block body: its returns are its own, its loops too.
fn Checker::block_callback(
  self : Checker,
  a : @ast.Func,
  env : Env,
  expected : Ty?,
) -> Ty {
  guard a.body is BlockBody(b) else { return UnknownT }
  let saved_returns = self.returns
  let saved_modes = self.return_modes
  let saved_types = self.return_types
  let saved_expected = self.expected_return
  let saved_loops = self.loops
  self.returns = []
  self.return_modes = []
  self.return_types = []
  self.expected_return = expected
  self.loops = []
  let completes = self.statements(b.body, env) is Some(_)
  let t = match expected {
    Some(e) => {
      if completes && !(e is VoidT) && !self.assignable(UndefinedT, e) {
        self.error(
          MissingReturn,
          b.span,
          "the callback must return \{show(e)} on every path",
        )
      }
      e
    }
    None =>
      if self.returns.length() == 0 {
        UndefinedT
      } else {
        let all = self.returns.map(@types.widen)
        if completes {
          all.push(UndefinedT)
        }
        @types.union(all)
      }
  }
  self.returns = saved_returns
  self.return_modes = saved_modes
  self.return_types = saved_types
  self.expected_return = saved_expected
  self.loops = saved_loops
  t
}

///|
/// x = v, x += v: x a let; after it, x is known to hold v.
fn Checker::assign_name(self : Checker, e : @ast.Expr, env : Env) -> Unit {
  guard e is Assign(op~, left=Ident(id) as left, right~, span~) else { return }
  let name = id.name
  let b = self.scope.lookup(name)
  match b {
    Some(binding) if binding.kind == "let" => {
      let r = self.value(right, env, Some(binding.ty))
      if op == "=" {
        if !self.assignable(r, binding.ty) {
          self.error(
            NotAssignable,
            right.span(),
            "\{name} is \{show(binding.ty)}; this is \{show(r)}",
          )
        }
      } else {
        let cur = env.refine.get(name).unwrap_or(binding.ty)
        let numeric = @types.is_numberish(cur) && @types.is_numberish(r)
        let strings = op == "+=" &&
          @types.is_stringish(cur) &&
          @types.is_stringish(r)
        if !numeric && !strings {
          let what = if op == "+=" {
            "two numbers or two strings"
          } else {
            "two numbers"
          }
          self.error(
            OperandType,
            span,
            "\{op} takes \{what}; here \{show(cur)} and \{show(r)}",
          )
        }
      }
      env.forget_under(Some(name))
      env.refine[name] = if op == "=" { r } else { @types.widen(binding.ty) }
      self.record("Identifier", left.span(), binding.ty, binding.mode, None)
    }
    _ => {
      ignore(self.value(right, env, None))
      match b {
        Some(binding) =>
          self.error(
            ConstAssignment,
            id.span,
            "\{name} is a \{if binding.kind == "param" { "parameter" } else { binding.kind }}: only a let is assigned to",
          )
        None =>
          if self.host.binding(name) is None {
            self.error(
              UnknownName,
              id.span,
              "\{name} is not a parameter, a const or something the host provides",
            )
          } else {
            self.error(
              ConstAssignment,
              id.span,
              "\{name} is the host's: only a let is assigned to",
            )
          }
      }
    }
  }
}

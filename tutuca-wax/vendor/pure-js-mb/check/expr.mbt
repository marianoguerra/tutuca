///|
/// An expression used as a value: a module or a function can't be one.
fn Checker::value(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  expected : Ty?,
) -> Ty {
  let t = self.expr(e, env, expected)
  match t {
    ModuleT(_) => {
      self.error(
        ModuleAsValue,
        e.span(),
        "\{self.text(e.span())} is a module: use one of its members",
      )
      UnknownT
    }
    FnT(_) => {
      self.error(
        FunctionAsValue,
        e.span(),
        "\{self.text(e.span())} is a function: call it",
      )
      UnknownT
    }
    VoidT => {
      self.error(
        VoidValue,
        e.span(),
        "\{self.text(e.span())} returns nothing, so it has no value to use",
      )
      UndefinedT
    }
    RecordT(ns=Some(_), ..) => {
      self.error(
        NamespaceAsValue,
        e.span(),
        "\{self.text(e.span())} holds entries the embedder calls, so it isn't a value: read its data members",
      )
      UnknownT
    }
    _ => t
  }
}

///|
/// An expression's type, its mode and (a draft's) place recorded in the typed
/// tree.
fn Checker::expr(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  expected : Ty?,
) -> Ty {
  let t = self.expr_type(e, env, expected)
  let mode = self.compute_mode(e, t)
  self.set_mode(e, mode)
  self.record(
    expr_kind(e),
    e.span(),
    t,
    mode,
    if mode == "draft" {
      self.place_of(e)
    } else {
      None
    },
  )
  t
}

///|
fn Checker::expr_type(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  expected : Ty?,
) -> Ty {
  match e {
    Ident(id) => self.identifier(id, env)
    This(span) =>
      match self.this_type {
        None => {
          self.error(
            ThisUnavailable,
            span,
            if self.program.form is ArrowForm {
              "an arrow program has no this: write a function"
            } else {
              "the signature gives this program no this"
            },
          )
          NeverT
        }
        Some(t) => env.refine.get("this").unwrap_or(t)
      }
    Lit(LNull, ..) => NullT
    Lit(v, ..) => LitT(v)
    Template(exprs~, ..) => {
      for x in exprs {
        let t = self.value(x, env, None)
        if !@types.is_primitive(t) {
          self.error(
            TemplateType,
            x.span(),
            "a template takes strings, numbers and booleans; \{self.describe(x)} is \{show(t)}",
          )
        }
      }
      StringT
    }
    Member(..) | Call(..) => self.link(e, env).0
    Chain(inner, ..) => {
      let (t, short) = self.link(inner, env)
      if short {
        @types.union([t, UndefinedT])
      } else {
        t
      }
    }
    ArrayLit(_, ..) => self.array_literal(e, env, expected)
    ObjectLit(_, ..) => self.object_literal(e, env, expected)
    Unary(..) => self.unary(e, env)
    Binary(..) => self.binary(e, env)
    Logical(..) => self.logical(e, env, expected)
    Cond(cond~, cons~, alt~, ..) => {
      ignore(self.check_test(cond, env))
      let a = self.value(cons, self.narrow(cond, env, true), expected)
      let b = self.value(alt, self.narrow(cond, env, false), expected)
      @types.union([a, b])
    }
    Assign(..) => {
      self.assignment(e, env)
      UnknownT
    }
    Arrow(f) => {
      self.error(
        FunctionAsValue,
        f.span,
        "an arrow function is only a call's argument",
      )
      UnknownT
    }
    _ => UnknownT
  }
}

///|
fn Checker::identifier(self : Checker, id : @ast.Ident, env : Env) -> Ty {
  match self.scope.lookup(id.name) {
    Some(b) => return env.refine.get(id.name).unwrap_or(b.ty)
    None => ()
  }
  if id.name == "undefined" {
    return UndefinedT
  }
  match self.host.binding(id.name) {
    Some(ModuleBinding(name, ..)) => ModuleT(name)
    Some(FunctionBinding(_, t)) => t
    None => {
      self.error(
        UnknownName,
        id.span,
        "\{id.name} is not a parameter, a const or something the host provides",
      )
      NeverT
    }
  }
}

///|
fn Checker::unary(self : Checker, e : @ast.Expr, env : Env) -> Ty {
  guard e is Unary(op~, arg~, ..) else { return UnknownT }
  match op {
    "!" => {
      ignore(self.check_test(arg, env))
      BooleanT
    }
    "-" => {
      let t = self.value(arg, env, None)
      if !@types.is_numberish(t) {
        self.error(
          OperandType,
          arg.span(),
          "unary - takes a number; \{self.describe(arg)} is \{show(t)}",
        )
      }
      NumberT
    }
    "typeof" => {
      ignore(self.value(arg, env, None))
      typeof_tags
    }
    _ => {
      ignore(self.value(arg, env, None))
      UnknownT
    }
  }
}

///|
fn Checker::binary(self : Checker, e : @ast.Expr, env : Env) -> Ty {
  guard e is Binary(op~, left~, right~, span~) else { return UnknownT }
  let a = self.value(left, env, None)
  let b = self.value(right, env, None)
  let both = (p : (Ty) -> Bool) => p(a) && p(b)
  let bad = (what : String) => {
    let text = "\{op} takes \{what}; here \{show(@types.widen(a))} and \{show(@types.widen(b))}"
    if op == "+" {
      self.error(
        OperandType,
        span,
        text,
        help="convert with String(x) or a template",
      )
    } else {
      self.error(OperandType, span, text)
    }
  }
  match op {
    "+" =>
      if both(@types.is_numberish) {
        NumberT
      } else if both(@types.is_stringish) {
        StringT
      } else {
        bad("two numbers or two strings")
        NeverT
      }
    "-" | "*" | "/" | "%" => {
      if !both(@types.is_numberish) {
        bad("two numbers")
      }
      NumberT
    }
    "<" | ">" | "<=" | ">=" => {
      if !both(@types.is_numberish) && !both(@types.is_stringish) {
        bad("two numbers or two strings")
      }
      BooleanT
    }
    "===" | "!==" => {
      if !self.rel().comparable(a, b) {
        self.error(
          ComparisonType,
          span,
          "\{show(a)} and \{show(b)} have no value in common, so \{op} is always \{if op == "===" { "false" } else { "true" }}",
        )
      }
      BooleanT
    }
    _ => UnknownT
  }
}

///|
fn Checker::logical(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  expected : Ty?,
) -> Ty {
  guard e is Logical(op~, left~, right~, ..) else { return UnknownT }
  let l = self.value(left, env, None)
  if op != "??" && !@types.is_testable(l) {
    self.error(
      NotTestable,
      left.span(),
      "\{op} takes a boolean, or a value that may be null or undefined, on its left; \{self.describe(left)} is \{show(l)}",
    )
  }
  let renv = match op {
    "&&" => self.narrow(left, env, true)
    "||" => self.narrow(left, env, false)
    _ => env.copy()
  }
  if op == "??" {
    self.refine_path(left, renv, t => @types.filter_union(t, @types.is_nullish))
  }
  let r = self.value(right, renv, expected)
  forget_what_was_forgotten(env, renv)
  match op {
    "&&" => @types.union([@types.narrow_truthy(l, false), r])
    "||" => @types.union([@types.narrow_truthy(l, true), r])
    _ => @types.union([@types.remove_nullish(l), r])
  }
}

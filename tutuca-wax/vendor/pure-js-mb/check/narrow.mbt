///|
/// The flow state where cond is (sense true) or isn't (false) truthy.
fn Checker::narrow(
  self : Checker,
  cond : @ast.Expr,
  env : Env,
  sense : Bool,
) -> Env {
  let out = env.copy()
  self.narrow_into(cond, out, sense)
  out
}

///|
fn Checker::type_of_path(self : Checker, e : @ast.Expr, env : Env) -> Ty {
  self.quietly(() => self.value(e, env, None)).0
}

///|
fn Checker::refine_path(
  self : Checker,
  e : @ast.Expr,
  env : Env,
  f : (Ty) -> Ty,
) -> Unit {
  guard self.path_key(e) is Some(key) else { return }
  env.refine[key] = f(self.expand(self.type_of_path(e, env)))
}

///|
fn Checker::constant_type(self : Checker, e : @ast.Expr) -> Ty? {
  match e {
    Lit(LNull, ..) => Some(NullT)
    Lit(v, ..) => Some(LitT(v))
    Ident(id) if id.name == "undefined" &&
      self.scope.lookup("undefined") is None => Some(UndefinedT)
    _ => None
  }
}

///|
fn Checker::narrow_into(
  self : Checker,
  cond : @ast.Expr,
  env : Env,
  sense : Bool,
) -> Unit {
  match cond {
    Unary(op="!", arg~, ..) => self.narrow_into(arg, env, !sense)
    Unary(..) => ()
    Logical(op~, left~, right~, ..) => {
      if op == "??" {
        return
      }
      let is_and = op == "&&"
      if is_and == sense {
        self.narrow_into(left, env, sense)
        self.narrow_into(right, env, sense)
        return
      }
      // !(a && b): !a, or a and !b.
      let via_left = self.narrow(left, env, sense)
      let via_right = self.narrow(right, self.narrow(left, env, !sense), sense)
      match join(Some(via_left), Some(via_right)) {
        Some(merged) => env.refine = merged.refine
        None => ()
      }
    }
    Binary(op~, left~, right~, ..) => {
      if op != "===" && op != "!==" {
        return
      }
      let s = if op == "===" { sense } else { !sense }
      let sides = [(left, right), (right, left)]
      for side in sides {
        match side {
          (Unary(op="typeof", arg~, ..), Lit(LStr(tag), ..)) => {
            self.refine_path(arg, env, t => @types.narrow_typeof(t, tag, s))
            return
          }
          _ => ()
        }
      }
      for side in sides {
        let (a, b) = side
        guard self.constant_type(b) is Some(v) else { continue }
        self.refine_path(a, env, t => @types.narrow_equals(t, v, s))
        // A discriminant: x.kind === "a" narrows x to the records whose kind
        // can be "a".
        match (a, v) {
          (Member(object~, property=Ident(p), computed=false, ..), LitT(lit)) => {
            let field = p.name
            self.refine_path(object, env, t => {
              @types.filter_union(t, u => {
                let r = self.resolve(u)
                guard r is RecordT(fields~, ..) && fields.get(field) is Some(f) else {
                  return true
                }
                let ft = @types.field_type_of(r, f)
                if s {
                  self.rel().comparable(ft, v)
                } else {
                  !(ft is LitT(l) && l == lit)
                }
              })
            })
          }
          _ => ()
        }
        return
      }
    }
    Chain(inner, ..) =>
      // a?.b truthy: a isn't null or undefined.
      if sense {
        let mut e = inner
        while true {
          let (obj, optional) = match e {
            Member(object~, optional~, ..) => (Some(object), optional)
            Call(callee=Member(object~, optional~, ..), ..) =>
              (Some(object), optional)
            _ => (None, false)
          }
          guard obj is Some(o) else { break }
          if optional {
            self.refine_path(o, env, @types.remove_nullish)
          }
          e = o
        }
      }
    _ => self.refine_path(cond, env, t => @types.narrow_truthy(t, sense))
  }
}

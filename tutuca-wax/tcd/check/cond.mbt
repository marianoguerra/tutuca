// Conditions (`when`, `ensures`, `invariant`, `expect`): typing them against
// the component's fields, properties and the message's arguments, and an
// interpreter for the ones the tool can decide before anything runs (an
// invariant on the initial state).

///|
/// What a condition can read.
priv struct CondEnv {
  pkg : Package
  comp : ComponentM
  params : Array[FieldM]
  allow_next : Bool
  /// What `it` is, inside all(xs, ...) and any(xs, ...).
  it : Ty?
  /// "the when of add_todo", for messages.
  what : String
  diags : Array[@diag.Diagnostic]
  /// The check(p) predicates conditions over the state use.
  checks : Array[String]
}

///|
fn CondEnv::err(self : CondEnv, span : @diag.Span, msg : String) -> Ty? {
  self.diags.push(@diag.error("tcd.cond.type", span, "in \{self.what}: \{msg}"))
  None
}

///|
fn CondEnv::names(self : CondEnv) -> Array[String] {
  let out = self.params.map(p => p.name)
  out.append(self.comp.fields.map(f => f.name))
  out.append(self.comp.gets.map(f => f.name))
  out
}

///|
/// The fields and properties of the component or interface named, for
/// reading members of it, or None.
fn Package::members_of(self : Package, name : String) -> Array[FieldM]? {
  match self.component(name) {
    Some(c) => {
      let out = c.fields.copy()
      out.append(c.gets)
      Some(out)
    }
    None =>
      match self.interface_named(name) {
        Some(i) => {
          let out = i.fields.copy()
          out.append(i.gets)
          Some(out)
        }
        None => None
      }
  }
}

///|
/// The type of t's member m: a record's key, or a component's field.
fn CondEnv::member_ty(self : CondEnv, t : Ty, m : @syntax.Name) -> Ty? {
  match unoption(t) {
    Record(fs) =>
      match fs.iter().find_first(f => f.0 == m.text) {
        Some(f) => Some(f.1)
        None =>
          self.err(
            m.span,
            "the record has no key \{m.text}\{did_you_mean(m.text, fs.map(f => f.0))}",
          )
      }
    Comp([name]) =>
      match self.pkg.members_of(name) {
        Some(members) =>
          match members.iter().find_first(f => f.name == m.text) {
            Some(f) => Some(f.ty)
            None =>
              self.err(
                m.span,
                "\{name} has no field or property \{m.text}\{did_you_mean(m.text, members.map(f => f.name))}",
              )
          }
        None => Some(Any)
      }
    Any | Comp(_) | Map(_) => Some(Any)
    other =>
      self.err(
        m.span,
        "\{m.text} reads a member, but this is \{ty_text(other)}",
      )
  }
}

///|
fn CondEnv::path(self : CondEnv, parts : Array[@syntax.Name]) -> Ty? {
  let first = parts[0]
  let mut rest = parts[1:].to_owned()
  let mut t : Ty? = None
  if first.text == "next" {
    if !self.allow_next {
      return self.err(
        first.span,
        "next is the state after the message, only in ensures",
      )
    }
    guard rest.length() > 0 else {
      return self.err(first.span, "next needs a field: next.count")
    }
    let f = rest[0]
    rest = rest[1:].to_owned()
    t = match self.comp.property(f.text) {
      Some(p) => Some(p.ty)
      None =>
        self.err(
          f.span,
          "no field or property \{f.text}\{did_you_mean(f.text, self.names())}",
        )
    }
  } else if first.text == "it" {
    t = match self.it {
      Some(t) => Some(t)
      None =>
        self.err(
          first.span,
          "it is the item, only inside all(xs, ...) and any(xs, ...)",
        )
    }
  } else {
    t = match self.params.iter().find_first(p => p.name == first.text) {
      Some(p) => Some(p.ty)
      None =>
        match self.comp.property(first.text) {
          Some(p) => Some(p.ty)
          None =>
            self.err(
              first.span,
              "no argument, field or property \{first.text}\{did_you_mean(first.text, self.names())}",
            )
        }
    }
  }
  for m in rest {
    guard t is Some(cur) else { return None }
    t = self.member_ty(cur, m)
  }
  t
}

///|
/// The type of e, or None after reporting why it has none.
fn CondEnv::ty(self : CondEnv, e : @syntax.Expr) -> Ty? {
  match e {
    Lit(l, ..) => Some(lit_ty(l))
    Path(parts, ..) => self.path(parts)
    List(items, ..) => {
      let mut item_ty : Ty = Any
      for i in items {
        if self.ty(i) is Some(t) {
          item_ty = t
        }
      }
      Some(List(item_ty))
    }
    Record(entries, ..) =>
      Some(Record(entries.map(en => (en.0.text, self.ty(en.1).unwrap_or(Any)))))
    Not(inner, span~) => {
      if self.ty(inner) is Some(t) && t != Bool {
        return self.err(span, "not takes a condition, not \{ty_text(t)}")
      }
      Some(Bool)
    }
    Matches(inner, _, span~) => {
      if self.ty(inner) is Some(t) && unoption(t) != Str && t != Any {
        return self.err(span, "matches tests strings, not \{ty_text(t)}")
      }
      Some(Bool)
    }
    Call(n, args, span~) => self.call(n, args, span)
    Bin(op, l, r, span~) => self.bin(op, l, r, span)
  }
}

///|
fn CondEnv::call(
  self : CondEnv,
  n : @syntax.Name,
  args : Array[@syntax.Expr],
  span : @diag.Span,
) -> Ty? {
  match (n.text, args) {
    ("len", [a]) => {
      if self.ty(a) is Some(t) && !has_length(t) && t != Any {
        return self.err(
          span,
          "len takes a string, a list or a map, not \{ty_text(t)}",
        )
      }
      Some(S32)
    }
    ("all" | "any", [xs, cond]) => {
      let item = match self.ty(xs) {
        Some(List(i)) | Some(Option(List(i))) => i
        Some(Map(i)) => i
        Some(Any) => Any
        Some(t) =>
          return self.err(
            xs.span(),
            "\{n.text} goes over a list or a map, not \{ty_text(t)}",
          )
        None => return None
      }
      let inner = { ..self, it: Some(item), }
      if inner.ty(cond) is Some(t) && t != Bool {
        return self.err(
          cond.span(),
          "\{n.text} needs a condition, not \{ty_text(t)}",
        )
      }
      Some(Bool)
    }
    ("keys" | "values", [Path([f], ..)]) =>
      match self.comp.field(f.text) {
        Some(field) =>
          match unoption(field.ty) {
            List(i) => Some(List(if n.text == "keys" { S32 } else { i }))
            Map(i) => Some(List(if n.text == "keys" { Str } else { i }))
            t =>
              self.err(
                f.span,
                "\{n.text}(\{f.text}) needs a list or a map, but it's \{ty_text(t)}",
              )
          }
        None =>
          self.err(
            f.span,
            "no field \{f.text}\{did_you_mean(f.text, self.comp.fields.map(f => f.name))}",
          )
      }
    ("check", [Path([p], ..)]) => {
      if !self.checks.contains(p.text) {
        self.checks.push(p.text)
      }
      Some(Bool)
    }
    _ =>
      self.err(
        span,
        "\{n.text} with \{args.length()} arguments isn't something a condition can call; it can call len(x), keys(field), values(field), all(xs, cond), any(xs, cond) and check(name)",
      )
  }
}

///|
fn CondEnv::bin(
  self : CondEnv,
  op : @syntax.BinOp,
  l : @syntax.Expr,
  r : @syntax.Expr,
  span : @diag.Span,
) -> Ty? {
  let lt = self.ty(l)
  let rt = self.ty(r)
  guard lt is Some(lt) && rt is Some(rt) else { return None }
  match op {
    And | Or => {
      if lt != Bool || rt != Bool {
        return self.err(span, "\{op_text(op)} joins conditions")
      }
      Some(Bool)
    }
    Add | Sub =>
      if (is_numeric(lt) || lt == Any) && (is_numeric(rt) || rt == Any) {
        Some(if lt == F64 || rt == F64 { F64 } else { S32 })
      } else {
        self.err(
          span,
          "\{op_text(op)} adds numbers, not \{ty_text(lt)} and \{ty_text(rt)}",
        )
      }
    Lt | Le | Gt | Ge => {
      let ok = lt == Any ||
        rt == Any ||
        (is_numeric(lt) && is_numeric(rt)) ||
        (unoption(lt) == Str && unoption(rt) == Str)
      if !ok {
        return self.err(
          span,
          "\{op_text(op)} compares numbers or strings, not \{ty_text(lt)} and \{ty_text(rt)}",
        )
      }
      Some(Bool)
    }
    Eq | Ne => Some(Bool)
    In | NotIn => {
      if !(rt is List(_) || rt is Map(_) || rt == Any) {
        return self.err(
          span,
          "in needs a list, keys(field) or values(field) on its right, not \{ty_text(rt)}",
        )
      }
      Some(Bool)
    }
  }
}

///|
/// Types cond as a condition: it must be a bool.
fn CondEnv::condition(self : CondEnv, cond : @syntax.Expr) -> Unit {
  if self.ty(cond) is Some(t) && t != Bool && t != Any {
    self.diags.push(
      @diag.error(
        "tcd.cond.type",
        cond.span(),
        "in \{self.what}: a condition, but this is \{ty_text(t)}",
      ),
    )
  }
}

// ---- Values the tool can compute ------------------------------------------------

///|
/// A value an interpreter works with; Unknown is what it can't know before
/// running (a component, a property, a field without a default).
pub(all) enum Val {
  VNull
  VBool(Bool)
  VNum(Double)
  VStr(String)
  VList(Array[Val])
  VMap(Array[(String, Val)])
  Unknown
} derive(Eq, Debug)

///|
pub fn lit_val(l : @syntax.Lit) -> Val {
  match l {
    Int(n) => VNum(n.to_double())
    Float(f) => VNum(f)
    Str(s) => VStr(s)
    Bool(b) => VBool(b)
    Null => VNull
  }
}

///|
/// A literal expression (a default, an example's state) as a value.
pub fn literal_val(e : @syntax.Expr) -> Val {
  match e {
    Lit(l, ..) => lit_val(l)
    List(items, ..) => VList(items.map(literal_val))
    Record(entries, ..) =>
      VMap(entries.map(en => (en.0.text, literal_val(en.1))))
    _ => Unknown
  }
}

///|
fn member_val(v : Val, name : String) -> Val {
  match v {
    VMap(entries) =>
      match entries.iter().find_first(e => e.0 == name) {
        Some(e) => e.1
        None => VNull
      }
    _ => Unknown
  }
}

///|
fn truthy(v : Val) -> Bool? {
  match v {
    VBool(b) => Some(b)
    Unknown => None
    VNull => Some(false)
    _ => Some(true)
  }
}

///|
/// e's value with these values for its names; Unknown where a name is
/// unknown, or e calls check(p).
pub fn eval(
  e : @syntax.Expr,
  env : Map[String, Val],
  it~ : Val = Unknown,
) -> Val {
  match e {
    Lit(l, ..) => lit_val(l)
    Path(parts, ..) => {
      let mut v = if parts[0].text == "it" {
        it
      } else {
        env.get(parts[0].text).unwrap_or(Unknown)
      }
      for p in parts[1:] {
        v = member_val(v, p.text)
      }
      v
    }
    List(items, ..) => VList(items.map(i => eval(i, env, it~)))
    Record(entries, ..) =>
      VMap(entries.map(en => (en.0.text, eval(en.1, env, it~))))
    Not(inner, ..) =>
      match truthy(eval(inner, env, it~)) {
        Some(b) => VBool(!b)
        None => Unknown
      }
    Matches(_, _, ..) => Unknown
    Call(n, args, ..) =>
      match (n.text, args) {
        ("len", [a]) =>
          match eval(a, env, it~) {
            VStr(s) => VNum(s.length().to_double())
            VList(xs) => VNum(xs.length().to_double())
            VMap(xs) => VNum(xs.length().to_double())
            _ => Unknown
          }
        ("all" | "any", [xs, cond]) =>
          match eval(xs, env, it~) {
            VList(items) => {
              let want_all = n.text == "all"
              for item in items {
                match truthy(eval(cond, env, it=item)) {
                  Some(b) => if b != want_all { return VBool(!want_all) }
                  None => return Unknown
                }
              }
              VBool(want_all)
            }
            _ => Unknown
          }
        ("keys", [Path([f], ..)]) =>
          match env.get(f.text) {
            Some(VList(xs)) =>
              VList(Array::makei(xs.length(), i => VNum(i.to_double())))
            Some(VMap(xs)) => VList(xs.map(x => VStr(x.0)))
            _ => Unknown
          }
        ("values", [Path([f], ..)]) =>
          match env.get(f.text) {
            Some(VList(xs)) => VList(xs)
            Some(VMap(xs)) => VList(xs.map(x => x.1))
            _ => Unknown
          }
        _ => Unknown
      }
    Bin(op, l, r, ..) => {
      let a = eval(l, env, it~)
      let b = eval(r, env, it~)
      match op {
        And =>
          match (truthy(a), truthy(b)) {
            (Some(false), _) | (_, Some(false)) => VBool(false)
            (Some(true), Some(true)) => VBool(true)
            _ => Unknown
          }
        Or =>
          match (truthy(a), truthy(b)) {
            (Some(true), _) | (_, Some(true)) => VBool(true)
            (Some(false), Some(false)) => VBool(false)
            _ => Unknown
          }
        _ => {
          if a is Unknown || b is Unknown {
            return Unknown
          }
          match (op, a, b) {
            (Add, VNum(x), VNum(y)) => VNum(x + y)
            (Sub, VNum(x), VNum(y)) => VNum(x - y)
            (Eq, _, _) => VBool(a == b)
            (Ne, _, _) => VBool(a != b)
            (Lt, VNum(x), VNum(y)) => VBool(x < y)
            (Le, VNum(x), VNum(y)) => VBool(x <= y)
            (Gt, VNum(x), VNum(y)) => VBool(x > y)
            (Ge, VNum(x), VNum(y)) => VBool(x >= y)
            (Lt, VStr(x), VStr(y)) => VBool(x < y)
            (Le, VStr(x), VStr(y)) => VBool(x <= y)
            (Gt, VStr(x), VStr(y)) => VBool(x > y)
            (Ge, VStr(x), VStr(y)) => VBool(x >= y)
            (In, _, VList(xs)) => VBool(xs.contains(a))
            (NotIn, _, VList(xs)) => VBool(!xs.contains(a))
            _ => Unknown
          }
        }
      }
    }
  }
}

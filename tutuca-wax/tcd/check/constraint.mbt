// `where` clauses: written like conditions, restricted to what maps onto
// schema constraints (a conjunction of comparisons of the subject with
// literals, `len(subject)`, `in [..]`, `in keys(f)`, `in values(f)`,
// `matches`, `check(p)`), and normalized (Norm), so they can be explained,
// checked for contradictions and redundancy, and turned into generators.

///|
/// What normalizing a where clause needs: the subject's name and type, the
/// fields keys(f) and values(f) may name (with their types), and where to
/// report.
priv struct WhereCtx {
  subject : String
  ty : Ty
  fields : Map[String, Ty]
  diags : Array[@diag.Diagnostic]
}

///|
fn split_and(e : @syntax.Expr, out : Array[@syntax.Expr]) -> Unit {
  match e {
    Bin(And, l, r, ..) => {
      split_and(l, out)
      split_and(r, out)
    }
    _ => out.push(e)
  }
}

///|
fn is_subject(e : @syntax.Expr, s : String) -> Bool {
  e is Path([n], ..) && n.text == s
}

///|
fn num_of(e : @syntax.Expr) -> Double? {
  match e {
    Lit(Int(n), ..) => Some(n.to_double())
    Lit(Float(f), ..) => Some(f)
    _ => None
  }
}

///|
fn flip(op : @syntax.BinOp) -> @syntax.BinOp {
  match op {
    Lt => Gt
    Le => Ge
    Gt => Lt
    Ge => Le
    o => o
  }
}

///|
fn bound_text(b : Bound, lower : Bool) -> String {
  let n = num_text(b.value)
  match (lower, b.exclusive) {
    (true, true) => "above \{n}"
    (true, false) => "at least \{n}"
    (false, true) => "below \{n}"
    (false, false) => "at most \{n}"
  }
}

///|
fn num_text(d : Double) -> String {
  if d == d.floor() && d.abs() < 1.0e15 {
    d.to_int64().to_string()
  } else {
    d.to_string()
  }
}

///|
/// Whether a is a tighter lower bound than b (or the same).
fn tighter_lo(a : Bound, b : Bound) -> Bool {
  a.value > b.value || (a.value == b.value && (a.exclusive || !b.exclusive))
}

///|
fn tighter_hi(a : Bound, b : Bound) -> Bool {
  a.value < b.value || (a.value == b.value && (a.exclusive || !b.exclusive))
}

///|
fn WhereCtx::redundant(
  self : WhereCtx,
  span : @diag.Span,
  weaker : String,
  stronger : String,
) -> Unit {
  self.diags.push(
    @diag.warning(
      "tcd.where.redundant",
      span,
      "\{weaker} is implied by \{stronger}",
      hint="remove it",
    ),
  )
}

///|
fn WhereCtx::add_lo(
  self : WhereCtx,
  n : Norm,
  b : Bound,
  span : @diag.Span,
) -> Unit {
  match n.lo {
    Some(old) =>
      if tighter_lo(b, old) {
        self.redundant(
          span,
          "\{self.subject} \{bound_word(old, true)}",
          "\{self.subject} \{bound_word(b, true)}",
        )
        n.lo = Some(b)
      } else {
        self.redundant(
          span,
          "\{self.subject} \{bound_word(b, true)}",
          "\{self.subject} \{bound_word(old, true)}",
        )
      }
    None => n.lo = Some(b)
  }
}

///|
fn WhereCtx::add_hi(
  self : WhereCtx,
  n : Norm,
  b : Bound,
  span : @diag.Span,
) -> Unit {
  match n.hi {
    Some(old) =>
      if tighter_hi(b, old) {
        self.redundant(
          span,
          "\{self.subject} \{bound_word(old, false)}",
          "\{self.subject} \{bound_word(b, false)}",
        )
        n.hi = Some(b)
      } else {
        self.redundant(
          span,
          "\{self.subject} \{bound_word(b, false)}",
          "\{self.subject} \{bound_word(old, false)}",
        )
      }
    None => n.hi = Some(b)
  }
}

///|
/// "> 5", "<= 10".
fn bound_word(b : Bound, lower : Bool) -> String {
  let op = match (lower, b.exclusive) {
    (true, true) => ">"
    (true, false) => ">="
    (false, true) => "<"
    (false, false) => "<="
  }
  "\{op} \{num_text(b.value)}"
}

///|
fn WhereCtx::not_a_constraint(self : WhereCtx, e : @syntax.Expr) -> Unit {
  self.diags.push(
    @diag.error(
      "tcd.where.not_a_constraint",
      e.span(),
      "\{expr_text(e)} isn't a constraint a schema can hold",
      hint="a where clause compares \{self.subject} with literals, or takes len(\{self.subject}), \{self.subject} in [..], \{self.subject} in keys(field), \{self.subject} matches \"pattern\" or check(name), joined with and; or, not and conditions over other fields belong in when, ensures and invariant",
    ),
  )
}

///|
fn WhereCtx::wrong_kind(
  self : WhereCtx,
  e : @syntax.Expr,
  what : String,
) -> Unit {
  self.diags.push(
    @diag.error(
      "tcd.where.type",
      e.span(),
      "\{what}, but \{self.subject} is \{ty_text(self.ty)}",
    ),
  )
}

///|
fn WhereCtx::lit_fits(self : WhereCtx, e : @syntax.Expr) -> @syntax.Lit? {
  guard e is Lit(l, ..) else {
    self.not_a_constraint(e)
    return None
  }
  if !lit_fits_ty(l, unoption(self.ty)) {
    self.diags.push(
      @diag.error(
        "tcd.where.type",
        e.span(),
        "\{lit_text(l)} isn't a value of \{self.subject}'s type, \{ty_text(self.ty)}",
      ),
    )
    return None
  }
  Some(l)
}

///|
/// Whether a literal is a value of t.
pub fn lit_fits_ty(l : @syntax.Lit, t : Ty) -> Bool {
  match (l, t) {
    (_, Any) => true
    (Null, Null | Option(_)) => true
    (_, Option(i)) => lit_fits_ty(l, i)
    (Int(_), S32 | F64) => true
    (Float(_), F64) => true
    (Str(_), Str) => true
    (Str(s), Enum(ms)) => ms.contains(s)
    (Bool(_), Bool) => true
    (_, OneOf(ts)) => ts.iter().any(t => lit_fits_ty(l, t))
    _ => false
  }
}

///|
fn WhereCtx::atom(self : WhereCtx, n : Norm, e : @syntax.Expr) -> Unit {
  let s = self.subject
  match e {
    Bin(op, l, r, ..) => {
      // Put the subject (or len(subject)) on the left.
      let (op, l, r) = if is_subject(r, s) ||
        r is Call({ text: "len", .. }, _, ..) {
        (flip(op), r, l)
      } else {
        (op, l, r)
      }
      if is_subject(l, s) {
        match op {
          Lt | Le | Gt | Ge => {
            guard num_of(r) is Some(v) else { return self.not_a_constraint(e) }
            if !is_numeric(self.ty) {
              return self.wrong_kind(e, "\{op_text(op)} compares numbers")
            }
            let b = { value: v, exclusive: op is (Lt | Gt), }
            if op is (Gt | Ge) {
              self.add_lo(n, b, e.span())
            } else {
              self.add_hi(n, b, e.span())
            }
          }
          Eq =>
            if self.lit_fits(r) is Some(l) {
              n.one_of = Some(intersect(n.one_of, [l]))
            }
          Ne => if self.lit_fits(r) is Some(l) { n.none_of.push(l) }
          In | NotIn =>
            match r {
              List(items, ..) => {
                let lits = []
                for item in items {
                  if self.lit_fits(item) is Some(l) {
                    lits.push(l)
                  }
                }
                if op is In {
                  n.one_of = Some(intersect(n.one_of, lits))
                } else {
                  n.none_of.append(lits)
                }
              }
              Call(
                { text: "keys" | "values" as which, .. },
                [Path([f], ..)],
                ..
              ) if op is In => {
                guard self.fields.get(f.text) is Some(ft) else {
                  return self.diags.push(
                    @diag.error(
                      "tcd.where.unknown_field",
                      f.span,
                      "no field \{f.text} to take \{which} of\{did_you_mean(f.text, self.fields.keys().collect())}",
                    ),
                  )
                }
                match (which, unoption(ft)) {
                  ("keys", List(_)) =>
                    if unoption(self.ty) != S32 {
                      return self.wrong_kind(
                        e,
                        "the keys of \{f.text}, a list, are s32",
                      )
                    }
                  ("keys", Map(_)) =>
                    if unoption(self.ty) != Str {
                      return self.wrong_kind(
                        e,
                        "the keys of \{f.text}, a map, are strings",
                      )
                    }
                  ("values", List(_) | Map(_)) => ()
                  _ =>
                    return self.diags.push(
                      @diag.error(
                        "tcd.where.type",
                        f.span,
                        "\{which}(\{f.text}) needs a list or a map, but \{f.text} is \{ty_text(ft)}",
                      ),
                    )
                }
                if which == "keys" {
                  n.key_of.push(f.text)
                } else {
                  n.member_of.push(f.text)
                }
              }
              _ => self.not_a_constraint(e)
            }
          _ => self.not_a_constraint(e)
        }
      } else if l is Call({ text: "len", .. }, [arg], ..) && is_subject(arg, s) {
        guard r is Lit(Int(v), ..) else { return self.not_a_constraint(e) }
        if !has_length(self.ty) {
          return self.wrong_kind(
            e, "len takes the length of a string, a list or a map",
          )
        }
        let v = v.to_int()
        match op {
          Ge => n.len_lo = Some(max_opt(n.len_lo, v))
          Gt => n.len_lo = Some(max_opt(n.len_lo, v + 1))
          Le => n.len_hi = Some(min_opt(n.len_hi, v))
          Lt => n.len_hi = Some(min_opt(n.len_hi, v - 1))
          Eq => {
            n.len_lo = Some(max_opt(n.len_lo, v))
            n.len_hi = Some(min_opt(n.len_hi, v))
          }
          _ => self.not_a_constraint(e)
        }
      } else {
        self.not_a_constraint(e)
      }
    }
    Matches(l, p, ..) if is_subject(l, s) =>
      if unoption(self.ty) != Str {
        self.wrong_kind(e, "matches tests strings")
      } else {
        n.patterns.push(p)
      }
    Call({ text: "check", .. }, [Path([p], ..)], ..) => n.checks.push(p.text)
    _ => self.not_a_constraint(e)
  }
}

///|
fn max_opt(a : Int32?, b : Int32) -> Int32 {
  match a {
    Some(x) => @cmp.maximum(x, b)
    None => b
  }
}

///|
fn min_opt(a : Int32?, b : Int32) -> Int32 {
  match a {
    Some(x) => @cmp.minimum(x, b)
    None => b
  }
}

///|
fn intersect(
  a : Array[@syntax.Lit]?,
  b : Array[@syntax.Lit],
) -> Array[@syntax.Lit] {
  match a {
    None => b
    Some(a) => a.filter(x => b.contains(x))
  }
}

///|
/// An s32's exclusive bounds as inclusive ones, rounded inward.
fn integral(n : Norm, ty : Ty) -> Unit {
  if unoption(ty) != S32 {
    return
  }
  if n.lo is Some(b) {
    let v = if b.exclusive { b.value.floor() + 1.0 } else { b.value.ceil() }
    n.lo = Some({ value: v, exclusive: false, })
  }
  if n.hi is Some(b) {
    let v = if b.exclusive { b.value.ceil() - 1.0 } else { b.value.floor() }
    n.hi = Some({ value: v, exclusive: false, })
  }
}

///|
/// Why no value can meet n, in words, or None.
pub fn contradiction(n : Norm, subject : String) -> String? {
  if n.lo is Some(lo) && n.hi is Some(hi) {
    if lo.value > hi.value ||
      (lo.value == hi.value && (lo.exclusive || hi.exclusive)) {
      return Some(
        "it must be \{bound_text(lo, true)} and \{bound_text(hi, false)}",
      )
    }
  }
  if n.len_lo is Some(lo) && n.len_hi is Some(hi) && lo > hi {
    return Some("its length must be at least \{lo} and at most \{hi}")
  }
  if n.len_hi is Some(hi) && hi < 0 {
    return Some("its length must be at most \{hi}")
  }
  if n.one_of is Some(allowed) {
    let left = allowed.filter(l => !n.none_of.contains(l) && lit_meets(l, n))
    if left.is_empty() {
      return Some(
        if allowed.is_empty() {
          "the values it must be one of have nothing in common"
        } else {
          "none of \{allowed.map(lit_text).join(", ")} meets its other constraints"
        },
      )
    }
  }
  ignore(subject)
  None
}

///|
/// Whether a literal meets n's bounds and lengths (key_of, member_of,
/// patterns and checks need the state or the host).
pub fn lit_meets(l : @syntax.Lit, n : Norm) -> Bool {
  let num = match l {
    Int(i) => Some(i.to_double())
    Float(f) => Some(f)
    _ => None
  }
  if num is Some(v) {
    if n.lo is Some(b) && (v < b.value || (b.exclusive && v == b.value)) {
      return false
    }
    if n.hi is Some(b) && (v > b.value || (b.exclusive && v == b.value)) {
      return false
    }
  }
  if l is Str(s) {
    if n.len_lo is Some(lo) && s.length() < lo {
      return false
    }
    if n.len_hi is Some(hi) && s.length() > hi {
      return false
    }
  }
  if n.one_of is Some(ls) && !ls.contains(l) && !(l is Null) {
    return false
  }
  !n.none_of.contains(l)
}

///|
/// The normal form of a where clause on subject, of type ty; reports what
/// isn't a constraint, what doesn't fit the type, redundancy and
/// contradictions into diags.
pub fn normalize(
  where_ : @syntax.Expr?,
  subject : String,
  ty : Ty,
  fields : Map[String, Ty],
  diags : Array[@diag.Diagnostic],
) -> Norm {
  let n = Norm::new()
  guard where_ is Some(e) else { return n }
  let ctx = { subject, ty, fields, diags, }
  let atoms = []
  split_and(e, atoms)
  for a in atoms {
    ctx.atom(n, a)
  }
  integral(n, ty)
  if contradiction(n, subject) is Some(why) {
    diags.push(
      @diag.error(
        "tcd.where.contradiction",
        e.span(),
        "\{subject} can never be valid: \{why}",
      ),
    )
  }
  n
}

///|
/// n in words: "at least 1 and at most 10", for explain.
pub fn norm_text(n : Norm) -> String {
  let parts = []
  if n.lo is Some(b) {
    parts.push(bound_text(b, true))
  }
  if n.hi is Some(b) {
    parts.push(bound_text(b, false))
  }
  if n.len_lo is Some(v) {
    parts.push("of length at least \{v}")
  }
  if n.len_hi is Some(v) {
    parts.push("of length at most \{v}")
  }
  if n.one_of is Some(ls) {
    parts.push("one of \{ls.map(lit_text).join(", ")}")
  }
  if !n.none_of.is_empty() {
    parts.push("none of \{n.none_of.map(lit_text).join(", ")}")
  }
  for p in n.patterns {
    parts.push("matching \{p.escape()}")
  }
  for f in n.key_of {
    parts.push("a key of \{f}")
  }
  for f in n.member_of {
    parts.push("one of the values of \{f}")
  }
  for c in n.checks {
    parts.push("satisfying \{c}")
  }
  if parts.is_empty() {
    "anything of its type"
  } else {
    parts.join(" and ")
  }
}

// Conditions (when, ensures, invariants) compiled to Wax predicates over
// values: every term is a value, read from the state the predicate is given,
// and the cond_* functions of the runtime (lib/author.wax) compare them.
// all(xs, c) and any(xs, c) become helper functions looping over xs.

///|
priv enum Where {
  /// A guard (pre_fn) or an invariant: `state`, and the arguments for a guard.
  Pre
  /// An ensures (post_fn): `prev_s` and `next_s`, and the arguments.
  Post
  Inv
} derive(Eq)

///|
priv struct CondGen {
  g : Gen
  c : @check.ComponentM
  params : Array[@check.FieldM]
  where_ : Where
  /// Functions all/any compile to, written before the predicate.
  helpers : Out
  mut next : Int32
  prefix : String
}

///|
fn CondGen::state_type(self : CondGen) -> String {
  "&\{@check.wax_part(self.c.name)}_state"
}

///|
/// The parameters every helper of this predicate takes, and how to pass them.
fn CondGen::env_params(self : CondGen) -> (String, String) {
  let st = self.state_type()
  match self.where_ {
    Pre => ("state: \{st}, args: &value_array", "state, args")
    Post =>
      (
        "prev_s: \{st}, next_s: \{st}, args: &value_array",
        "prev_s, next_s, args",
      )
    Inv => ("state: \{st}", "state")
  }
}

///|
fn CondGen::read(self : CondGen, state : String, name : String) -> String {
  let c = @check.wax_part(self.c.name)
  match self.c.field(name) {
    Some(f) => self.g.encode(f.ty, "\{state}.\{@check.wax(name)}")
    None =>
      match self.c.gets.iter().find_first(g => g.name == name) {
        Some(g) =>
          self.g.encode(g.ty, "\{c}_get_\{@check.wax_part(name)}(\{state})")
        None => "value_null()"
      }
  }
}

///|
fn CondGen::state_var(self : CondGen) -> String {
  if self.where_ == Post {
    "prev_s"
  } else {
    "state"
  }
}

///|
/// e as a value.
fn CondGen::term(self : CondGen, e : @syntax.Expr) -> String {
  match e {
    Lit(l, ..) => self.g.lit(l)
    Path(parts, ..) => {
      let first = parts[0].text
      let mut rest = parts[1:].to_owned()
      let mut v = if first == "it" {
        "it"
      } else if first == "next" {
        let f = rest[0].text
        rest = rest[1:].to_owned()
        self.read("next_s", f)
      } else {
        match self.params.search_by(p => p.name == first) {
          Some(i) => "args[\{i}]!"
          None => self.read(self.state_var(), first)
        }
      }
      for m in rest {
        v = "value_member(\{v}, \{self.g.s(m.text)})"
      }
      v
    }
    List(items, ..) => {
      let mut v = "list_empty()"
      for i in items {
        v = "list_push(\{v}, \{self.term(i)})"
      }
      v
    }
    Record(entries, ..) => {
      let mut v = "map_empty()"
      for en in entries {
        v = "map_assoc(\{v}, \{self.g.s(en.0.text)}, \{self.term(en.1)})"
      }
      v
    }
    Call({ text: "len", .. }, [a], ..) => "cond_len(\{self.term(a)})"
    Call({ text: "keys", .. }, [a], ..) => "cond_keys(\{self.term(a)})"
    Call({ text: "values", .. }, [a], ..) => "cond_values(\{self.term(a)})"
    Bin(Add, l, r, ..) => "cond_add(\{self.term(l)}, \{self.term(r)})"
    Bin(Sub, l, r, ..) => "cond_sub(\{self.term(l)}, \{self.term(r)})"
    _ => "value_bool(\{self.cond(e)})"
  }
}

///|
/// e as an i32 condition.
fn CondGen::cond(self : CondGen, e : @syntax.Expr) -> String {
  match e {
    Bin(And, l, r, ..) => "(\{self.cond(l)}) & (\{self.cond(r)})"
    Bin(Or, l, r, ..) => "(\{self.cond(l)}) | (\{self.cond(r)})"
    Not(inner, ..) => "!(\{self.cond(inner)})"
    Bin(Eq, l, r, ..) => "cond_eq(\{self.term(l)}, \{self.term(r)})"
    Bin(Ne, l, r, ..) => "!cond_eq(\{self.term(l)}, \{self.term(r)})"
    Bin(Lt, l, r, ..) => "cond_lt(\{self.term(l)}, \{self.term(r)})"
    Bin(Le, l, r, ..) => "cond_le(\{self.term(l)}, \{self.term(r)})"
    Bin(Gt, l, r, ..) => "cond_gt(\{self.term(l)}, \{self.term(r)})"
    Bin(Ge, l, r, ..) => "cond_ge(\{self.term(l)}, \{self.term(r)})"
    Bin(In, l, r, ..) => "cond_in(\{self.term(l)}, \{self.term(r)})"
    Bin(NotIn, l, r, ..) => "!cond_in(\{self.term(l)}, \{self.term(r)})"
    Matches(l, p, ..) => "cond_matches(\{self.term(l)}, \{self.g.s(p)})"
    Call({ text: "check", .. }, [Path([p], ..)], ..) =>
      "\{@check.wax_part(self.c.name)}_check_\{p.text}(\{self.state_var()})"
    Call({ text: "all" | "any" as which, .. }, [xs, body], ..) => {
      let name = "\{self.prefix}_\{which}_\{self.next}"
      self.next += 1
      let (params, pass) = self.env_params()
      let inner = self.cond(body)
      let h = self.helpers
      h.line("fn \{name}(\{params}, coll: &value) -> i32 {")
      h.line("    let n = cond_count(coll);")
      h.line("    let i = 0;")
      h.line("    while i <s n {")
      h.line("        let it = cond_item(coll, i);")
      if which == "all" {
        h.line("        if !(\{inner}) {")
        h.line("            return 0;")
      } else {
        h.line("        if \{inner} {")
        h.line("            return 1;")
      }
      h.line("        }")
      h.line("        i += 1;")
      h.line("    }")
      h.line(if which == "all" { "    1;" } else { "    0;" })
      h.line("}")
      h.line("")
      "\{name}(\{pass}, \{self.term(xs)})"
    }
    _ => "value_truthy(\{self.term(e)})"
  }
}

///|
/// The when of m as a pre_fn, its ensures as a post_fn, and the invariants
/// as invariant_fns; the helpers they use come first.
fn Gen::predicates(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax_part(c.name)
  let st = "&\{cw}_state"
  let helpers = Out::new()
  let preds = Out::new()
  for m in c.messages {
    let mw = @check.wax_part(m.name)
    if m.when_ is Some(w) {
      let cg = {
        g: self,
        c,
        params: m.params,
        where_: Pre,
        helpers,
        next: 0,
        prefix: "\{cw}_when_\{mw}",
      }
      let body = cg.cond(w)
      preds.line("// when \{@check.expr_text(w)}")
      preds.line(
        "fn \{cw}_when_\{mw}: pre_fn (instance: &eq, args: &value_array, ctx: &context) -> i32 {",
      )
      preds.line("    let state = instance as \{st};")
      preds.line("    \{body};")
      preds.line("}")
      preds.line("")
    }
    if m.ensures is Some(e) {
      let cg = {
        g: self,
        c,
        params: m.params,
        where_: Post,
        helpers,
        next: 0,
        prefix: "\{cw}_ensures_\{mw}",
      }
      let body = cg.cond(e)
      preds.line("// ensures \{@check.expr_text(e)}")
      preds.line(
        "fn \{cw}_ensures_\{mw}: post_fn (prev: &eq, next: &eq, args: &value_array, ctx: &context) -> i32 {",
      )
      preds.line("    let prev_s = prev as \{st};")
      preds.line("    let next_s = next as \{st};")
      preds.line("    \{body};")
      preds.line("}")
      preds.line("")
    }
  }
  for inv in c.invariants {
    let iw = @check.wax_part(inv.name)
    let cg = {
      g: self,
      c,
      params: [],
      where_: Inv,
      helpers,
      next: 0,
      prefix: "\{cw}_inv_\{iw}",
    }
    let body = cg.cond(inv.cond)
    preds.line("// invariant \{inv.name}: \{@check.expr_text(inv.cond)}")
    preds.line("fn \{cw}_inv_\{iw}: invariant_fn (instance: &eq) -> i32 {")
    preds.line("    let state = instance as \{st};")
    preds.line("    \{body};")
    preds.line("}")
    preds.line("")
  }
  helpers.to_string() + preds.to_string()
}

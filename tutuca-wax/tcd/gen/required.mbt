// The naming convention: every function the implementation provides, with
// the signature the generated glue calls it with. The stub writes them; the
// convention check (@compose) holds the implementation to them.

///|
pub(all) struct Required {
  /// The Wax function name: json_number_on_set_text.
  name : String
  params : Array[(String, String)]
  result : String
  /// What it's for, from the TCD file.
  what : String
  /// What it does, when the TCD file says (doc, when, ensures).
  notes : Array[String]
  span : @diag.Span
  /// The glue calls it only when the implementation has it (an ask's error
  /// and not-found replies, which stay unhandled otherwise).
  optional : Bool
} derive(Debug)

///|
/// The signature as Wax writes it: `fn name(a: T, ...) -> R`.
pub fn Required::signature(self : Required) -> String {
  let ps = self.params.map(p => "\{p.0}: \{p.1}").join(", ")
  "fn \{self.name}(\{ps}) -> \{self.result}"
}

///|
fn typed_params(ps : Array[@check.FieldM]) -> Array[(String, String)] {
  ps.map(p => (@check.wax(p.name), wax_ty(p.ty)))
}

///|
/// Every function c's implementation provides.
pub fn required_of(
  pkg : @check.Package,
  c : @check.ComponentM,
) -> Array[Required] {
  let cw = @check.wax(c.name)
  let st = ("state", "&\{cw}_state")
  let ctx = ("ctx", "&context")
  let state_t = "&\{cw}_state"
  let out = []
  for m in c.messages {
    let notes = []
    if m.doc is Some(d) {
      notes.push(d)
    }
    if m.when_ is Some(w) {
      notes.push("when \{@check.expr_text(w)}")
    }
    if m.changes is Some(ch) {
      notes.push(
        if ch.is_empty() {
          "changes nothing"
        } else {
          "changes \{ch.join(", ")}"
        },
      )
    }
    if m.ensures is Some(e) {
      notes.push("ensures \{@check.expr_text(e)}")
    }
    let params = [st, ctx]
    params.append(typed_params(m.params))
    out.push({
      name: "\{cw}_on_\{@check.wax(m.name)}",
      params,
      result: if m.swap {
        "&\{cw}_swap_result"
      } else {
        state_t
      },
      what: "handles the message \{m.name}",
      notes,
      span: m.span,
      optional: false,
    })
  }
  for g in c.gets {
    out.push({
      name: "\{cw}_get_\{@check.wax(g.name)}",
      params: [st],
      result: wax_ty(g.ty),
      what: "computes the property \{g.name}: \{@check.ty_text(g.ty)}",
      notes: g.doc.map(d => [d]).unwrap_or([]),
      span: g.span,
      optional: false,
    })
  }
  for a in c.asks {
    let aw = @check.wax(a.name)
    let result = a.result.unwrap_or(Any)
    out.push({
      name: "\{cw}_reply_\{aw}_ok",
      params: [st, ctx, ("reply", wax_ty(result))],
      result: state_t,
      what: "takes the answer to the ask \{a.name}",
      notes: [],
      span: a.span,
      optional: false,
    })
    out.push({
      name: "\{cw}_reply_\{aw}_err",
      params: [st, ctx, ("error", "&value")],
      result: state_t,
      what: "takes the error the ask \{a.name} was answered with (optional: without it, the error is unhandled)",
      notes: [],
      span: a.span,
      optional: true,
    })
    out.push({
      name: "\{cw}_reply_\{aw}_not_found",
      params: [st, ctx],
      result: state_t,
      what: "is told no scope answers the ask \{a.name} (optional: without it, that's unhandled)",
      notes: [],
      span: a.span,
      optional: true,
    })
  }
  for l in c.loops {
    let lw = "\{cw}_loop_\{@check.wax(l.name)}"
    let extra = match l.prepare {
      Some(t) => [("prepared", wax_ty(t))]
      None => []
    }
    if l.prepare is Some(t) {
      out.push({
        name: "\{lw}_prepare",
        params: [st, ("items", "&value")],
        result: wax_ty(t),
        what: "prepares what the loop \{l.name}'s other hooks get",
        notes: [],
        span: l.span,
        optional: false,
      })
    }
    let item_params = [st, ("key", "&value"), ("item", "&value")]
    item_params.append(extra)
    if l.iter {
      let ps = [st, ("items", "&value")]
      ps.append(extra)
      out.push({
        name: "\{lw}_iter",
        params: ps,
        result: "&value",
        what: "gives the loop \{l.name}'s items, a list of [key, value] lists",
        notes: [],
        span: l.span,
        optional: false,
      })
    }
    if l.key is Some(t) {
      out.push({
        name: "\{lw}_key",
        params: item_params,
        result: wax_ty(t),
        what: "keys an item of the loop \{l.name}",
        notes: [],
        span: l.span,
        optional: false,
      })
    }
    if l.filter {
      out.push({
        name: "\{lw}_filter",
        params: item_params,
        result: "i32",
        what: "says whether an item of the loop \{l.name} renders",
        notes: [],
        span: l.span,
        optional: false,
      })
    }
    if l.enrich is Some(_) {
      out.push({
        name: "\{lw}_enrich",
        params: item_params,
        result: "&\{lw}_binds",
        what: "gives the binds the body of the loop \{l.name} sees",
        notes: [],
        span: l.span,
        optional: false,
      })
    }
  }
  for s in c.scopes {
    out.push({
      name: "\{cw}_scope_\{@check.wax(s.name)}",
      params: [st],
      result: "&\{cw}_scope_\{@check.wax(s.name)}_binds",
      what: "gives the binds the scope \{s.name} sees",
      notes: [],
      span: s.span,
      optional: false,
    })
  }
  for ch in c.checks {
    let params = [st]
    if ch.1 is Some(t) {
      params.push(("v", wax_ty(t)))
    }
    out.push({
      name: "\{cw}_check_\{ch.0}",
      params,
      result: "i32",
      what: "is the predicate check(\{ch.0})",
      notes: [],
      span: c.span,
      optional: false,
    })
  }
  if c.init_hook {
    out.push({
      name: "\{cw}_init",
      params: [st, ("ctx", "&init_context")],
      result: state_t,
      what: "finishes a \{c.name} init made from its fields",
      notes: [],
      span: c.span,
      optional: false,
    })
  }
  ignore(pkg)
  out
}

///|
/// The package-level functions: what answers its asks.
pub fn required_of_package(pkg : @check.Package) -> Array[Required] {
  pkg.ask_handlers.map(a => {
    let params = [("ctx", "&context")]
    params.append(typed_params(a.params))
    {
      name: "\{@check.wax(pkg.name)}_answer_\{@check.wax(a.name)}",
      params,
      result: "&value",
      what: "answers the ask \{a.name}, now, with value_ok(...) or value_err(...)",
      notes: a.doc.map(d => [d]).unwrap_or([]),
      span: a.span,
      optional: false,
    }
  })
}

///|
/// Everything the implementation of pkg provides.
pub fn required(pkg : @check.Package) -> Array[Required] {
  let out = []
  for c in pkg.components {
    out.append(required_of(pkg, c))
  }
  out.append(required_of_package(pkg))
  out
}

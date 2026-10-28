// The contract: what the implementation compiles against. The state struct
// of each component, the binds structs of its loops and scopes, the
// constants of its enum fields, and the helpers it calls: functional updates
// of the state, and typed notify, ask, send and make.

///|
fn Gen::args_array(
  self : Gen,
  ps : Array[@check.FieldM],
) -> (Array[String], String) {
  let lines = []
  lines.push("    let args = [value_array|null; \{ps.length()}];")
  for i, p in ps {
    lines.push("    args[\{i}] = \{self.encode(p.ty, @check.wax(p.name))};")
  }
  (lines, "args")
}

///|
fn param_list(ps : Array[@check.FieldM]) -> String {
  ps.map(p => ", \{@check.wax(p.name)}: \{wax_ty(p.ty)}").join("")
}

///|
fn struct_type(name : String, fs : Array[@check.FieldM]) -> String {
  if fs.is_empty() {
    return "type \{name} = { };"
  }
  "type \{name} = { \{fs.map(f => "\{@check.wax(f.name)}: \{wax_ty(f.ty)}").join(", ")} };"
}

///|
/// The fields a component of the named type or interface is made from.
fn Gen::make_fields(self : Gen, name : String) -> Array[@check.FieldM] {
  match self.pkg.component(name) {
    Some(c) => c.fields
    None =>
      match self.pkg.interface_named(name) {
        Some(i) => i.fields
        None => []
      }
  }
}

///|
pub fn Gen::contract(self : Gen) -> String {
  let out = Out::new()
  let sends : Array[String] = []
  for c in self.pkg.components {
    let cw = @check.wax(c.name)
    out.line(
      "// ---- \{c.name} " + "-".repeat(@cmp.maximum(4, 74 - c.name.length())),
    )
    out.write(doc_lines(c.doc))
    out.line("")
    out.line(struct_type("\{cw}_state", c.fields))
    out.line("")
    for f in c.fields {
      if f.ty is Enum(ms) {
        for i, m in ms {
          out.line("const \{cw}_\{@check.wax(f.name)}_\{m} = \{i};")
        }
        out.line("")
      }
    }
    for l in c.loops {
      if l.enrich is Some(bs) {
        out.line(struct_type("\{cw}_loop_\{@check.wax(l.name)}_binds", bs))
        out.line("")
      }
    }
    for s in c.scopes {
      out.line(struct_type("\{cw}_scope_\{@check.wax(s.name)}_binds", s.binds))
      out.line("")
    }
    // Functional updates.
    for f in c.fields {
      let fw = @check.wax(f.name)
      let entries = c.fields
        .map(g => {
          let gw = @check.wax(g.name)
          if g.name == f.name {
            "\{gw}: v"
          } else {
            "\{gw}: state.\{gw}"
          }
        })
        .join(", ")
      out.line("// state with \{f.name} set to v.")
      out.line(
        "fn \{cw}_with_\{fw}(state: &\{cw}_state, v: \{wax_ty(f.ty)}) -> &\{cw}_state {",
      )
      out.line("    {\{cw}_state| \{entries} };")
      out.line("}")
      out.line("")
    }
    // What a swap handler returns: the component to swap in, or this one's
    // next state, keeping it.
    if c.messages.iter().any(m => m.swap) {
      out.line(
        "// What a swap handler gives: a component to swap in (\{cw}_swap_to), or the",
      )
      out.line("// next state, keeping this component (\{cw}_keep).")
      out.line(
        "type \{cw}_swap_result = { component: &?component, state: &?\{cw}_state };",
      )
      out.line("")
      out.line("// swap this component for c.")
      out.line("fn \{cw}_swap_to(c: &component) -> &\{cw}_swap_result {")
      out.line("    {\{cw}_swap_result| component: c, state: null };")
      out.line("}")
      out.line("")
      out.line("// keep this component, with state as its next state.")
      out.line("fn \{cw}_keep(state: &\{cw}_state) -> &\{cw}_swap_result {")
      out.line("    {\{cw}_swap_result| component: null, state };")
      out.line("}")
      out.line("")
    }
    for n in c.notifies {
      let (lines, args) = self.args_array(n.params)
      out.line(
        "// notify \{n.name}: to the parent, bubbling until a handler stops it.",
      )
      out.line(
        "fn \{cw}_notify_\{@check.wax(n.name)}(ctx: &context\{param_list(n.params)}) {",
      )
      lines.each(l => out.line(l))
      out.line("    ctx_notify(ctx, \{self.s(n.name)}, \{args});")
      out.line("}")
      out.line("")
    }
    for a in c.asks {
      let (lines, args) = self.args_array(a.params)
      out.line(
        "// ask \{a.name}: the reply comes back to \{cw}_reply_\{@check.wax(a.name)}_ok, _err or _not_found.",
      )
      out.line(
        "fn \{cw}_ask_\{@check.wax(a.name)}(ctx: &context\{param_list(a.params)}) {",
      )
      lines.each(l => out.line(l))
      out.line("    ctx_ask(ctx, \{self.s(a.name)}, \{args});")
      out.line("}")
      out.line("")
    }
    let makes : Array[String] = []
    for m in c.messages {
      for e in m.emits.unwrap_or([]) {
        match e.kind {
          SendAt => {
            let t = e.target.unwrap_or("")
            let key = "\{t}.\{e.name}"
            if sends.contains(key) {
              continue
            }
            sends.push(key)
            let params = match self.pkg.component(t) {
              Some(tc) => tc.message(e.name).map(x => x.params).unwrap_or([])
              None =>
                self.pkg
                .interface_named(t)
                .bind(i => i.messages.iter().find_first(x => x.name == e.name))
                .map(x => x.params)
                .unwrap_or([])
            }
            let (lines, args) = self.args_array(params)
            out.line(
              "// send \{t}.\{e.name} to the components below that at selects.",
            )
            out.line(
              "fn \{@check.wax(t)}_send_\{@check.wax(e.name)}(ctx: &context, at: &selector\{param_list(params)}) {",
            )
            lines.each(l => out.line(l))
            out.line("    ctx_send_at(ctx, \{self.s(e.name)}, \{args}, at);")
            out.line("}")
            out.line("")
          }
          Make => {
            if makes.contains(e.name) {
              continue
            }
            makes.push(e.name)
            let fs = self.make_fields(e.name)
            out.line(
              "// make a \{e.name}, by name, in the handling component's scope.",
            )
            out.line(
              "fn \{cw}_make_\{@check.wax(e.name)}(ctx: &context\{param_list(fs)}) -> &component {",
            )
            let mut map = "map_empty()"
            for f in fs {
              map = "map_assoc(\{map}, \{self.s(f.name)}, \{self.encode(f.ty, @check.wax(f.name))})"
            }
            out.line("    ctx_make(ctx, \{self.s(e.name)}, \{map});")
            out.line("}")
            out.line("")
          }
          _ => ()
        }
      }
    }
  }
  out.to_string()
}

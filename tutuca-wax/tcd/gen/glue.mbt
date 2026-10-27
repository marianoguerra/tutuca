// The glue: everything about a component the implementation doesn't write.
// Its spec (views as data, loop and scope hooks, provides) and schema (types,
// constraints, message contracts compiled to predicates, invariants), its
// vtable (init with defaults and issues, get, set validated against the
// schema, and handle, which routes a message value to the typed handler the
// implementation provides), and the module's registration.

///|
fn Gen::message_schema(
  self : Gen,
  b : Block,
  c : @check.ComponentM?,
  m : @check.MessageM,
  owner : String,
) -> String {
  let args = self.field_schemas(b, m.params, owner)
  let key = match m.source_key {
    Some(k) => self.field_schema(b, k, owner)
    None => "null"
  }
  let (pre, post) = match c {
    Some(c) => {
      let cw = @check.wax(c.name)
      let mw = @check.wax(m.name)
      (
        if m.when_ is Some(_) {
          "\{cw}_when_\{mw}"
        } else {
          "null"
        },
        if m.ensures is Some(_) {
          "\{cw}_ensures_\{mw}"
        } else {
          "null"
        },
      )
    }
    None => ("null", "null")
  }
  let changes = match m.changes {
    Some(ch) => b.array("str_array", ch.map(f => self.s(@check.camel(f))))
    None => "null"
  }
  let emits = match m.emits {
    Some(es) => {
      let items = []
      for e in es {
        let kind = match e.kind {
          Notify => "emit_kind_notify"
          Ask => "emit_kind_ask"
          SendAt => "emit_kind_send_at"
          Make => continue
        }
        items.push("emit_spec_new(\{kind}, \{self.s(@check.camel(e.name))})")
      }
      b.array("emit_array", items)
    }
    None => "null"
  }
  "message_schema_new(\{self.s(@check.camel(m.name))}, \{args}, \{key}, \{pre}, \{post}, \{changes}, \{emits})"
}

///|
fn Gen::schema_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let b = Block::new()
  let fields = self.field_schemas(b, c.fields, cw)
  let gets = self.field_schemas(b, c.gets, cw)
  let messages = b.array(
    "message_schema_array",
    c.messages.map(m => self.message_schema(b, Some(c), m, cw)),
  )
  let invariants = b.array(
    "invariant_array",
    c.invariants.map(i => {
      "invariant_new(\{self.s(@check.camel(i.name))}, \{cw}_inv_\{@check.wax(i.name)})"
    }),
  )
  let interfaces = b.array(
    "str_array",
    c.implements.map(i => self.s(@check.pascal(i))),
  )
  let out = Out::new()
  out.line("let \{cw}_schema_made: &?component_schema = null;")
  out.line("")
  out.line(
    "// \{c.name}'s schema: what the runtime checks its values and messages against.",
  )
  out.line("fn \{cw}_schema() -> &component_schema {")
  out.line("    if !!\{cw}_schema_made {")
  out.line("        return \{cw}_schema_made!;")
  out.line("    }")
  out.line(b.render("    "))
  out.line(
    "    let schema = component_schema_new(\{fields}, \{gets}, \{messages}, \{invariants}, \{interfaces});",
  )
  out.line("    \{cw}_schema_made = schema;")
  out.line("    schema;")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::spec_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let b = Block::new()
  let names = b.array(
    "str_array",
    c.views.map(v => self.s(@check.camel(v.name))),
  )
  let views = b.array(
    "view_array",
    c.views.map(v => "\{cw}_view_\{@check.wax(v.name)}()"),
  )
  let loops = b.array(
    "loop_def_array",
    c.loops.map(l => {
      let lw = "\{cw}_loop_\{@check.wax(l.name)}"
      let hook = (on : Bool, name : String) => {
        if on {
          "\{lw}_\{name}_t"
        } else {
          "null"
        }
      }
      let view = match l.view {
        Some(v) => self.s(@check.camel(v))
        None => "null"
      }
      "{loop_def| name: \{self.s(@check.camel(l.name))}, prepare: \{hook(l.prepare is Some(_), "prepare")}, iter: \{hook(l.iter, "iter")}, key: \{hook(l.key is Some(_), "key")}, filter: \{hook(l.filter, "filter")}, enrich: \{hook(l.enrich is Some(_), "enrich")}, view: \{view} }"
    }),
  )
  let scopes = b.array(
    "scope_def_array",
    c.scopes.map(s => {
      "{scope_def| name: \{self.s(@check.camel(s.name))}, bind: \{cw}_scope_\{@check.wax(s.name)}_t }"
    }),
  )
  let pnames = b.array(
    "str_array",
    c.provides.map(p => self.s(@check.camel(p.name))),
  )
  let selectors = b.array(
    "selector_array",
    c.provides.map(p => "selector_field(\{self.s(@check.camel(p.field))})"),
  )
  let out = Out::new()
  out.line("let \{cw}_spec_made: &?component_spec = null;")
  out.line("")
  out.line("fn \{cw}_spec() -> &component_spec {")
  out.line("    if !!\{cw}_spec_made {")
  out.line("        return \{cw}_spec_made!;")
  out.line("    }")
  out.line(b.render("    "))
  out.line(
    "    let spec = spec_new(\{self.s(@check.pascal(c.name))}, \{names}, \{views}, \{loops}, \{scopes}, \{pnames}, \{selectors});",
  )
  out.line("    spec_set_schema(spec, \{cw}_schema());")
  out.line("    \{cw}_spec_made = spec;")
  out.line("    spec;")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::view_fns(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let out = Out::new()
  for v in c.views {
    let b = Block::new()
    let e = self.view(b, v.body)
    out.write(doc_lines(v.doc))
    out.line("fn \{cw}_view_\{@check.wax(v.name)}() -> &view {")
    if !b.lines.is_empty() {
      out.line(b.render("    "))
    }
    out.line("    \{e};")
    out.line("}")
    out.line("")
  }
  out.to_string()
}

///|
/// The binds struct b of the given binds, as the map value a view reads.
fn Gen::binds_map(
  self : Gen,
  binds : Array[@check.FieldM],
  holder : String,
) -> String {
  let mut m = "map_empty()"
  for f in binds {
    m = "map_assoc(\{m}, \{self.s(@check.camel(f.name))}, \{self.encode(f.ty, "\{holder}.\{@check.wax(f.name)}")})"
  }
  m
}

///|
fn Gen::hooks(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let st = "&\{cw}_state"
  let out = Out::new()
  for l in c.loops {
    let lw = "\{cw}_loop_\{@check.wax(l.name)}"
    let prepared = match l.prepare {
      Some(t) => ", \{self.decode(t, "prepared")}"
      None => ""
    }
    if l.prepare is Some(t) {
      out.line(
        "fn \{lw}_prepare_t: loop_prepare_fn (instance: &eq, items: &value) -> &value {",
      )
      out.line(
        "    \{self.encode(t, "\{lw}_prepare(instance as \{st}, items)")};",
      )
      out.line("}")
      out.line("")
    }
    if l.iter {
      out.line(
        "fn \{lw}_iter_t: loop_iter_fn (instance: &eq, items: &value, prepared: &value) -> &value {",
      )
      out.line("    \{lw}_iter(instance as \{st}, items\{prepared});")
      out.line("}")
      out.line("")
    }
    if l.key is Some(t) {
      out.line(
        "fn \{lw}_key_t: loop_key_fn (instance: &eq, key: &value, item: &value, prepared: &value) -> &value {",
      )
      out.line(
        "    \{self.encode(t, "\{lw}_key(instance as \{st}, key, item\{prepared})")};",
      )
      out.line("}")
      out.line("")
    }
    if l.filter {
      out.line(
        "fn \{lw}_filter_t: loop_filter_fn (instance: &eq, key: &value, item: &value, prepared: &value) -> i32 {",
      )
      out.line("    \{lw}_filter(instance as \{st}, key, item\{prepared});")
      out.line("}")
      out.line("")
    }
    if l.enrich is Some(bs) {
      out.line(
        "fn \{lw}_enrich_t: loop_enrich_fn (instance: &eq, binds: &value, prepared: &value) -> &value {",
      )
      out.line(
        "    let b = \{lw}_enrich(instance as \{st}, map_get(binds, \{self.s("key")})!, map_get(binds, \{self.s("value")})!\{prepared});",
      )
      out.line("    \{self.binds_map(bs, "b")};")
      out.line("}")
      out.line("")
    }
  }
  for s in c.scopes {
    let sw = "\{cw}_scope_\{@check.wax(s.name)}"
    out.line("fn \{sw}_t: scope_bind_fn (instance: &eq) -> &value {")
    out.line("    let b = \{sw}(instance as \{st});")
    out.line("    \{self.binds_map(s.binds, "b")};")
    out.line("}")
    out.line("")
  }
  // check(p) and values(f) constraints, by the subject they constrain.
  let subjects = []
  for f in c.fields {
    subjects.push(f)
  }
  for g in c.gets {
    subjects.push(g)
  }
  for m in c.messages {
    subjects.append(m.params)
    if m.source_key is Some(k) {
      subjects.push(k)
    }
  }
  let done : Array[String] = []
  for f in subjects {
    for p in f.norm.checks {
      let name = "\{cw}_check_\{p}_\{@check.wax(f.name)}_t"
      if done.contains(name) {
        continue
      }
      done.push(name)
      out.line("fn \{name}: check_fn (owner: &eq, v: &value) -> i32 {")
      out.line(
        "    \{cw}_check_\{p}(owner as \{st}, \{self.decode(f.ty, "v")});",
      )
      out.line("}")
      out.line("")
    }
    for g in f.norm.member_of {
      let name = "\{cw}_member_of_\{@check.wax(g)}"
      if done.contains(name) {
        continue
      }
      done.push(name)
      let field = c.field(g)
      let read = match field {
        Some(x) => self.encode(x.ty, "(owner as \{st}).\{@check.wax(g)}")
        None => "value_null()"
      }
      out.line("fn \{name}: check_fn (owner: &eq, v: &value) -> i32 {")
      out.line("    cond_in(v, cond_values(\{read}));")
      out.line("}")
      out.line("")
    }
  }
  out.to_string()
}

///|
fn Gen::init_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let out = Out::new()
  out.line(
    "// init: each field from fields when it's there and fits its schema, else its",
  )
  out.line(
    "// default, with an issue saying why; a field without a default fails. A",
  )
  out.line(
    "// make(name) default is made in ctx's scope, only when it's taken.",
  )
  out.line(
    "fn \{cw}_vt_init: init_fn (fields: &value, ctx: &init_context) -> &init_result {",
  )
  out.line("    let issues = list_empty();")
  out.line("    let schema = \{cw}_schema();")
  out.line("    let found: &?value = null;")
  out.line("    let problem: &?extern = null;")
  for i, f in c.fields {
    let fw = "f_\{@check.wax(f.name)}"
    let name = self.s(@check.camel(f.name))
    let missing = self.s("missing")
    let wrong = self.s("wrong type")
    let invalid = self.s("invalid")
    // What a field that falls back to its default takes, besides the issue.
    let fallback = f.make.map(m => {
      "\{fw} = value_component(init_ctx_make(ctx, \{self.s(@check.pascal(m))}, map_empty()));"
    })
    let fall_back = (indent : String) => {
      if fallback is Some(l) {
        out.line(indent + l)
      }
    }
    out.line("    let \{fw}: \{wax_ty(f.ty)} = \{self.start_value(f)};")
    out.line("    found = field_value(fields, \{name});")
    out.line("    if !found {")
    if f.required {
      out.line("        return init_fail(issues, \{name}, \{missing});")
    } else {
      out.line("        issues = init_issue(issues, \{name}, \{missing});")
      fall_back("        ")
    }
    out.line("    } else {")
    out.line(
      "        problem = vtype_problem((schema.fields[\{i}]!).vtype, found!);",
    )
    out.line("        if !!problem {")
    if f.required {
      out.line("            return init_fail(issues, \{name}, \{wrong});")
    } else {
      out.line("            issues = init_issue(issues, \{name}, \{wrong});")
      fall_back("            ")
    }
    out.line("        } else {")
    out.line(
      "            problem = constraints_problem((schema.fields[\{i}]!).constraints, found!, null);",
    )
    out.line("            if !!problem {")
    if f.required {
      out.line("                return init_fail(issues, \{name}, \{invalid});")
    } else {
      out.line(
        "                issues = init_issue(issues, \{name}, \{invalid});",
      )
      fall_back("                ")
    }
    out.line("            } else {")
    out.line("                \{fw} = \{self.decode(f.ty, "found!")};")
    out.line("            }")
    out.line("        }")
    out.line("    }")
  }
  let entries = c.fields
    .map(f => "\{@check.wax(f.name)}: f_\{@check.wax(f.name)}")
    .join(", ")
  out.line("    let state = {\{cw}_state| \{entries} };")
  if c.init_hook {
    out.line("    init_ok(\{cw}_init(state, ctx), issues);")
  } else {
    out.line("    init_ok(state, issues);")
  }
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::handle_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let out = Out::new()
  out.line(
    "// handle: routes a message to its handler. The runtime checked its arguments",
  )
  out.line(
    "// against the message's schema before this runs, so they decode as declared.",
  )
  out.line(
    "fn \{cw}_vt_handle: handle_fn (instance: &eq, m: &message, ctx: &context) -> &message_result {",
  )
  out.line("    let state = instance as &\{cw}_state;")
  for msg in c.messages {
    let args = msg.params
      .mapi((i, p) => ", \{self.decode(p.ty, "m.args[\{i}]!")}")
      .join("")
    let call = "\{cw}_on_\{@check.wax(msg.name)}(state, ctx\{args})"
    out.line("    if str_eq(m.name, \{self.s(@check.camel(msg.name))}) {")
    if msg.swap {
      out.line("        let r = \{call};")
      out.line("        if !!r.component {")
      out.line("            return message_result_swapped(r.component!);")
      out.line("        }")
      out.line("        return message_result_of(state, r.state!);")
    } else {
      out.line("        return message_result_of(state, \{call});")
    }
    out.line("    }")
  }
  for a in c.asks {
    let aw = @check.wax(a.name)
    let ac = @check.camel(a.name)
    let result = a.result.unwrap_or(Any)
    let b = Block::new()
    let vt = self.vtype(b, result)
    out.line("    if str_eq(m.name, \{self.s(ac + "ReplyOk")}) {")
    out.line("        if m.args.length() != 1 {")
    out.line(
      "            return message_result_rejected(message_error_wrong_arity(1, m.args.length()));",
    )
    out.line("        }")
    if !b.lines.is_empty() {
      out.line(b.render("        "))
    }
    out.line("        if !!vtype_problem(\{vt}, m.args[0]!) {")
    out.line(
      "            return message_result_rejected(message_error_wrong_arg_type(0));",
    )
    out.line("        }")
    out.line(
      "        return message_result_of(state, \{cw}_reply_\{aw}_ok(state, ctx, \{self.decode(result, "m.args[0]!")}));",
    )
    out.line("    }")
    if self.has("\{cw}_reply_\{aw}_err") {
      out.line("    if str_eq(m.name, \{self.s(ac + "ReplyError")}) {")
      out.line("        if m.args.length() != 1 {")
      out.line(
        "            return message_result_rejected(message_error_wrong_arity(1, m.args.length()));",
      )
      out.line("        }")
      out.line(
        "        return message_result_of(state, \{cw}_reply_\{aw}_err(state, ctx, m.args[0]!));",
      )
      out.line("    }")
    }
    if self.has("\{cw}_reply_\{aw}_not_found") {
      out.line("    if str_eq(m.name, \{self.s(ac + "HandlerNotFound")}) {")
      out.line(
        "        return message_result_of(state, \{cw}_reply_\{aw}_not_found(state, ctx));",
      )
      out.line("    }")
    }
  }
  out.line("    message_result_rejected(message_error_unknown_message());")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::get_set_fns(self : Gen, c : @check.ComponentM) -> String {
  let cw = @check.wax(c.name)
  let out = Out::new()
  out.line(
    "fn \{cw}_vt_get: get_fn (instance: &eq, name: &extern) -> (i32, &?value) {",
  )
  out.line("    let state = instance as &\{cw}_state;")
  for f in c.fields {
    out.line("    if str_eq(name, \{self.s(@check.camel(f.name))}) {")
    out.line(
      "        return (property_ok, \{self.encode(f.ty, "state.\{@check.wax(f.name)}")});",
    )
    out.line("    }")
  }
  for g in c.gets {
    out.line("    if str_eq(name, \{self.s(@check.camel(g.name))}) {")
    out.line(
      "        return (property_ok, \{self.encode(g.ty, "\{cw}_get_\{@check.wax(g.name)}(state)")});",
    )
    out.line("    }")
  }
  out.line("    (property_no_such_property, null);")
  out.line("}")
  out.line("")
  out.line(
    "// set: a field, when the value fits its schema; a property is read only.",
  )
  out.line(
    "fn \{cw}_vt_set: set_fn (instance: &eq, name: &extern, v: &value) -> (i32, &?eq) {",
  )
  out.line("    let state = instance as &\{cw}_state;")
  if !c.fields.is_empty() {
    out.line("    let schema = \{cw}_schema();")
  }
  for i, f in c.fields {
    out.line("    if str_eq(name, \{self.s(@check.camel(f.name))}) {")
    out.line("        if !!vtype_problem((schema.fields[\{i}]!).vtype, v) {")
    out.line("            return (property_wrong_type, null);")
    out.line("        }")
    out.line(
      "        if !!constraints_problem((schema.fields[\{i}]!).constraints, v, null) {",
    )
    out.line("            return (property_invalid, null);")
    out.line("        }")
    out.line(
      "        return (property_ok, \{cw}_with_\{@check.wax(f.name)}(state, \{self.decode(f.ty, "v")}));",
    )
    out.line("    }")
  }
  for g in c.gets {
    out.line("    if str_eq(name, \{self.s(@check.camel(g.name))}) {")
    out.line("        return (property_not_writable, null);")
    out.line("    }")
  }
  out.line("    (property_no_such_property, null);")
  out.line("}")
  out.line("")
  out.line("fn \{cw}_vtable() -> &vtable {")
  out.line(
    "    {vtable| init: \{cw}_vt_init, handle: \{cw}_vt_handle, get: \{cw}_vt_get, set: \{cw}_vt_set };",
  )
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::interface_fn(self : Gen, i : @check.InterfaceM) -> String {
  let iw = @check.wax(i.name)
  let b = Block::new()
  let fields = self.field_schemas(b, i.fields, iw)
  let gets = self.field_schemas(b, i.gets, iw)
  let messages = b.array(
    "message_schema_array",
    i.messages.map(m => self.message_schema(b, None, m, iw)),
  )
  let out = Out::new()
  out.write(doc_lines(i.doc))
  out.line("fn \{iw}_interface() -> &interface_schema {")
  out.line(b.render("    "))
  out.line(
    "    interface_schema_new(\{self.s(@check.pascal(i.name))}, \{fields}, \{gets}, \{messages});",
  )
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::answer_fn(self : Gen, a : @check.SignalM) -> String {
  let pw = @check.wax(self.pkg.name)
  let aw = @check.wax(a.name)
  let b = Block::new()
  let checks = a.params.mapi((i, p) => {
    let vt = self.vtype(b, p.ty)
    "        if !!vtype_problem(\{vt}, args[\{i}]!) {\n            return ask_result_reply(value_err(value_string(\{self.s("wrong type")})));\n        }"
  })
  let args = a.params
    .mapi((i, p) => ", \{self.decode(p.ty, "args[\{i}]!")}")
    .join("")
  let out = Out::new()
  out.line(
    "fn \{pw}_answer_\{aw}_t: ask_fn (name: &extern, args: &value_array, ctx: &context) -> &ask_result {",
  )
  out.line("    if args.length() != \{a.params.length()} {")
  out.line(
    "        return ask_result_reply(value_err(value_string(\{self.s("wrong arity")})));",
  )
  out.line("    }")
  if !b.lines.is_empty() {
    out.line(b.render("    "))
  }
  checks.each(c => out.line(c))
  out.line("    ask_result_reply(\{pw}_answer_\{aw}(ctx\{args}));")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
pub fn Gen::glue(self : Gen) -> String {
  let out = Out::new()
  for c in self.pkg.components {
    out.line(
      "// ---- \{c.name} " + "-".repeat(@cmp.maximum(4, 74 - c.name.length())),
    )
    out.line("")
    out.write(self.predicates(c))
    out.write(self.hooks(c))
    out.write(self.view_fns(c))
    out.write(self.schema_fn(c))
    out.write(self.spec_fn(c))
    out.write(self.init_fn(c))
    out.write(self.handle_fn(c))
    out.write(self.get_set_fns(c))
  }
  out.line("// ---- The package " + "-".repeat(60))
  out.line("")
  for i in self.pkg.interfaces {
    if i.declared_here {
      out.write(self.interface_fn(i))
    }
  }
  for a in self.pkg.ask_handlers {
    out.write(self.answer_fn(a))
  }
  out.line("#[export = \"tutuca_abi_version\"]")
  out.line("fn tutuca_abi_version() -> i32 {")
  out.line("    tutuca_abi_version_current;")
  out.line("}")
  out.line("")
  out.line("#[export = \"tutuca_register\"]")
  out.line("fn tutuca_register(s: &scope) {")
  for i in self.pkg.interfaces {
    if i.declared_here {
      out.line(
        "    scope_register_interface(s, \{@check.wax(i.name)}_interface());",
      )
    }
  }
  for r in self.pkg.registers {
    let cw = @check.wax(r.component)
    out.line(
      "    scope_register(s, \{self.s(@check.pascal(r.as_))}, \{cw}_spec(), \{cw}_vtable());",
    )
  }
  for a in self.pkg.ask_handlers {
    out.line(
      "    scope_register_ask(s, \{self.s(@check.camel(a.name))}, \{@check.wax(self.pkg.name)}_answer_\{@check.wax(a.name)}_t);",
    )
  }
  for h in self.pkg.host_asks {
    out.line("    scope_register_host_ask(s, \{self.s(@check.camel(h))});")
  }
  out.line("}")
  out.line("")
  out.write(self.enum_helpers())
  out.to_string()
}

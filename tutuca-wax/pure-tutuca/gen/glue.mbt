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
) -> String {
  let args = self.field_schemas(b, m.params)
  let key = match m.source_key {
    Some(k) => self.field_schema(b, k)
    None => "null"
  }
  let (pre, post) = match c {
    Some(c) => {
      let cw = c.name
      let mw = m.name
      (
        if m.pre_entry {
          "\{cw}_when_\{mw}"
        } else {
          "null"
        },
        if m.post_entry {
          "\{cw}_ensures_\{mw}"
        } else {
          "null"
        },
      )
    }
    None => ("null", "null")
  }
  let changes = match m.changes {
    Some(ch) => b.array("str_array", ch.map(f => self.s(f)))
    None => "null"
  }
  // A pure message emits nothing, said or not.
  let emits = self.emit_array(
    b,
    if m.pure_ {
      Some(m.emits.unwrap_or([]))
    } else {
      m.emits
    },
  )
  let mut ms = "message_schema_new(\{self.s(m.name)}, \{args}, \{key}, \{pre}, \{post}, \{changes}, \{emits})"
  if m.pure_ {
    ms = "message_schema_set_pure(\{ms})"
  }
  if m.why is Some(why) {
    ms = "message_schema_set_why(\{ms}, \{self.s(why)})"
  }
  ms
}

///|
/// What a handler may emit, as the runtime checks it: null when it doesn't
/// say (unchecked).
fn Gen::emit_array(
  self : Gen,
  b : Block,
  emits : Array[@check.EmitM]?,
) -> String {
  match emits {
    Some(es) => {
      let items = []
      for e in es {
        let kind = match e.kind {
          Notify => "emit_kind_notify"
          Ask => "emit_kind_ask"
          SendAt => "emit_kind_send_at"
          Reply => "emit_kind_reply"
          Make => continue
        }
        items.push("emit_spec_new(\{kind}, \{self.s(e.name)})")
      }
      b.array("emit_array", items)
    }
    None => "null"
  }
}

///|
/// The schemas of the answers to c's asks, which the runtime gives it as an
/// ask settles, each named as the ask with which answer it is: ok with the
/// answer, and error with the error and unhandled with nothing when c handles
/// them. Answers aren't messages: only the runtime makes one, so no message
/// passes for one. The runtime checks their arguments as any message's, so
/// the handlers decode what they're declared to get.
fn Gen::reply_schemas(
  self : Gen,
  b : Block,
  c : @check.ComponentM,
) -> Array[String] {
  let cw = c.name
  let out = []
  // What a reply's handler may emit is its ask's emits.
  let reply = (
    name : String,
    answer : String,
    params : Array[@check.FieldM],
    emits : Array[@check.EmitM]?,
  ) => {
    let args = self.field_schemas(b, params)
    "message_schema_set_answer(message_schema_new(\{self.s(name)}, \{args}, null, null, null, null, \{self.emit_array(b, emits)}), \{answer})"
  }
  fn param(name : String, ty : @check.Ty) -> @check.FieldM {
    {
      name,
      ty,
      norm: @check.Norm::new(),
      default: None,
      required: true,
      make: None,
      sync: Local,
      doc: None,
      span: c.span,
    }
  }
  for a in c.asks {
    let aw = a.name
    let ac = a.name
    out.push(
      reply(ac, "answer_ok", [param("value", a.result.unwrap_or(Any))], a.emits),
    )
    if self.has("\{cw}_reply_\{aw}_error") {
      out.push(reply(ac, "answer_error", [param("error", Any)], a.emits))
    }
    if self.has("\{cw}_reply_\{aw}_unhandled") {
      out.push(reply(ac, "answer_unhandled", [], a.emits))
    }
  }
  out
}

///|
fn Gen::schema_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = c.name
  let b = Block::new()
  let fields = b.array(
    "field_schema_array",
    c.fields.map(f => {
      let fs = self.field_schema(b, f)
      if c.publics.contains(f.name) {
        "field_schema_set_public(\{fs})"
      } else {
        fs
      }
    }),
  )
  let gets = self.field_schemas(b, c.gets)
  let messages = b.array(
    "message_schema_array",
    c.messages.map(m => self.message_schema(b, Some(c), m)) +
    self.reply_schemas(b, c),
  )
  let invariants = b.array(
    "invariant_array",
    c.invariants.map(i => {
      "invariant_new(\{self.s(i.name)}, \{cw}_inv_\{i.name})"
    }),
  )
  let interfaces = b.array("str_array", c.implements.map(i => self.s(i)))
  // A public field is a query too: no arguments, the field's type.
  let public_queries = c.publics
    .filter_map(name => c.field(name))
    .map(f => {
      let returns = self.field_schema(b, f)
      "message_schema_set_returns(message_schema_new(\{self.s(f.name)}, [field_schema_array|null; 0], null, null, null, null, null), \{returns})"
    })
  let queries = if c.queries.is_empty() && public_queries.is_empty() {
    None
  } else {
    Some(
      b.array(
        "message_schema_array",
        c.queries.map(q => self.query_schema(b, q)) + public_queries,
      ),
    )
  }
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
  if queries is Some(qs) {
    out.line("    component_schema_set_queries(schema, \{qs});")
  }
  out.line("    \{cw}_schema_made = schema;")
  out.line("    schema;")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::spec_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = c.name
  let b = Block::new()
  let page = c.views.filter(v => v.target is None)
  let names = b.array("str_array", page.map(v => self.s(v.name)))
  let views = b.array("view_array", page.map(v => "\{view_fn_name(cw, v)}()"))
  // The views for each render target, set on the spec after it's made.
  let targets : Array[String] = []
  for v in c.views {
    if v.target is Some(t) && !targets.contains(t) {
      targets.push(t)
    }
  }
  let renders = targets.map(t => {
    let of = c.views.filter(v => v.target == Some(t))
    let tnames = b.array("str_array", of.map(v => self.s(v.name)))
    let tviews = b.array("view_array", of.map(v => "\{view_fn_name(cw, v)}()"))
    "    spec_set_render(spec, \{self.s(t)}, \{tnames}, \{tviews});"
  })
  let loops = b.array(
    "loop_def_array",
    c.loops.map(l => {
      let lw = "\{cw}_loop_\{l.name}"
      let hook = (on : Bool, name : String) => {
        if on {
          "\{lw}_\{name}_t"
        } else {
          "null"
        }
      }
      let view = match l.view {
        Some(v) => self.s(v)
        None => "null"
      }
      "{loop_def| name: \{self.s(l.name)}, prepare: \{hook(l.prepare is Some(_), "prepare")}, iter: \{hook(l.iter, "iter")}, key: \{hook(l.key is Some(_), "key")}, filter: \{hook(l.filter, "filter")}, enrich: \{hook(l.enrich is Some(_), "enrich")}, view: \{view} }"
    }),
  )
  let scopes = b.array(
    "scope_def_array",
    c.scopes.map(s => {
      "{scope_def| name: \{self.s(s.name)}, bind: \{cw}_scope_\{s.name}_t }"
    }),
  )
  let pnames = b.array("str_array", c.provides.map(p => self.s(p.name)))
  let selectors = b.array(
    "selector_array",
    c.provides.map(p => {
      match p.key {
        None => "selector_field(\{self.s(p.field)})"
        Some(k) => "selector_seq_item(\{self.s(p.field)}, \{self.s(k)})"
      }
    }),
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
    "    let spec = spec_new(\{self.s(c.name)}, \{names}, \{views}, \{loops}, \{scopes}, \{pnames}, \{selectors});",
  )
  renders.each(l => out.line(l))
  out.line("    spec_set_schema(spec, \{cw}_schema());")
  if !c.metas.is_empty() {
    let mut meta = "map_empty()"
    for m in c.metas {
      meta = "map_assoc(\{meta}, \{self.s(m.uri)}, \{self.val(m.value)})"
    }
    out.line("    spec_set_meta(spec, \{meta});")
  }
  out.line("    \{cw}_spec_made = spec;")
  out.line("    spec;")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::view_fns(self : Gen, c : @check.ComponentM) -> String {
  let cw = c.name
  let out = Out::new()
  for v in c.views {
    let b = Block::new()
    let e = self.view(b, v.body)
    out.write(doc_lines(v.doc))
    out.line("fn \{view_fn_name(cw, v)}() -> &view {")
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
    m = "map_assoc(\{m}, \{self.s(f.name)}, \{self.encode(f.ty, "\{holder}.\{@check.wax(f.name)}")})"
  }
  m
}

///|
fn Gen::hooks(self : Gen, c : @check.ComponentM) -> String {
  let cw = c.name
  let st = "&\{cw}_state"
  let out = Out::new()
  for l in c.loops {
    let lw = "\{cw}_loop_\{l.name}"
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
        "fn \{lw}_enrich_t: loop_enrich_fn (instance: &eq, key: &value, item: &value, prepared: &value) -> &value {",
      )
      out.line(
        "    let b = \{lw}_enrich(instance as \{st}, key, item\{prepared});",
      )
      out.line("    \{self.binds_map(bs, "b")};")
      out.line("}")
      out.line("")
    }
  }
  for s in c.scopes {
    let sw = "\{cw}_scope_\{s.name}"
    out.line("fn \{sw}_t: scope_bind_fn (instance: &eq) -> &value {")
    out.line("    let b = \{sw}(instance as \{st});")
    out.line("    \{self.binds_map(s.binds, "b")};")
    out.line("}")
    out.line("")
  }
  out.to_string()
}

///|
fn Gen::init_fn(self : Gen, c : @check.ComponentM) -> String {
  let cw = c.name
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
  out.line("    let problem: js_string_opt = null;")
  for i, f in c.fields {
    let fw = "f_\{f.name}"
    let name = self.s(f.name)
    let missing = self.s("missing")
    let wrong = self.s("wrong type")
    let invalid = self.s("invalid")
    // What a field that falls back to its default takes, besides the issue.
    // A made default that can't be made fails init, saying where.
    let fallback = f.make.map(m => {
      [
        "let made = init_make_field(ctx, \{self.s(c.name)}, \{name}, \{self.s(m)});",
        "if !outcome_is_ok(made) {",
        "    return init_made_fail(issues, made);",
        "}",
        "\{fw} = outcome_value(made);",
      ]
    })
    let fall_back = (indent : String) => {
      if fallback is Some(ls) {
        for l in ls {
          out.line(indent + l)
        }
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
    .map(f => "\{@check.wax(f.name)}: f_\{f.name}")
    .join(", ")
  out.line("    let state = {\{cw}_state| \{entries} };")
  // The constraints that read the component, a key of another field
  // (key_of) or a check of it, hold against it once it has its fields.
  let reading = c.fields
    .mapi((i, f) => (i, f))
    .filter(p => !p.1.norm.key_of.is_empty())
  if !reading.is_empty() {
    out.line(
      "    let owner = component_new(\{cw}_spec(), state, \{cw}_vtable(), ctx.scope);",
    )
  }
  for p in reading {
    let (i, f) = p
    let fw = @check.wax(f.name)
    let name = self.s(f.name)
    let invalid = self.s("invalid")
    out.line(
      "    problem = constraints_problem((schema.fields[\{i}]!).constraints, \{self.encode(f.ty, "state.\{fw}")}, owner);",
    )
    out.line("    if !!problem {")
    if f.required {
      out.line("        return init_fail(issues, \{name}, \{invalid});")
    } else {
      out.line("        issues = init_issue(issues, \{name}, \{invalid});")
      let start = match f.make {
        Some(m) => {
          out.line(
            "        let made = init_make_field(ctx, \{self.s(c.name)}, \{name}, \{self.s(m)});",
          )
          out.line("        if !outcome_is_ok(made) {")
          out.line("            return init_made_fail(issues, made);")
          out.line("        }")
          "outcome_value(made)"
        }
        None => self.start_value(f)
      }
      out.line("        state = \{cw}_with_\{fw}(state, \{start});")
    }
    out.line("    }")
  }
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
  let cw = c.name
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
  // An ask's answer, named as the ask: by which answer it is. An answer
  // no handler takes is rejected as unknown, never given to a message's.
  out.line("    if m.answer != answer_none {")
  for a in c.asks {
    let aw = a.name
    let result = a.result.unwrap_or(Any)
    out.line("        if str_eq(m.name, \{self.s(a.name)}) {")
    // Without a handler, the ok answer is taken and changes nothing.
    out.line("            if m.answer == answer_ok {")
    if self.has("\{cw}_reply_\{aw}_ok") {
      out.line(
        "                return message_result_of(state, \{cw}_reply_\{aw}_ok(state, ctx, \{self.decode(result, "m.args[0]!")}));",
      )
    } else {
      out.line("                return message_result_of(state, state);")
    }
    out.line("            }")
    if self.has("\{cw}_reply_\{aw}_error") {
      out.line("            if m.answer == answer_error {")
      out.line(
        "                return message_result_of(state, \{cw}_reply_\{aw}_error(state, ctx, m.args[0]!));",
      )
      out.line("            }")
    }
    if self.has("\{cw}_reply_\{aw}_unhandled") {
      out.line("            if m.answer == answer_unhandled {")
      out.line(
        "                return message_result_of(state, \{cw}_reply_\{aw}_unhandled(state, ctx));",
      )
      out.line("            }")
    }
    out.line("        }")
  }
  out.line(
    "        return message_result_rejected(message_error_unknown_message());",
  )
  out.line("    }")
  for msg in c.messages {
    let args = msg.params
      .mapi((i, p) => ", \{self.decode(p.ty, "m.args[\{i}]!")}")
      .join("")
    // A pure handler takes no context.
    let ctx = if msg.pure_ { "" } else { ", ctx" }
    let call = "\{cw}_on_\{msg.name}(state\{ctx}\{args})"
    out.line("    if str_eq(m.name, \{self.s(msg.name)}) {")
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
  out.line("    message_result_rejected(message_error_unknown_message());")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::get_set_fns(self : Gen, c : @check.ComponentM) -> String {
  let cw = c.name
  let out = Out::new()
  out.line(
    "fn \{cw}_vt_get: get_fn (instance: &eq, name: js_string) -> (i32, &?value) {",
  )
  out.line("    let state = instance as &\{cw}_state;")
  for f in c.fields {
    out.line("    if str_eq(name, \{self.s(f.name)}) {")
    out.line(
      "        return (property_ok, \{self.encode(f.ty, "state.\{@check.wax(f.name)}")});",
    )
    out.line("    }")
  }
  for g in c.gets {
    out.line("    if str_eq(name, \{self.s(g.name)}) {")
    out.line(
      "        return (property_ok, \{self.encode(g.ty, "\{cw}_get_\{g.name}(state)")});",
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
    "fn \{cw}_vt_set: set_fn (instance: &eq, name: js_string, v: &value) -> (i32, &?eq) {",
  )
  out.line("    let state = instance as &\{cw}_state;")
  if !c.fields.is_empty() {
    out.line("    let schema = \{cw}_schema();")
  }
  for i, f in c.fields {
    out.line("    if str_eq(name, \{self.s(f.name)}) {")
    out.line("        if !!vtype_problem((schema.fields[\{i}]!).vtype, v) {")
    out.line("            return (property_wrong_type, null);")
    out.line("        }")
    out.line(
      "        if !!constraints_problem((schema.fields[\{i}]!).constraints, v, null) {",
    )
    out.line("            return (property_invalid, null);")
    out.line("        }")
    out.line(
      "        return (property_ok, \{cw}_with_\{f.name}(state, \{self.decode(f.ty, "v")}));",
    )
    out.line("    }")
  }
  for g in c.gets {
    out.line("    if str_eq(name, \{self.s(g.name)}) {")
    out.line("        return (property_not_writable, null);")
    out.line("    }")
  }
  out.line("    (property_no_such_property, null);")
  out.line("}")
  out.line("")
  let query = if c.queries.is_empty() && c.publics.is_empty() {
    "null"
  } else {
    out.line(
      "// query: runs a query; the runtime checked args against its schema.",
    )
    out.line(
      "fn \{cw}_vt_query: query_fn (instance: &eq, name: js_string, args: &value_array) -> (i32, &?value) {",
    )
    out.line("    let state = instance as &\{cw}_state;")
    for q in c.queries {
      let args = q.params
        .mapi((i, p) => ", \{self.decode(p.ty, "args[\{i}]!")}")
        .join("")
      let call = "\{cw}_query_\{q.name}(state\{args})"
      out.line("    if str_eq(name, \{self.s(q.name)}) {")
      out.line(
        "        return (property_ok, \{self.encode(q.result.unwrap_or(Any), call)});",
      )
      out.line("    }")
    }
    for name in c.publics {
      guard c.field(name) is Some(f) else { continue }
      out.line("    if str_eq(name, \{self.s(name)}) {")
      out.line(
        "        return (property_ok, \{self.encode(f.ty, "state.\{@check.wax(name)}")});",
      )
      out.line("    }")
    }
    out.line("    (property_no_such_property, null);")
    out.line("}")
    out.line("")
    "\{cw}_vt_query"
  }
  out.line("fn \{cw}_vtable() -> &vtable {")
  out.line(
    "    {vtable| init: \{cw}_vt_init, handle: \{cw}_vt_handle, get: \{cw}_vt_get, set: \{cw}_vt_set, query: \{query} };",
  )
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::interface_fn(self : Gen, i : @check.InterfaceM) -> String {
  let iw = i.name
  let b = Block::new()
  let fields = self.field_schemas(b, i.fields)
  let gets = self.field_schemas(b, i.gets)
  let messages = b.array(
    "message_schema_array",
    i.messages.map(m => self.message_schema(b, None, m)),
  )
  let out = Out::new()
  out.write(doc_lines(i.doc))
  let queries = if i.queries.is_empty() {
    None
  } else {
    Some(
      b.array(
        "message_schema_array",
        i.queries.map(q => self.query_schema(b, q)),
      ),
    )
  }
  let notifies = if i.notifies.is_empty() {
    None
  } else {
    Some(
      b.array(
        "message_schema_array",
        i.notifies.map(n => {
          let args = self.field_schemas(b, n.params)
          "message_schema_new(\{self.s(n.name)}, \{args}, null, null, null, null, null)"
        }),
      ),
    )
  }
  out.line("fn \{iw}_interface() -> &interface_schema {")
  out.line(b.render("    "))
  out.line(
    "    let iface = interface_schema_new(\{self.s(i.name)}, \{fields}, \{gets}, \{messages});",
  )
  if queries is Some(qs) {
    out.line("    interface_schema_set_queries(iface, \{qs});")
  }
  if notifies is Some(ns) {
    out.line("    interface_schema_set_notifies(iface, \{ns});")
  }
  out.line("    iface;")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::meta_schema_fn(self : Gen, m : @check.MetaSchemaM) -> String {
  let mw = m.name
  let b = Block::new()
  let fields = self.field_schemas(b, m.fields)
  let mut defaults = "map_empty()"
  for f in m.fields {
    let v = match f.default {
      Some(v) => Some(v)
      None => if f.required { None } else { @check.field_default(f.ty, f.norm) }
    }
    if v is Some(v) {
      defaults = "map_assoc(\{defaults}, \{self.s(f.name)}, \{self.val(v)})"
    }
  }
  let out = Out::new()
  out.write(doc_lines(m.doc))
  out.line("fn \{mw}_meta_schema() -> &meta_schema {")
  out.line(b.render("    "))
  out.line("    meta_schema_new(\{self.s(m.uri)}, \{fields}, \{defaults});")
  out.line("}")
  out.line("")
  out.to_string()
}

///|
fn Gen::answer_fn(self : Gen, a : @check.SignalM) -> String {
  let pw = self.pkg.name
  let aw = a.name
  let b = Block::new()
  let checks = a.params.mapi((i, p) => {
    let vt = self.vtype(b, p.ty)
    "        if !!vtype_problem(\{vt}, args[\{i}]!) {\n            return ask_result_reply(outcome_err(value_string(\{self.s("wrong type")})));\n        }"
  })
  let args = a.params
    .mapi((i, p) => ", \{self.decode(p.ty, "args[\{i}]!")}")
    .join("")
  let out = Out::new()
  out.line(
    "fn \{pw}_answer_\{aw}_t: ask_fn (name: js_string, args: &value_array, ctx: &context) -> &ask_result {",
  )
  out.line("    if args.length() != \{a.params.length()} {")
  out.line(
    "        return ask_result_reply(outcome_err(value_string(\{self.s("wrong arity")})));",
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
  for m in self.pkg.meta_schemas {
    if m.declared_here {
      out.write(self.meta_schema_fn(m))
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
      out.line("    scope_register_interface(s, \{i.name}_interface());")
    }
  }
  for m in self.pkg.meta_schemas {
    if m.declared_here {
      out.line("    scope_register_meta_schema(s, \{m.name}_meta_schema());")
    }
  }
  for r in self.pkg.registers {
    let cw = r.component
    out.line(
      "    scope_register(s, \{self.s(r.as_)}, \{cw}_spec(), \{cw}_vtable());",
    )
  }
  for a in self.pkg.ask_handlers {
    out.line(
      "    scope_register_ask(s, \{self.s(a.name)}, \{self.pkg.name}_answer_\{a.name}_t);",
    )
  }
  for h in self.pkg.host_asks {
    out.line("    scope_register_host_ask(s, \{self.s(h)});")
  }
  out.line("}")
  out.line("")
  out.to_string()
}

///|
/// A query's schema: its arguments, and what it returns when it says.
fn Gen::query_schema(self : Gen, b : Block, q : @check.SignalM) -> String {
  let args = self.field_schemas(b, q.params)
  let ms = "message_schema_new(\{self.s(q.name)}, \{args}, null, null, null, null, null)"
  match q.result {
    None => ms
    Some(t) => {
      let returns = self.field_schema(b, {
        name: "returns",
        ty: t,
        norm: @check.Norm::new(),
        default: None,
        required: true,
        make: None,
        sync: Local,
        doc: None,
        span: q.span,
      })
      "message_schema_set_returns(\{ms}, \{returns})"
    }
  }
}

///|
/// The function that builds view v of component cw: cw_view_name, or for a
/// render target's, cw_view_target_name.
fn view_fn_name(cw : String, v : @check.ViewM) -> String {
  match v.target {
    None => "\{cw}_view_\{v.name}"
    Some(t) => "\{cw}_view_\{t}_\{v.name}"
  }
}

///|
/// The codes a TCD source reports.
fn codes_of(src : String) -> Array[String] {
  let (f, parse_diags) = @syntax.parse("t.tcd", src)
  let (_, diags) = @check.check(f, Map([]))
  let all = parse_diags.copy()
  all.append(diags)
  all.map(d => d.code)
}

///|
/// One fixture per diagnostic code: a minimal source that reports it.
test "every diagnostic code has a fixture that reports it" {
  let fixtures : Array[(String, String)] = [
    ("tcd.syntax.expected", "component C { field x s32; view main = p(); }"),
    ("tcd.syntax.unterminated_string", "component C { view main = p(\"x); }"),
    ("tcd.syntax.character", "component C { view main = p(); } #"),
    (
      "tcd.syntax.emit", "component C { message m() emits shout x; view main = p(); }",
    ),
    ("tcd.syntax.loop_hook", "component C { loop l { nope } view main = p(); }"),
    (
      "tcd.view.attr_after_child", "component C { view main = p(\"a\", class: \"b\"); }",
    ),
    ("tcd.name.case", "component c { view main = p(); }"),
    (
      "tcd.name.duplicate", "component C { field x: s32; field x: s32; view main = p(); }",
    ),
    ("tcd.type.unknown", "component C { field x: nope; view main = p(); }"),
    (
      "tcd.type.arity", "component C { field x: list<s32, s32>; view main = p(); }",
    ),
    (
      "tcd.type.index", "component C { field n: s32; message m(k: index<n>); view main = p(); }",
    ),
    (
      "tcd.where.contradiction", "component C { field x: s32 where x > 1 and x < 0; view main = p(); }",
    ),
    (
      "tcd.type.option", "component C { field x: one_of<null, s32>; view main = p(); }",
    ),
    (
      "tcd.where.redundant", "component C { field x: s32 where x > 1 and x > 2; view main = p(); }",
    ),
    (
      "tcd.where.not_a_constraint", "component C { field x: s32 where x > 1 or x < 0; view main = p(); }",
    ),
    (
      "tcd.where.type", "component C { field x: bool where x > 1; view main = p(); }",
    ),
    (
      "tcd.where.unknown_field", "component C { field x: s32 where x in keys(nope); view main = p(); }",
    ),
    (
      "tcd.field.default", "component C { field x: s32 = \"a\"; view main = p(); }",
    ),
    (
      "tcd.field.required", "component C { field x: string where len(x) >= 1; view main = p(); }",
    ),
    (
      "tcd.field.make", "component C { field x: s32 = make(C); view main = p(); }",
    ),
    (
      "tcd.field.sync", "component C { field x: s32 @sync(cloud); view main = p(); }",
    ),
    (
      "tcd.message.changes", "component C { message m() changes nope; view main = p(); }",
    ),
    (
      "tcd.message.swap", "component C { field x: s32; message m() -> swap ensures next.x == 1; view main = p(); }",
    ),
    (
      "tcd.message.never", "component C { field x: s32 where x < 0; message m() when x > 5; view main = p(); }",
    ),
    (
      "tcd.message.ensures_changes", "component C { field x: s32; message m() changes nothing ensures next.x == 1; view main = p(); }",
    ),
    ("tcd.cond.type", "component C { message m() when nope; view main = p(); }"),
    (
      "tcd.emits.notify", "component C { message m() emits notify gone; view main = p(); }",
    ),
    (
      "tcd.emits.ask", "component C { message m() emits ask gone; view main = p(); }",
    ),
    (
      "tcd.emits.send", "component C { message m() emits send nope.m; view main = p(); }",
    ),
    (
      "tcd.emits.make", "component C { message m() emits make nope; view main = p(); }",
    ),
    (
      "tcd.invariant.initial", "component C { field x: s32; invariant big: x > 5; view main = p(); }",
    ),
    ("tcd.interface.unknown", "component C: nope { view main = p(); }"),
    (
      "tcd.interface.missing", "interface I { field x: s32; } component C: I { view main = p(); }",
    ),
    (
      "tcd.interface.type", "interface I { field x: s32; } component C: I { field x: bool; view main = p(); }",
    ),
    ("tcd.interface.member", "interface I { view main = p(); }"),
    (
      "tcd.provide.field", "component C { provide t = field(nope); view main = p(); }",
    ),
    ("tcd.provide.source", "component C { provide t = p(); view main = p(); }"),
    ("tcd.register.unknown", "component C { view main = p(); } register nope;"),
    (
      "tcd.register.duplicate", "package a:b@1; component C { view main = p(); } component D { view main = p(); } register C, D as C;",
    ),
    (
      "tcd.example.component", "component C { view main = p(); } example e for nope { }",
    ),
    (
      "tcd.example.field", "component C { view main = p(); } example e for C { start { nope: 1 } }",
    ),
    (
      "tcd.example.value", "component C { field x: s32; view main = p(); } example e for C { start { x: \"a\" } }",
    ),
    (
      "tcd.example.message", "component C { view main = p(); } example e for C { send nope(); }",
    ),
    (
      "tcd.example.arity", "component C { message m(); view main = p(); } example e for C { send m(1); }",
    ),
    ("tcd.view.main", "component C { view other = p(); }"),
    ("tcd.view.field", "component C { view main = p(field(nope)); }"),
    ("tcd.view.bind", "component C { view main = p(bind(nope)); }"),
    ("tcd.view.name", "component C { view main = p(field(\"x\")); }"),
    (
      "tcd.view.option", "component C { field x: s32; view main = p(field(color: \"x\", x)); }",
    ),
    ("tcd.view.arity", "component C { view main = p(field()); }"),
    ("tcd.view.attr_value", "component C { view main = p(title: p()); }"),
    (
      "tcd.view.send_arg", "component C { field x: s32; message m(n: s32); view main = p(on_click: send(m, \"a\")); }",
    ),
    (
      "tcd.view.event", "component C { message m(); view main = p(\"on_click+sideways\": send(m)); }",
    ),
    ("tcd.view.handler", "component C { view main = p(on_click: \"x\"); }"),
    ("tcd.view.message", "component C { view main = p(on_click: send(nope)); }"),
    (
      "tcd.view.send_arity", "component C { message m(); view main = p(on_click: send(m, 1)); }",
    ),
    (
      "tcd.view.namespace", "component C { field x: string; view main = g(namespace: field(x)); }",
    ),
    (
      "tcd.view.class", "component C { field x: string; view main = p(class: field(x)); }",
    ),
    ("tcd.view.source", "component C { view main = p(render(\"x\")); }"),
    (
      "tcd.view.render", "component C { field x: s32; view main = p(render(field(x))); }",
    ),
    (
      "tcd.view.view_name", "component C { field x: C; view main = p(render(view: nope, field(x))); }",
    ),
    (
      "tcd.view.loop", "component C { field xs: list<s32>; view main = p(each(loop: nope, field(xs), \"a\")); }",
    ),
    (
      "tcd.view.each", "component C { field x: s32; view main = p(each(field(x), \"a\")); }",
    ),
    ("tcd.view.render_it", "component C { view main = p(render_it()); }"),
    ("tcd.view.scope", "component C { view main = p(scope(nope, \"a\")); }"),
    (
      "tcd.view.not_renderable", "component C { view main = p(target_value()); }",
    ),
    ("tcd.view.el", "component C { view main = el(1); }"),
    ("tcd.view.bare_name", "component C { view main = p(x); }"),
    ("tcd.view.provided", "component C { view main = p(provided(nope)); }"),
    (
      "tcd.view.seq_item", "component C { field x: s32; field k: s32; view main = p(seq_item(x, k)); }",
    ),
  ]
  let missing = []
  for f in fixtures {
    if !codes_of(f.1).contains(f.0) {
      missing.push("\{f.0}: \{codes_of(f.1).join(", ")}")
    }
  }
  debug_inspect(missing, content="[]")
}

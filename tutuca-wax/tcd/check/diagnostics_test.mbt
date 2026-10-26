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
    ("tcd.syntax.expected", "component c { field x s32; view main = p(); }"),
    ("tcd.syntax.unterminated_string", "component c { view main = p(\"x); }"),
    ("tcd.syntax.character", "component c { view main = p(); } #"),
    (
      "tcd.syntax.emit", "component c { message m() emits shout x; view main = p(); }",
    ),
    ("tcd.syntax.loop_hook", "component c { loop l { nope } view main = p(); }"),
    (
      "tcd.view.attr_after_child", "component c { view main = p(\"a\", class: \"b\"); }",
    ),
    ("tcd.name.case", "component C { view main = p(); }"),
    (
      "tcd.name.duplicate", "component c { field x: s32; field x: s32; view main = p(); }",
    ),
    ("tcd.type.unknown", "component c { field x: nope; view main = p(); }"),
    (
      "tcd.type.arity", "component c { field x: list<s32, s32>; view main = p(); }",
    ),
    (
      "tcd.type.index", "component c { field n: s32; message m(k: index<n>); view main = p(); }",
    ),
    (
      "tcd.where.contradiction", "component c { field x: s32 where x > 1 and x < 0; view main = p(); }",
    ),
    (
      "tcd.where.redundant", "component c { field x: s32 where x > 1 and x > 2; view main = p(); }",
    ),
    (
      "tcd.where.not_a_constraint", "component c { field x: s32 where x > 1 or x < 0; view main = p(); }",
    ),
    (
      "tcd.where.type", "component c { field x: bool where x > 1; view main = p(); }",
    ),
    (
      "tcd.where.unknown_field", "component c { field x: s32 where x in keys(nope); view main = p(); }",
    ),
    (
      "tcd.field.default", "component c { field x: s32 = \"a\"; view main = p(); }",
    ),
    (
      "tcd.field.required", "component c { field x: string where len(x) >= 1; view main = p(); }",
    ),
    (
      "tcd.field.sync", "component c { field x: s32 @sync(cloud); view main = p(); }",
    ),
    (
      "tcd.message.changes", "component c { message m() changes nope; view main = p(); }",
    ),
    (
      "tcd.message.swap", "component c { message m() -> swap changes nothing; view main = p(); }",
    ),
    (
      "tcd.message.never", "component c { field x: s32 where x < 0; message m() when x > 5; view main = p(); }",
    ),
    (
      "tcd.message.ensures_changes", "component c { field x: s32; message m() changes nothing ensures next.x == 1; view main = p(); }",
    ),
    ("tcd.cond.type", "component c { message m() when nope; view main = p(); }"),
    (
      "tcd.emits.notify", "component c { message m() emits notify gone; view main = p(); }",
    ),
    (
      "tcd.emits.ask", "component c { message m() emits ask gone; view main = p(); }",
    ),
    (
      "tcd.emits.send", "component c { message m() emits send nope.m; view main = p(); }",
    ),
    (
      "tcd.emits.make", "component c { message m() emits make nope; view main = p(); }",
    ),
    (
      "tcd.invariant.initial", "component c { field x: s32; invariant big: x > 5; view main = p(); }",
    ),
    ("tcd.interface.unknown", "component c: nope { view main = p(); }"),
    (
      "tcd.interface.missing", "interface i { field x: s32; } component c: i { view main = p(); }",
    ),
    (
      "tcd.interface.type", "interface i { field x: s32; } component c: i { field x: bool; view main = p(); }",
    ),
    ("tcd.interface.member", "interface i { view main = p(); }"),
    (
      "tcd.provide.field", "component c { provide t = field(nope); view main = p(); }",
    ),
    ("tcd.provide.source", "component c { provide t = p(); view main = p(); }"),
    ("tcd.register.unknown", "component c { view main = p(); } register nope;"),
    (
      "tcd.register.duplicate", "package a:b@1; component c { view main = p(); } component d { view main = p(); } register c, d as c;",
    ),
    (
      "tcd.example.component", "component c { view main = p(); } example e for nope { }",
    ),
    (
      "tcd.example.field", "component c { view main = p(); } example e for c { start { nope: 1 } }",
    ),
    (
      "tcd.example.value", "component c { field x: s32; view main = p(); } example e for c { start { x: \"a\" } }",
    ),
    (
      "tcd.example.message", "component c { view main = p(); } example e for c { send nope(); }",
    ),
    (
      "tcd.example.arity", "component c { message m(); view main = p(); } example e for c { send m(1); }",
    ),
    ("tcd.view.main", "component c { view other = p(); }"),
    ("tcd.view.field", "component c { view main = p(field(nope)); }"),
    ("tcd.view.bind", "component c { view main = p(bind(nope)); }"),
    ("tcd.view.name", "component c { view main = p(field(\"x\")); }"),
    (
      "tcd.view.option", "component c { field x: s32; view main = p(field(color: \"x\", x)); }",
    ),
    ("tcd.view.arity", "component c { view main = p(field()); }"),
    ("tcd.view.attr_value", "component c { view main = p(title: p()); }"),
    (
      "tcd.view.send_arg", "component c { field x: s32; message m(n: s32); view main = p(on_click: send(m, \"a\")); }",
    ),
    (
      "tcd.view.event", "component c { message m(); view main = p(\"on_click+sideways\": send(m)); }",
    ),
    ("tcd.view.handler", "component c { view main = p(on_click: \"x\"); }"),
    ("tcd.view.message", "component c { view main = p(on_click: send(nope)); }"),
    (
      "tcd.view.send_arity", "component c { message m(); view main = p(on_click: send(m, 1)); }",
    ),
    (
      "tcd.view.static_value", "component c { view main = input(value: \"x\"); }",
    ),
    (
      "tcd.view.class", "component c { field x: string; view main = p(class: field(x)); }",
    ),
    ("tcd.view.source", "component c { view main = p(render(\"x\")); }"),
    (
      "tcd.view.render", "component c { field x: s32; view main = p(render(field(x))); }",
    ),
    (
      "tcd.view.view_name", "component c { field x: c; view main = p(render(view: nope, field(x))); }",
    ),
    (
      "tcd.view.loop", "component c { field xs: list<s32>; view main = p(each(loop: nope, field(xs), \"a\")); }",
    ),
    (
      "tcd.view.each", "component c { field x: s32; view main = p(each(field(x), \"a\")); }",
    ),
    ("tcd.view.render_it", "component c { view main = p(render_it()); }"),
    ("tcd.view.scope", "component c { view main = p(scope(nope, \"a\")); }"),
    (
      "tcd.view.not_renderable", "component c { view main = p(target_value()); }",
    ),
    ("tcd.view.el", "component c { view main = el(1); }"),
    ("tcd.view.bare_name", "component c { view main = p(x); }"),
    ("tcd.view.provided", "component c { view main = p(provided(nope)); }"),
    (
      "tcd.view.seq_item", "component c { field x: s32; field k: s32; view main = p(seq_item(x, k)); }",
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

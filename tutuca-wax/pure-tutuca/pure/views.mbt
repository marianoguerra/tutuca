// What a pure-tutuca view can't say: what tutuca's lint rejects in its views
// too, so a module means the same in tutuca and in tutuca-wax.

///|
/// The view constructors that read the state: tutuca works out a send's
/// arguments from the event alone (sourceKey(), targetValue(), dragKey(),
/// eventKey(), eventProperty(name)), with no state to read, so it rejects
/// these as send arguments (its lint's state-in-action).
let state_readers : Array[String] = ["field", "seqItem", "provided", "query"]

///|
/// The problems of a checked module's views: a send argument that reads the
/// state, as pure-tutuca.state-in-send.
pub fn view_problems(
  path : String,
  src : String,
  checked : Checked,
) -> Array[@diag.Diagnostic] {
  let out = []
  fn in_send(e : @ast.Expr) -> Unit {
    match e {
      Call(callee=Ident(f), span~, ..) if state_readers.contains(f.name) =>
        out.push(
          @diag.error(
            "pure-tutuca.state-in-send",
            span_of(path, src, span),
            "\{f.name}(...) can't be a send argument: tutuca works one out from the event alone; send sourceKey(), targetValue(), dragKey(), eventKey() or eventProperty(name), and read the state in the handler",
          ),
        )
      Call(args~, ..) => args.each(in_send)
      _ => ()
    }
  }
  fn walk(e : @ast.Expr) -> Unit {
    match e {
      Call(callee=Ident(f), args~, ..) if f.name == "send" =>
        for a in args[1:] {
          in_send(a)
        }
      Call(args~, ..) => args.each(walk)
      ObjectLit(ms, ..) =>
        for m in ms {
          match m {
            Prop(value~, ..) => walk(value)
            SpreadMember(x, ..) => walk(x)
            Method(..) => ()
          }
        }
      ArrayLit(es, ..) =>
        for x in es {
          if x is Some(x) {
            walk(x)
          }
        }
      Cond(cons~, alt~, ..) => {
        walk(cons)
        walk(alt)
      }
      Logical(left~, right~, ..) => {
        walk(left)
        walk(right)
      }
      Spread(x, ..) | Chain(x, ..) => walk(x)
      _ => ()
    }
  }
  for c in components_of(checked.decls) {
    match value_of(c.literal, "view") {
      Some(v) => walk(v)
      None => ()
    }
    match value_of(c.literal, "views") {
      Some(vs) => walk(vs)
      None => ()
    }
  }
  out
}

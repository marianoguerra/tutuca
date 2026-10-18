// The host, tasks and messaging, end to end on memdom.

///|
struct Counter {
  count : Int32
}

///|
enum CounterMsg {
  Inc
  Fail
} derive(Debug)

///|
suberror Boom {
  Boom
}

///|
let bumped : Signal[Int32] = Signal::new("bumped")

///|
let counter : Component[Counter, CounterMsg] = component(
  "Counter",
  view=() => {
    button([on_click(Inc)], [txt("Clicked "), show(s => s.count.to_string())])
  },
  update=(s, msg, ctx) => {
    match msg {
      Inc => {
        ctx.notify(bumped, s.count + 1)
        { count: s.count + 1, }
      }
      Fail => raise Boom
    }
  },
  invariants=[("count is small", s => s.count < 3)],
  post=(msg, prev, next) => {
    match msg {
      Inc => next.count == prev.count + 1
      Fail => true
    }
  },
)

///|
test "a click runs the handler and re-renders" {
  let (host, app, root, _) = mount(counter, { count: 0, })
  inspect(
    root.inner_html(),
    content=(
      #|<!--§{"t":"component","n":"Counter","p":"·"}§--><button type="button" data-h="·#1">Clicked 0</button><!--§/§-->
    ),
  )
  click(host, root, "button")
  inspect(app.state().count, content="1")
  inspect(root.find("button").unwrap().text_content(), content="Clicked 1")
}

///|
test "a handler that raises rolls back and drops what it queued" {
  let (host, app, _, reports) = mount(counter, { count: 1, })
  app.send(Fail)
  host.drain()
  inspect(app.state().count, content="1")
  assert_eq(reports.map(report_text), [
    "failed Counter.Fail: marianoguerra/tutuca.Boom.Boom",
  ])
}

///|
test "dev mode reports invariants once the queue is empty" {
  let (host, app, _, reports) = mount(counter, { count: 2, })
  app.send(Inc)
  host.drain()
  assert_eq(reports.map(report_text), [
    "invalid Counter at ·: invariant `count is small` does not hold",
  ])
}

// --- a list of counters: notify, from, send_to, provides -------------------------------

///|
struct Board {
  counters : Vec[Counter]
  log : Array[String]
  selected : Int32
  label : String
}

///|
enum BoardMsg {
  Select(Int32)
  BumpSelected
  Asked(AskResult[String])
} derive(Debug)

///|
let counters : Items[Board, Int32, Counter] = items(
  "counters",
  b => b.counters,
  (b, v) => { ..b, counters: v, },
)

///|
let board_label : Provide[String] = Provide::new("label")

///|
let today : Ask[Unit, String] = Ask::new("today")

///|
let board : Component[Board, BoardMsg] = component(
  "Board",
  view=() => {
    div([], [
      render_each(counters, counter),
      span([], [show(s => s.log.join(","))]),
    ])
  },
  update=(s, msg, ctx) => {
    match msg {
      Select(i) => { ..s, selected: i, }
      BumpSelected => {
        ctx.send_to(counter, b => counters.at(b.selected), Inc)
        { ..s, selected: s.selected, }
      }
      Asked(result) => {
        let text = match result {
          Ok(v) => "ok \{v}"
          Err(e) => "err \{e}"
          NotFound => "not found"
        }
        { ..s, log: [..s.log, text], }
      }
    }
  },
  on=[
    bumped.from(counters, (s, n, i, _) => { ..s, log: [..s.log, "\{i}:\{n}"], }),
  ],
  provides=[
    board_label.from(field("label", b => b.label, (b, l) => { ..b, label: l, })),
  ],
)

///|
fn new_board() -> Board {
  {
    counters: Vec::of([{ count: 0, }, { count: 0, }]),
    log: [],
    selected: 1,
    label: "L",
  }
}

///|
test "a notify reaches the listening ancestor with the typed key" {
  let (host, app, root, _) = mount(board, new_board(), dev=false)
  click(host, root, "button")
  assert_eq(app.state().log, ["0:1"])
  inspect(root.find("span").unwrap().text_content(), content="0:1")
}

///|
test "send_to freezes its selector against the committed state" {
  let (host, app, _, _) = mount(board, new_board(), dev=false)
  app.send(BumpSelected)
  host.drain()
  assert_eq(app.state().counters.map(c => c.count).to_array(), [0, 1])
  assert_eq(app.state().log, ["1:1"])
}

///|
/// Asks `today` on Select; logs the answer.
let asker : Component[Board, BoardMsg] = component(
  "Asker",
  view=() => empty(),
  update=(s, msg, ctx) => {
    match msg {
      Select(_) => {
        ctx.ask(today, (), r => Some(Asked(r)))
        s
      }
      Asked(result) => {
        let text = match result {
          Ok(v) => "ok \{v}"
          Err(e) => "err \{e}"
          NotFound => "not found"
        }
        { ..s, log: [..s.log, text], }
      }
      BumpSelected => s
    }
  },
)

///|
fn ask_once(scope : Scope) -> (Host[@memdom.MemNode], App[Board, BoardMsg]) {
  let (host, app, _, _) = mount(asker, new_board(), dev=false, scope~)
  app.send(Select(0))
  host.drain()
  (host, app)
}

///|
test "asks resolve through the scope: missing, sync, later" {
  let scope = Scope::new()
  let (_, missing) = ask_once(scope)
  assert_eq(missing.state().log, ["not found"])
  scope.answer(today, _ => "2026-10-18")
  let (_, sync) = ask_once(scope)
  assert_eq(sync.state().log, ["ok 2026-10-18"])
  // A child scope shadows its parent; this handler replies later.
  let later : Ref[((AskResult[String]) -> Unit)?] = Ref(None)
  let inner = scope.enter()
  inner.handle(today, (_, reply) => later.val = Some(reply))
  let (host, app) = ask_once(inner)
  assert_eq(app.state().log, [])
  later.val.unwrap()(Err("offline"))
  host.drain()
  assert_eq(app.state().log, ["err offline"])
}

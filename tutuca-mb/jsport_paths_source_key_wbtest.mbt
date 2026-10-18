// Port of test/paths/source-key.test.js. JS's `ctx.sourceKey` is, in MoonBit, the key a
// `Signal::from` listener gets (for notifies) and the loop item a handler's message reads
// (for events); a component's own messages, sends and replies carry no key.

///|
struct SkLeaf {
  clicks : Int32
} derive(Debug)

///|
enum SkLeafMsg {
  Click
  Loaded(AskResult[String])
} derive(Debug)

///|
struct SkRow {
  cells : Vec[SkLeaf]
}

///|
struct SkMid {
  rows : Vec[SkRow]
}

///|
enum SkMidMsg {
  Ping
} derive(Debug)

///|
struct SkTop {
  mids : Vec[SkMid]
}

///|
let sk_ping : Signal[Unit] = Signal::new("ping")

///|
let sk_load : Ask[Unit, String] = Ask::new("load")

///|
test "sourceKey is relative to the receiver for events, notifies, sends and replies" {
  let seen : Array[(String, String)] = []
  let record = (who : String, key : Int32?) => {
    seen.push((who, key.map(k => k.to_string()).unwrap_or("null")))
  }
  let leaf : Component[SkLeaf, SkLeafMsg] = component(
    "Leaf",
    view=() => button([on_click(Click)], []),
    update=(s, msg, ctx) => {
      match msg {
        Click => {
          record("leaf click", None)
          ctx.notify(sk_ping, ())
          ctx.ask(sk_load, (), r => Some(Loaded(r)))
        }
        Loaded(_) => record("leaf reply", None)
      }
      s
    },
  )
  let rows : Items[SkMid, Int32, SkRow] = items("rows", m => m.rows, (_, rows) => {
    rows,
  })
  let cells : Items[SkRow, Int32, SkLeaf] = items("cells", r => r.cells, (
    _,
    cells,
  ) => { cells, })
  // The cells of every row: each(rows, each(cells, renderIt())).
  let row_cells = rows.then(cells)
  let mid : Component[SkMid, SkMidMsg] = component(
    "Mid",
    view=() => {
      div([], [
        each(
          m => m.rows.iter(),
          p([], [
            each(
              it => it.value.cells.iter(),
              render_key(row_cells, it => (it.up.index, it.index), leaf),
            ),
          ]),
        ),
      ])
    },
    update=(s, _, _) => {
      record("mid notify", None)
      s
    },
    on=[
      sk_ping.from(row_cells, (s, _, key, _) => {
        record("mid notify", Some(key.1))
        s
      }),
    ],
  )
  let mids : Items[SkTop, Int32, SkMid] = items("mids", t => t.mids, (_, mids) => {
    mids,
  })
  let top : Component[SkTop, SkMidMsg] = component(
    "Top",
    view=() => div([], [render_each(mids, mid)]),
    on=[
      sk_ping.from(mids, (s, _, key, ctx) => {
        record("top notify", Some(key))
        ctx.send_to(mid, _ => mids.at(1), Ping)
        s
      }),
    ],
  )
  let scope = Scope::new()
  scope.answer(sk_load, _ => "loaded")
  let leaves = (n : Int32) => {
    Vec::from_iter(Iter::repeat({ clicks: 0, }).take(n))
  }
  let (host, _, root, reports) = jp_mount(
    top,
    {
      mids: Vec::of([
        { rows: Vec::new(), },
        { rows: Vec::of([{ cells: leaves(0), }, { cells: leaves(3), }]), },
      ]),
    },
    scope~,
  )
  jp_click(host, jp_elems(root, "button")[2])
  assert_eq(jp_failures(reports), [])
  assert_eq(seen, [
    ("leaf click", "null"),
    ("mid notify", "2"),
    ("leaf reply", "null"),
    ("top notify", "1"),
    ("mid notify", "null"),
  ])
}

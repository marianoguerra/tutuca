///|
struct Tally {
  count : Int32
} derive(ToJson)

///|
enum TallyMsg {
  Up
  Down
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let tally : @tutuca.Component[Tally, TallyMsg] = @tutuca.component(
  "Tally",
  view=() => {
    @tutuca.button([@tutuca.on_click(Up)], [
      @tutuca.show(s => s.count.to_string()),
    ])
  },
  update=(s, msg, _) => {
    match msg {
      Up => { count: s.count + 1, }
      Down => { count: s.count - 1, }
    }
  },
  invariants=[("under three", s => s.count < 3)],
  messages=@tutuca.json_messages(["Up", "Down"]),
)

///|
fn tally_book() -> @storybook.Book[@memdom.MemNode] {
  @storybook.book("Tally", [
    @storybook.story(
      "Buggy",
      tally,
      () => { count: 0, },
      targets=[@testing.root_messages()],
      generate=(rs, _) => {
        count: rs.next_uint(limit=3).reinterpret_as_int() - 1,
      },
    ),
  ])
}

///|
fn mounted() -> @storybook.Registry[@memdom.MemNode] {
  let reg = @storybook.Registry::new([tally_book()])
  let doc = @memdom.document()
  reg.mount("Tally/Buggy", doc, doc.element("main"))
  reg
}

///|
test "a failed stress run is loadable as its shrunk counterexample" {
  let reg = mounted()
  let s = reg.call("Tally/Buggy", Stress(50, 30, 3, FromStory))
  let stress = s.stress.unwrap()
  assert_eq(stress.status, "failed")
  assert_eq(stress.steps, [
    "Tally at ·.up()", "Tally at ·.up()", "Tally at ·.up()",
  ])
  assert_true(s.sequences.contains("counterexample"))
  ignore(reg.call("Tally/Buggy", Load("counterexample")))
  let replayed = reg.call("Tally/Buggy", ToEnd)
  assert_eq(replayed.steps.map(st => st.status), ["ok", "ok", "failed"])
}

///|
test "stress runs can start from generated states" {
  let reg = mounted()
  let s = reg.call("Tally/Buggy", Stress(50, 30, 9, FromGenerated))
  assert_eq(s.stress.map(r => r.status), Some("failed"))
}

///|
test "the send form's message reaches the story" {
  let reg = mounted()
  let s = reg.call("Tally/Buggy", SendTo(0, "up", "[]", ""))
  assert_eq(s.state.stringify(), "{\"count\":1}")
  assert_eq(s.timeline.last().map(e => e.label), Some("Tally at ·.up()"))
  let bad = reg.call("Tally/Buggy", SendTo(0, "up", "nope", ""))
  assert_true(bad.error.contains("args must be a JSON array"))
  let unknown = reg.call("Tally/Buggy", SendTo(0, "sideways", "[]", ""))
  assert_true(unknown.error.contains("doesn't read"))
}

///|
test "stress runs in batches with progress, and can be cancelled" {
  let reg = @storybook.Registry::new([tally_book()])
  let doc = @memdom.document()
  let ticks : Array[() -> Unit] = []
  reg.mount("Tally/Buggy", doc, doc.element("main"), schedule=f => ticks.push(f))
  let changes = []
  reg.set_on_change(id => changes.push(id))
  let s = reg.call("Tally/Buggy", StressStart(40, 1, 3, FromStory))
  assert_eq(s.stress.map(r => (r.status, r.done)), Some(("running", 0)))
  // One batch per tick; one step per run can't break the invariant, so it runs them all.
  ticks.remove(0)()
  let s = reg.call("Tally/Buggy", Show)
  assert_eq(s.stress.map(r => (r.status, r.done)), Some(("running", 10)))
  let s = reg.call("Tally/Buggy", StressCancel)
  assert_eq(s.stress.map(r => (r.status, r.done)), Some(("cancelled", 10)))
  ticks.remove(0)()
  assert_eq(ticks.length(), 0)
  assert_eq(changes.length(), 2)
}

///|
test "the story list filters and folds" {
  let books = [
    tally_book(),
    @storybook.book("Other", [
      @storybook.story("Plain", tally, () => { count: 1, }),
    ]),
  ]
  let d = @testing.Driver::new(
    @storybook.storybook,
    @storybook.Storybook::of(books),
  )
  assert_true(d.text().contains("Buggy") && d.text().contains("Plain"))
  d.click("button", text="▾Tally1")
  assert_false(d.text().contains("Buggy"))
  d.type_into("input", "plai")
  assert_false(d.text().contains("Buggy"))
  assert_true(d.text().contains("Plain"))
  d.type_into("input", "bug")
  // A filter shows matches even in a folded group.
  assert_true(d.text().contains("Buggy"))
}

///|
test "a sampled story starts from its seed's state" {
  let gen = (rs : @splitmix.RandomState, _ : Int32) => {
    count: rs.next_uint(limit=100).reinterpret_as_int(),
  }
  assert_eq(
    @storybook.sampled(gen, seed=5)().count,
    @storybook.sampled(gen, seed=5)().count,
  )
}

///|
test "picking a story asks to scroll the panel back to its top" {
  let scope = @tutuca.Scope::new()
  let asked = Ref(0)
  scope.answer(@storybook.scroll_to_top, _ => asked.val += 1)
  let books = [tally_book()]
  let d = @testing.Driver::new(
    @storybook.storybook,
    @storybook.Storybook::of(books),
    scope~,
  )
  d.click("button", text="Buggy")
  assert_eq(asked.val, 1)
  assert_eq(d.state().selected, "Tally/Buggy")
}

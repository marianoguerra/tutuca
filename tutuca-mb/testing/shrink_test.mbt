///|
struct Tally {
  count : Int32
} derive(ToJson)

///|
enum TallyMsg {
  Up
  Down
  Noop
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let tally : @tutuca.Component[Tally, TallyMsg] = @tutuca.component(
  "Tally",
  view=() => @tutuca.show(s => s.count.to_string()),
  update=(s, msg, _) => {
    match msg {
      Up => { count: s.count + 1, }
      Down => { count: s.count - 1, }
      Noop => s
    }
  },
  invariants=[("under three", s => s.count < 3)],
)

///|
test "a breaking sequence shrinks to the messages that matter" {
  let failure = @testing.find_failure(
    tally,
    (_, _) => { count: 0, },
    [@testing.root_messages()],
    count=200,
    steps=40,
  )
  guard failure is Some(f) else { fail("expected the invariant to break") }
  assert_eq(f.steps.map(s => s.label), ["· Up", "· Up", "· Up"])
  assert_true(f.problem.contains("under three"))
}

///|
test "messages go out and come back as JSON" {
  let target : @testing.Target[Tally, TallyMsg] = @testing.root_messages()
  let text = ToJson::to_json(Up).stringify()
  let d = @testing.Driver::new(tally, { count: 0, })
  ((target.decode)(d.state(), text, "").send_app)(d.app)
  d.drain()
  assert_eq(d.state().count, 1)
  // A sample decodes back to a message.
  let sample = (target.sample)(@splitmix.RandomState(seed=7), 3)
  ignore((target.decode)(d.state(), sample, ""))
}

///|
struct Box {
  items : Array[Int32]
} derive(ToJson, Debug, @quickcheck.Arbitrary)

///|
let box : @tutuca.Component[Box, TallyMsg] = @tutuca.component(
  "Box",
  view=() => @tutuca.show(b => b.items.length().to_string()),
  update=(b, _, _) => b,
  // Broken on purpose: any state with a 7 breaks the view's assumptions.
  post=(_, _, next) => !next.items.contains(7),
)

///|
test "a failing state shrinks" {
  let failed = try {
    @testing.check_component(box, state=(_, _) => { items: [1, 7, 3, 4, 5], }, shrink=b => {
      @quickcheck.Shrink::shrink(b.items).map(items => { items, })
    })
    None
  } catch {
    e => Some(e.to_string())
  }
  guard failed is Some(text) else {
    fail("expected the post-condition to break")
  }
  assert_true(text.contains("{\"items\":[7]}"))
}

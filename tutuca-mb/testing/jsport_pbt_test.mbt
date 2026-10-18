// Port of test/pbt/pbt.test.js, on the Tabs/Tab pair: Tabs keeps exactly the selected tab
// selected, an invariant the tests below break on purpose. JS's `tabSelected` handler (with
// `sourceKey: t.index("tabs")`) is a `Signal::from` listener here, so it runs when a tab's
// message notifies; it is not a message of its own.

///|
struct PbTab {
  label : String
  is_selected : Bool
} derive(ToJson, Debug, @quickcheck.Arbitrary)

///|
enum PbTabMsg {
  Selected
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
struct PbTabs {
  tabs : @tutuca.Vec[PbTab]
  selected : Int32
} derive(ToJson, Debug, @quickcheck.Arbitrary)

///|
enum PbTabsMsg {
  Nothing
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
let pb_tab_selected : @tutuca.Signal[Unit] = @tutuca.Signal::new("tabSelected")

///|
let pb_tab : @tutuca.Component[PbTab, PbTabMsg] = @tutuca.component(
  "Tab",
  view=() => @tutuca.p([], [@tutuca.show(t => t.label)]),
  views=() => {
    [
      (
        "tab",
        @tutuca.button(
          [
            @tutuca.class_(t => {
              if t.is_selected {
                "btn btn-success"
              } else {
                "btn"
              }
            }),
            @tutuca.on_click(Selected),
          ],
          [@tutuca.show(t => t.label)],
        ),
      ),
    ]
  },
  update=(t, _, ctx) => {
    ctx.notify(pb_tab_selected, ())
    { ..t, is_selected: true, }
  },
)

///|
let pb_tabs_items : @tutuca.Items[PbTabs, Int32, PbTab] = @tutuca.items(
  "tabs",
  s => s.tabs,
  (s, tabs) => { ..s, tabs, },
)

///|
fn pb_tabs_of(
  select : (PbTabs, Int32) -> PbTabs,
) -> @tutuca.Component[PbTabs, PbTabsMsg] {
  @tutuca.component(
    "Tabs",
    view=() => {
      @tutuca.div([], [
        @tutuca.render_each(pb_tabs_items, pb_tab, view="tab"),
        @tutuca.render_key(pb_tabs_items, s => s.selected, pb_tab),
      ])
    },
    on=[
      pb_tab_selected.from(pb_tabs_items, (s, _, key, ctx) => {
        ctx.stop()
        select(s, key)
      }),
    ],
    invariants=[
      (
        "oneSelected",
        s => {
          s.tabs.length() > 0 &&
          s.tabs
          .iter()
          .mapi((i, t) => t.is_selected == (i == s.selected))
          .all(x => x)
        },
      ),
    ],
  )
}

///|
let pb_tabs : @tutuca.Component[PbTabs, PbTabsMsg] = pb_tabs_of((s, key) => {
  tabs: s.tabs
  .update(s.selected, t => { ..t, is_selected: false, })
  .update(key, t => { ..t, is_selected: true, }),
  selected: key,
})

///|
/// Tabs that keep exactly the selected tab selected, too rare to reach by filtering.
fn pb_tabs_arb(rs : @splitmix.RandomState, size : Int32) -> PbTabs {
  let n = rs.next_uint(limit=4).reinterpret_as_int() + 1
  let selected = rs
    .next_uint(limit=n.reinterpret_as_uint())
    .reinterpret_as_int()
  let tabs = Array::makei(n, i => {
    let tab : PbTab = @quickcheck.Arbitrary::arbitrary(size, rs)
    { ..tab, is_selected: i == selected, }
  })
  { tabs: @tutuca.Vec::of(tabs), selected, }
}

///|
test "generic properties: Tab and Tabs" {
  @testing.check_component(pb_tab)
  @testing.check_component(pb_tabs, state=pb_tabs_arb)
}

///|
test "message sequences keep one tab selected" {
  let failure = @testing.find_failure(pb_tabs, pb_tabs_arb, [
    @testing.item_messages(pb_tab, pb_tabs_items),
    @testing.root_messages(),
  ])
  assert_true(failure is None)
}

///|
test "a tab switch that forgets the old tab breaks the invariant" {
  let buggy = pb_tabs_of((s, key) => {
    tabs: s.tabs.update(key, t => { ..t, is_selected: true, }),
    selected: key,
  })
  let failure = @testing.find_failure(buggy, pb_tabs_arb, [
    @testing.item_messages(pb_tab, pb_tabs_items),
  ])
  guard failure is Some(f) else { fail("expected the invariant to break") }
  assert_true(f.problem.contains("oneSelected"))
  // Shrunk to the one switch that breaks it.
  assert_eq(f.steps.length(), 1)
}

///|
struct PbCounter {
  count : Int32
} derive(ToJson, Debug)

///|
enum PbCounterMsg {
  Add(Int32)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
test "a post condition that doesn't hold is reported with the message" {
  let counter : @tutuca.Component[PbCounter, PbCounterMsg] = @tutuca.component(
    "Counter",
    view=() => @tutuca.txt("counter"),
    update=(s, msg, _) => {
      let Add(n) = msg
      { count: if s.count + n > 1000 { 1000 } else { s.count + n }, }
    },
    pre=(_, msg) => msg is Add(0..<=10),
    post=(msg, prev, next) => {
      let Add(n) = msg
      next.count == prev.count + n
    },
  )
  let failure = @testing.find_failure(
    counter,
    (rs, _) => { count: 990 + rs.next_uint(limit=11).reinterpret_as_int(), },
    [@testing.root_messages(keep=m => m is Add(0..<=10))],
  )
  guard failure is Some(f) else { fail("expected the post-condition to break") }
  assert_true(f.problem.contains("message invalid: Counter.Add("))
  assert_true(f.problem.contains("broke post"))
}

///|
test "the driver runs messages headless and records what they report" {
  let tabs = pb_tabs_arb(@splitmix.RandomState(seed=3), 10)
  let driver = @testing.Driver::new(pb_tabs, tabs)
  assert_eq(driver.problems().map(@testing.describe), [])
  let last = tabs.tabs.length() - 1
  driver.send_to(pb_tab, pb_tabs_items.at(last), Selected)
  assert_eq(driver.state().selected, last)
  assert_true(driver.state().tabs.at(last).is_selected)
  assert_eq(driver.problems().map(@testing.describe), [])
  driver.send_to(pb_tab, pb_tabs_items.at(99), Selected)
  assert_eq(
    driver
    .problems()
    .map(p => if p is TaskFailed(_) { "taskFailed" } else { "other" }),
    ["taskFailed"],
  )
}

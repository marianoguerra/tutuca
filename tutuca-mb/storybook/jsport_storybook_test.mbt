// Ports of test/storybook/{stories,storybook,element}.test.js. The JS tests drive JSON and
// math stories; these use small components of their own (the storybook package can't
// depend on the examples). The <tutuca-app> element's behaviour is checked in jsdom by
// scripts/smoke-storybook.mjs.

///|
struct Flip {
  value : Bool
} derive(ToJson)

///|
enum FlipMsg {
  Toggle
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// JS's JsonBool in edit mode: a button showing the value, toggling it.
let flip : @tutuca.Component[Flip, FlipMsg] = @tutuca.component(
  "Flip",
  view=() => {
    @tutuca.button(
      [@tutuca.aria("label", "boolean value"), @tutuca.on_click(Toggle)],
      [@tutuca.show(s => s.value.to_string())],
    )
  },
  update=(s, msg, _) => {
    match msg {
      Toggle => { value: !s.value, }
    }
  },
  messages=@tutuca.json_messages(["Toggle"]),
)

///|
let bool_id : String = "JSON/Bool (edit)"

///|
fn flip_book() -> @storybook.Book[@memdom.MemNode] {
  @storybook.book("JSON", [
    @storybook.story(
      "Bool (edit)",
      flip,
      () => { value: false, },
      sequences=[
        (
          "toggle",
          [
            @storybook.event(
              "click",
              @storybook.find("button", attr=("aria-label", "boolean value")),
            ),
            @storybook.check("on", s => s.value),
            @storybook.send(Toggle),
            @storybook.check("off", s => !s.value),
          ],
        ),
      ],
      targets=[@testing.root_messages()],
    ),
  ])
}

///|
/// JS's counterBook: a story whose second sequence checks the wrong thing and whose third
/// clicks an element that isn't there.
fn bugs_book() -> @storybook.Book[@memdom.MemNode] {
  @storybook.book("Bugs", [
    @storybook.story(
      "Counter",
      tally,
      () => { count: 0, },
      sequences=[
        (
          "up once",
          [@storybook.send(Up), @storybook.check("one", s => s.count == 1)],
        ),
        (
          "wrong check",
          [@storybook.send(Up), @storybook.check("two", s => s.count == 2)],
        ),
        ("missing element", [@storybook.event("click", @storybook.find("a"))]),
      ],
      targets=[@testing.root_messages()],
    ),
  ])
}

///|
fn mount_flip() -> (
  @storybook.Registry[@memdom.MemNode],
  @memdom.MemNode,
  Ref[@tutuca.Host[@memdom.MemNode]?],
) {
  let reg = @storybook.Registry::new([flip_book()])
  let doc = @memdom.document()
  let root = doc.element("main")
  let host = Ref(None)
  reg.mount(bool_id, doc, root, connect=h => host.val = Some(h))
  (reg, root, host)
}

///|
fn statuses(s : @storybook.Summary) -> Array[String] {
  s.steps.map(st => st.status)
}

// --- stories.test.js -----------------------------------------------------------------------

///|
test "checkStory names the step that fails" {
  let msg = try {
    @storybook.check_books([bugs_book()])
    ""
  } catch {
    e => e.to_string()
  }
  assert_eq(
    msg, "Bugs/Counter › wrong check › 2. two: failed check failed: two",
  )
}

///|
test "stressStory finds the schema break" {
  let msg = try {
    @storybook.check_books(
      [
        @storybook.book("Bugs", [
          @storybook.story("Counter", tally, () => { count: 0, }, targets=[
            @testing.root_messages(),
          ]),
        ]),
      ],
      stress=100,
      steps=6,
    )
    ""
  } catch {
    e => e.to_string()
  }
  // JS's error names the state the shrunk run broke; here the invariant, after the steps.
  assert_eq(
    msg,
    (
      #|Bugs/Counter: stress test failed: after
      #|    · Up
      #|    · Up
      #|    · Up
      #|  state invalid: Tally at ·: invariant `under three` does not hold
    ),
  )
}

///|
test "{story.id} starts valid and renders" {
  // Every story's initial state is checked, sequences or not.
  @storybook.check_books([flip_book()], stress=20)
  let msg = try {
    @storybook.check_books([
      @storybook.book("Bugs", [
        @storybook.story("Broken", tally, () => { count: 5, }),
      ]),
    ])
    ""
  } catch {
    e => e.to_string()
  }
  assert_eq(
    msg, "Bugs/Broken: initial state: state invalid: Tally at ·: invariant `under three` does not hold",
  )
}

///|
test "a runner steps through a sequence, back and forth" {
  let (reg, root, _) = mount_flip()
  let summary = reg.call(bool_id, Show)
  assert_eq(summary.sequences, ["toggle"])
  assert_eq(statuses(summary), ["pending", "pending", "pending", "pending"])
  ignore(reg.call(bool_id, Forward))
  let summary = reg.call(bool_id, Forward)
  assert_eq(summary.cursor, 2)
  assert_eq(summary.steps.map(st => (st.status, st.is_next)), [
    ("ok", false),
    ("ok", false),
    ("pending", true),
    ("pending", false),
  ])
  assert_eq(reg.call(bool_id, Back).state, Json::object({ "value": true }))
  assert_eq(reg.call(bool_id, Goto(0)).state, Json::object({ "value": false }))
  // The canvas follows the timeline.
  assert_eq(root.text_content(), "false")
  let summary = reg.call(bool_id, ToEnd)
  assert_eq(statuses(summary), ["ok", "ok", "ok", "ok"])
  assert_eq(summary.timeline.length(), 5)
}

///|
test "user interaction in the canvas becomes a timeline entry" {
  let (reg, root, host) = mount_flip()
  let changes = []
  reg.set_on_change(id => changes.push(id))
  let host = host.val.unwrap()
  ignore(host.handle_event(root.find("button").unwrap(), "click"))
  host.drain()
  let summary = reg.call(bool_id, Show)
  assert_eq(summary.timeline.map(e => (e.origin, e.label)), [
    ("initial", "initial"),
    ("user", "click → toggle()"),
  ])
  assert_eq(summary.state, Json::object({ "value": true }))
  assert_eq(changes, [bool_id])
}

///|
test "single steps: send to a target, generate args, random step" {
  let reg = mounted()
  let id = "Tally/Buggy"
  let summary = reg.call(id, Show)
  assert_eq(summary.targets, [
    {
      name: "Tally at ·",
      path: "·",
      messages: [{ name: "up", keys: [], }, { name: "down", keys: [], }],
    },
  ])
  let sent = reg.call(id, SendTo(0, "up", "[]", ""))
  assert_eq(sent.state, Json::object({ "count": 1 }))
  let summary = reg.call(id, Random(5))
  assert_eq(summary.timeline.length(), 3)
  assert_eq(summary.timeline[2].origin, "step")
  // JS rejects arguments that aren't a JSON array.
  assert_true(
    reg.call(id, SendTo(0, "up", "{}", "")).error.contains("JSON array"),
  )
}

///|
test "stress finds a counterexample that replays in the stepper" {
  let reg = mounted()
  let id = "Tally/Buggy"
  let result = reg.call(id, Stress(100, 6, 1, FromStory)).stress.unwrap()
  assert_eq(result.status, "failed")
  assert_true(result.error.contains("under three"))
  assert_true(result.steps.length() > 0)
  assert_true(reg.call(id, Show).sequences.contains("counterexample"))
  ignore(reg.call(id, Load("counterexample")))
  let summary = reg.call(id, ToEnd)
  assert_eq(summary.sequence, "counterexample")
  assert_eq(summary.steps.last().map(st => st.status), Some("failed"))
  assert_true(summary.problems.join("\n").contains("under three"))
}

///|
test "a generated story is sampled with the seed in its key" {
  let story : @storybook.Story[@memdom.MemNode] = @storybook.generated_story(
    "Generated",
    tally,
    (rs, _) => { count: rs.next_uint(limit=1000).reinterpret_as_int(), },
  )
  let state = (seed : UInt64) => {
    let reg = @storybook.Registry::new([@storybook.book("Tally", [story])])
    let doc = @memdom.document()
    reg.mount("Tally/Generated", doc, doc.element("main"), seed~)
    reg.call("Tally/Generated", Show).state
  }
  assert_eq(state(3), state(3))
  assert_not_eq(state(3), state(4))
}

///|
test "removing the element disposes the runner" {
  let reg = mounted()
  assert_eq(reg.runners.length(), 1)
  reg.unmount("Tally/Buggy")
  assert_eq(reg.runners.length(), 0)
  let msg = try {
    ignore(reg.call("Tally/Buggy", Show))
    ""
  } catch {
    e => e.to_string()
  }
  assert_eq(msg, "story Tally/Buggy is not mounted")
}

// --- storybook.test.js: the UI, on memdom --------------------------------------------------

///|
/// The storybook UI over `books`, answered by a registry; the shell's part (mounting a
/// picked story's preview) is `pick`'s.
priv struct Ui {
  d : @testing.Driver[@storybook.Storybook, @storybook.StorybookMsg]
  reg : @storybook.Registry[@memdom.MemNode]
  preview : Ref[@tutuca.Host[@memdom.MemNode]?]
  preview_root : @memdom.MemNode
}

///|
fn ui(books : Array[@storybook.Book[@memdom.MemNode]]) -> Ui {
  let reg = @storybook.Registry::new(books)
  let scope = @tutuca.Scope::new()
  reg.serve(scope)
  let d = @testing.Driver::new(
    @storybook.storybook,
    @storybook.Storybook::of(books),
    scope~,
  )
  reg.set_on_change(_ => d.app.send(Refresh))
  {
    d,
    reg,
    preview: Ref(None),
    preview_root: @memdom.document().element("div"),
  }
}

///|
/// Clicks the story in the list, then mounts its preview as <tutuca-app> would.
fn Ui::pick(self : Ui, name : String) -> Unit {
  self.d.click("button", text=name)
  let id = self.d.state().selected
  self.reg.mount(id, @memdom.document(), self.preview_root, connect=h => {
    self.preview.val = Some(h)
  })
  self.d.drain()
}

///|
fn Ui::summary(self : Ui) -> @storybook.Summary {
  self.d.state().summary.unwrap()
}

///|
/// The first element with this tag and attribute value.
fn Ui::by_attr(
  self : Ui,
  tag : String,
  name : String,
  value : String,
) -> @memdom.MemNode {
  self.d
  .find_all(tag)
  .iter()
  .find_first(b => b.get_attribute(name) == Some(value))
  .unwrap()
}

///|
fn Ui::click_attr(
  self : Ui,
  tag : String,
  name : String,
  value : String,
) -> Unit {
  self.d.dispatch(self.by_attr(tag, name, value), "click")
}

///|
fn Ui::problems(self : Ui) -> Array[String] {
  self.d.problems().map(@testing.describe)
}

///|
test "storybook lints clean" {
  assert_eq(@storybook.storybook.check(), [])
}

///|
test "pick a story, step through it and rewind" {
  let u = ui([flip_book(), tally_book()])
  u.pick("Bool (edit)")
  assert_eq(u.d.state().selected, bool_id)
  assert_eq(
    u.by_attr("tutuca-app", "class", "block").get_attribute("app-key"),
    Some("JSON/Bool (edit)@0"),
  )
  assert_eq(u.preview_root.text_content(), "false")
  assert_eq(u.summary().sequence, "toggle")
  assert_eq(u.summary().steps.length(), 4)
  u.click_attr("button", "title", "Run to end")
  assert_eq(statuses(u.summary()), ["ok", "ok", "ok", "ok"])
  assert_eq(u.summary().timeline.length(), 5)
  // The second timeline entry is the state after the first toggle.
  let entries = u.d
    .find_all("button")
    .filter(b => {
      b.get_attribute("type") == Some("button") &&
      b.text_content().has_prefix("▸")
    })
  u.d.dispatch(entries[0], "click")
  assert_eq(u.summary().cursor, 1)
  assert_true(u.d.text().contains("\"value\":true"))
  assert_eq(u.problems(), [])
}

///|
test "groups collapse, a filter shows their matches, and a pick scrolls to the top" {
  let u = ui([flip_book(), tally_book()])
  let visible = () => {
    u.d.find_all("button").filter_map(b => b.get_attribute("title"))
  }
  assert_true(visible().contains(bool_id))
  u.d.dispatch(u.by_attr("button", "aria-expanded", "true"), "click")
  assert_false(visible().contains(bool_id))
  assert_eq(u.d.state().collapsed, ["JSON"])
  u.d.type_into("input", "JSON/Bool (edit)")
  assert_true(visible().contains(bool_id))
  // The scroll to the top on a pick: "picking a story asks to scroll the panel back to its
  // top" (storybook_test.mbt).
  u.pick("Bool (edit)")
  assert_eq(u.d.state().selected, bool_id)
  assert_eq(u.problems(), [])
}

///|
test "clicks in the story canvas show up in the timeline" {
  let u = ui([flip_book()])
  u.pick("Bool (edit)")
  let host = u.preview.val.unwrap()
  ignore(host.handle_event(u.preview_root.find("button").unwrap(), "click"))
  host.drain()
  u.d.drain()
  assert_eq(u.summary().timeline.map(e => e.origin), ["initial", "user"])
  assert_eq(u.summary().cursor, 1)
  assert_eq(u.problems(), [])
}

///|
test "send a message from the step form" {
  let u = ui([tally_book()])
  u.pick("Buggy")
  u.d.dispatch(
    u.by_attr("select", "aria-label", "Message"),
    "change",
    value="up",
  )
  u.d.dispatch(
    u.by_attr("input", "aria-label", "Arguments as a JSON array"),
    "input",
    value="[]",
  )
  u.d.click("button", text="Send")
  assert_eq(u.preview_root.text_content(), "1")
  assert_eq(
    u.summary().timeline.last().map(e => e.label),
    Some("Tally at ·.up()"),
  )
  // Generate args fills the form with generated arguments for the message.
  u.d.click("button", text="Generate args")
  assert_eq(u.d.state().form.args, "[]")
  assert_eq(u.problems(), [])
}

///|
test "the dev tab inspects the story's state, tasks, components and lint" {
  let u = ui([flip_book()])
  u.pick("Bool (edit)")
  u.click_attr("button", "title", "Step")
  u.d.click("button", text="Dev")
  let dev = u.d.state().dev
  let titles = (s : @dev.DevSection) => s.nodes.to_array().map(n => n.title)
  assert_eq(titles(dev.state), ["Flip"])
  assert_eq(dev.state.nodes.at(0).detail, "value true")
  assert_eq(titles(dev.tasks), ["event “toggle”"])
  assert_eq(dev.tasks.nodes.at(0).detail, "to the root")
  assert_eq(titles(dev.specs), ["Flip component"])
  assert_eq(dev.lint.issues, [])
  assert_true(u.d.text().contains("LintClean"))
  // Opening the state node shows its fields.
  u.click_attr("button", "aria-label", "Expand")
  assert_true(u.d.state().dev.state.nodes.at(0).is_open)
  assert_true(u.d.text().contains("valuetrue"))
  // As JS, the nodes read as code once the panel says so.
  u.d.click("button", text="Code")
  assert_true(u.d.state().dev.view is Code)
  assert_true(u.d.text().contains("ComponentSpecFlip"))
  // Another step keeps the components section as it is.
  let specs = u.d.state().dev.specs
  u.d.click("button", text="Steps")
  u.click_attr("button", "title", "Step")
  assert_eq(u.d.state().dev.specs, specs)
  assert_eq(u.problems(), [])
}

///|
test "a stress run from the UI reports its result" {
  let u = ui([flip_book()])
  u.pick("Bool (edit)")
  u.d.click("button", text="Stress test")
  u.d.type_into("input", "15", nth=1)
  u.d.click("button", text="Run stress test")
  let stress = u.summary().stress.unwrap()
  assert_eq((stress.status, stress.done), ("passed", 15))
  assert_true(u.d.text().contains("passed15/15runs"))
  assert_eq(u.problems(), [])
}

// --- element.test.js: what isn't the DOM element's --------------------------------------------

///|
test "the outer view lints clean" {
  // JS lints a component that holds a <tutuca-app>; the storybook UI is the one here.
  assert_eq(@storybook.storybook.check(), [])
}

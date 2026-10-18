// 1. A counter: a component is a state type, a message type, a view and an update.
// Click the buttons in the preview, then pick the "count to three" sequence and step it.

///|
using @tutuca {div, span, button, txt, show, cls, aria, on_click}

///|
/// The state: an immutable struct, so an update returns the next one.
pub(all) struct Counter {
  count : Int32
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// The messages: an enum, so sending one the update doesn't handle is a compile error.
pub(all) enum CounterMsg {
  Inc
  Dec
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let counter : @tutuca.Component[Counter, CounterMsg] = @tutuca.component(
  "Counter",
  // The view is data: on_click(Inc) is the message a click sends to this component.
  view=() => {
    div([cls("flex items-center gap-3")], [
      button([cls("btn"), aria("label", "Less"), on_click(Dec)], [txt("−")]),
      span([cls("text-2xl font-bold tabular-nums")], [
        show(s => s.count.to_string()),
      ]),
      button([cls("btn btn-primary"), aria("label", "More"), on_click(Inc)], [
        txt("+"),
      ]),
    ])
  },
  // The update maps a state and a message to the next state; tutuca renders it.
  update=(s, msg, _) => {
    match msg {
      Inc => { count: s.count + 1, }
      Dec => { count: s.count - 1, }
    }
  },
)

///|
let more : @storybook.Find = @storybook.find(
  "button",
  attr=("aria-label", "More"),
)

///|
/// A book of stories: initial states to show, sequences of steps to replay and check, and
/// the targets random messages go to in stress tests.
pub fn[N : @vdom.DomNode] books() -> Array[@storybook.Book[N]] {
  [
    @storybook.book("Counter", [
      @storybook.story(
        "From zero",
        counter,
        () => { count: 0, },
        sequences=[
          (
            "count to three",
            [
              @storybook.event("click", more),
              @storybook.event("click", more),
              @storybook.event("click", more),
              @storybook.check("shows 3", s => s.count == 3),
            ],
          ),
        ],
        targets=[@testing.root_messages()],
      ),
      @storybook.story("From ten", counter, () => { count: 10, }),
    ]),
  ]
}

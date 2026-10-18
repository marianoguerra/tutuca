// 3. Components inside components: a cart of line items. Each line is a component with its
// own messages; the cart renders them through a collection and listens to what they notify.
// The line's invariant is checked after every message: try sending SetQuantity(-1) to a line
// from the send form, and see the problem it reports.

///|
using @tutuca {
  div,
  span,
  strong,
  button,
  txt,
  show,
  cls,
  aria,
  on_click,
  type Vec,
}

///|
/// A line can't remove itself: it tells its parent, which owns the list.
pub let remove_line : @tutuca.Signal[Unit] = @tutuca.Signal::new("removeLine")

///|
pub(all) struct Line {
  name : String
  cents : Int32 // The price, in cents, so totals add up exactly.
  quantity : Int32
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum LineMsg {
  Step(Int32)
  SetQuantity(Int32)
  Remove
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Cents as dollars: 1575 is "15.75".
pub fn money(cents : Int32) -> String {
  let c = cents % 100
  "\{cents / 100}.\{if c < 10 { "0" } else { "" }}\{c}"
}

///|
pub let line : @tutuca.Component[Line, LineMsg] = @tutuca.component(
  "Line",
  view=() => {
    div([cls("flex items-center gap-3 rounded-box bg-base-200 p-2")], [
      span([cls("flex-1")], [show(l => l.name)]),
      div([cls("join")], [
        button(
          [
            cls("btn btn-sm join-item"),
            aria("label", "Fewer"),
            on_click(Step(-1)),
          ],
          [txt("−")],
        ),
        span([cls("btn btn-sm join-item pointer-events-none tabular-nums")], [
          show(l => l.quantity.to_string()),
        ]),
        button(
          [
            cls("btn btn-sm join-item"),
            aria("label", "More"),
            on_click(Step(1)),
          ],
          [txt("+")],
        ),
      ]),
      span([cls("w-16 text-right tabular-nums")], [
        show(l => "$\{money(l.cents * l.quantity)}"),
      ]),
      button(
        [cls("btn btn-sm btn-ghost"), aria("label", "Remove"), on_click(Remove)],
        [txt("✕")],
      ),
    ])
  },
  update=(l, msg, ctx) => {
    match msg {
      Step(by) => {
        let quantity = l.quantity + by
        { ..l, quantity: if quantity < 0 { 0 } else { quantity }, }
      }
      SetQuantity(quantity) => { ..l, quantity, }
      Remove => {
        ctx.notify(remove_line, ())
        l
      }
    }
  },
  invariants=[("the quantity is never negative", l => l.quantity >= 0)],
)

///|
pub(all) struct Cart {
  lines : Vec[Line]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum CartMsg {
  Clear
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// The cart's lines, as a collection its views and listeners name.
pub let lines : @tutuca.Items[Cart, Int32, Line] = @tutuca.items(
  "lines",
  c => c.lines,
  (_, lines) => { lines, },
)

///|
pub fn Cart::total(self : Cart) -> Int32 {
  self.lines.fold(init=0, (sum, l) => sum + l.cents * l.quantity)
}

///|
pub fn Cart::count(self : Cart) -> Int32 {
  self.lines.fold(init=0, (sum, l) => sum + l.quantity)
}

///|
pub let cart : @tutuca.Component[Cart, CartMsg] = @tutuca.component(
  "Cart",
  view=() => {
    div([cls("flex max-w-md flex-col gap-2")], [
      // Each line renders with its own view and handles its own messages.
      @tutuca.render_each(lines, line),
      div([cls("flex justify-between border-t border-base-300 pt-2")], [
        span([], [show(c => "\{c.count()} items")]),
        strong([], [show(c => "Total $\{money(c.total())}")]),
        button([cls("btn btn-xs"), on_click(Clear)], [txt("Clear")]),
      ]),
    ])
  },
  update=(_, msg, _) => {
    match msg {
      Clear => { lines: Vec::new(), }
    }
  },
  // `from(lines, ...)` gets the index of the line the notification came from.
  on=[
    remove_line.from(lines, (c, _, i, ctx) => {
      ctx.stop()
      { lines: c.lines.remove(i), }
    }),
  ],
)

///|
fn sample() -> Cart {
  {
    lines: Vec::of([
      { name: "Coffee beans", cents: 1250, quantity: 2, },
      { name: "Filters", cents: 300, quantity: 1, },
      { name: "Mug", cents: 975, quantity: 1, },
    ]),
  }
}

///|
pub fn[N : @vdom.DomNode] books() -> Array[@storybook.Book[N]] {
  [
    @storybook.book("Cart", [
      @storybook.story(
        "Three lines",
        cart,
        sample,
        sequences=[
          (
            "change and remove",
            [
              @storybook.send_to(line, lines.at(1), Step(1)),
              @storybook.check("two filters", c => c.lines.at(1).quantity == 2),
              @storybook.event(
                "click",
                @storybook.find("button", attr=("aria-label", "Remove")),
              ),
              @storybook.check("coffee is gone", c => {
                c.lines.length() == 2 && money(c.total()) == "15.75"
              }),
            ],
          ),
        ],
        // Random messages, to the cart and to its lines, keeping the ones the UI can send.
        targets=[
          @testing.root_messages(),
          @testing.item_messages(line, lines, keep=m => !(m is SetQuantity(_))),
        ],
      ),
      @storybook.story("Empty", cart, () => { lines: Vec::new(), }),
    ]),
  ]
}

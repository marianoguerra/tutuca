// Ports of test/dev/*.test.js. The vdom-formatter tests already ported live in
// describe_test.mbt; the browser half (installing the formatter) is checked by
// scripts/smoke.mjs.

///|
struct Flags {
  a : Bool
  b : Bool
  dynamic : String
  items : Array[Int32]
}

///|
enum FlagsMsg {
  Noop
} derive(Debug)

///|
let flags : @tutuca.Component[Flags, FlagsMsg] = @tutuca.component(
  "Flags",
  view=() => {
    @tutuca.div([@tutuca.cls("flex  gap-2")], [
      // JS's `class: $if(a, $if(b, "x y", "z"), "w")`: a constant class in each branch.
      @tutuca.if_(
        s => s.a,
        @tutuca.if_(
          s => s.b,
          @tutuca.span([@tutuca.cls("x y")], []),
          @tutuca.span([@tutuca.cls("z")], []),
        ),
        @tutuca.span([@tutuca.cls("w")], []),
      ),
      @tutuca.span(
        [@tutuca.class_(s => s.dynamic), @tutuca.attr("title", "not-a-class")],
        [],
      ),
      @tutuca.each(
        s => s.items.iter(),
        @tutuca.h("i", [@tutuca.cls("item")], []),
      ),
    ])
  },
  update=(s, _, _) => s,
)

///|
test "collectClasses finds constant classes in nested $if branches" {
  assert_eq(flags.class_names(), ["flex", "gap-2", "x", "y", "z", "w", "item"])
  // collectClasses(v, all) adds to the set it is given: the collector keeps what it knew
  // and reports only the new names.
  let reported : Array[Array[String]] = []
  let collector = @dev.ClassCollector::new(known=["kept"], fresh => {
    reported.push(fresh)
  })
  collector.add(flags.class_names())
  collector.add(["kept item"])
  assert_eq(reported, [["flex", "gap-2", "x", "y", "z", "w", "item"]])
  // The computed class escapes the view, as in JS; the DOM scan finds it once rendered.
  let d = @testing.Driver::new(flags, {
    a: true,
    b: false,
    dynamic: "computed",
    items: [1],
  })
  d.send(Noop)
  collector.scan(d.root_node)
  assert_eq(reported.last(), Some(["computed"]))
}

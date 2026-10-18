///|
pub(all) struct Counter {
  count : Int32
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum CounterMsg {
  Inc
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let counter : @tutuca.Component[Counter, CounterMsg] = @tutuca.component(
  "Counter",
  view=() => {
    @tutuca.button([@tutuca.on_click(Inc)], [
      @tutuca.txt("Clicked "),
      @tutuca.show(s => s.count.to_string()),
    ])
  },
  update=(s, msg, _) => {
    match msg {
      Inc => { count: s.count + 1, }
    }
  },
)

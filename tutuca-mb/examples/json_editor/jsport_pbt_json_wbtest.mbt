// Port of test/pbt/pbt.test.js's "event sequences keep the state valid and the patched DOM
// equal to a fresh render": as JS's `A.instance("JsonEditor")`, every run starts from a random
// editor (its value, mode and text toggle all generated), then random DOM events run on it.

///|
test "event sequences keep the state valid and the patched DOM equal to a fresh render" {
  let rs = @splitmix.RandomState(seed=7)
  @testing.run_events(
    json_editor,
    () => {
      let editor : JsonEditor = @quickcheck.Arbitrary::arbitrary(6, rs.split())
      editor
    },
    count=25,
  )
}

///|
test "clicking counts" {
  let d = @testing.Driver::new(@counter.counter, { count: 0, })
  d.click("button")
  d.click("button")
  assert_eq(d.text(), "Clicked2")
}

///|
test "the counter has the generic properties" {
  @testing.check_component(@counter.counter)
}

///|
test "the cart's stories start valid and their sequences pass" {
  @storybook.check_books(@composed.books())
}

///|
test "money shows cents as dollars" {
  assert_eq(@composed.money(1575), "15.75")
  assert_eq(@composed.money(300), "3.00")
  assert_eq(@composed.money(905), "9.05")
}

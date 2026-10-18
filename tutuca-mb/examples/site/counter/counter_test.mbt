///|
test "the counter's stories start valid and their sequences pass" {
  @storybook.check_books(@counter.books())
}

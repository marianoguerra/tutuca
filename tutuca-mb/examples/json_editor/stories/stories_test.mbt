///|
test "the json stories pass their sequences" {
  @storybook.check_books([@stories.json_book()])
}

// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the json stories' stress tests pass" {
  @storybook.check_books([@stories.json_book()], stress=20)
}

// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the drawing stories' stress tests pass" {
  @storybook.check_books([@stories.drawing_book()], stress=20)
}

// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the thing tracker stories' stress tests pass" {
  @storybook.check_books([@stories.thing_tracker_book()], stress=20)
}

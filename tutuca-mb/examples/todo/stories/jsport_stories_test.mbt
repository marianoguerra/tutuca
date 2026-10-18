// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the todo stories' stress tests pass" {
  @storybook.check_books([@stories.todo_book()], stress=20)
}

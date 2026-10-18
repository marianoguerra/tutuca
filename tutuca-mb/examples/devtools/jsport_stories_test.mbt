// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the dev stories' stress tests pass" {
  @storybook.check_books([@devtools.dev_book()], stress=20)
}

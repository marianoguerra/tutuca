// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the math stories' stress tests pass" {
  @storybook.check_books(
    [@stories.math_book(), @stories.workbench_book()],
    stress=20,
  )
}

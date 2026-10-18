// The stress half of test/storybook/stories.test.js's per-story tests, for this book.

///|
test "the JSON Schema stories' stress tests pass" {
  @storybook.check_books(
    [@stories.schema_book(), @stories.studio_book()],
    stress=20,
  )
}

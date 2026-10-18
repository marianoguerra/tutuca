///|
test "the math stories pass their sequences" {
  @storybook.check_books([@stories.math_book(), @stories.workbench_book()])
}

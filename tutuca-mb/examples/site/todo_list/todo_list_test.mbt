///|
test "the todo list's stories start valid and their sequences pass" {
  @storybook.check_books(@todo_list.books())
}

///|
test "the dev stories pass their sequences" {
  @storybook.check_books([@devtools.dev_book()])
}

///|
test "a spec reads as code" {
  let spec = @dev.SpecInfo::of(@todo.todo_project)
  let main = spec.views[0]
  assert_eq(main.words, "<div> element")
  assert_true(
    main.code.contains(
      "h(\"h2\", [cls(\"text-xl font-bold\"), attr(\"title\", \"Double-click to rename\"), on(dblclick, …)])",
    ),
  )
  assert_eq(spec.events, ["input", "change", "click", "dblclick"])
}

///|
test "check() reports the three mistakes the example describes" {
  inspect(
    @mistakes.greeting.check().map(i => i.to_string()).join("\n"),
    content=(
      #|Greeting.main <div> > <div> > <button>: `clik` is not a DOM event this checker knows; check its spelling, or the handler never runs
      #|Greeting.main <div> > <div> > <button>: `class` is set more than once; keep one, joining classes into a single cls(...) or class_(...)
      #|Greeting.main <div> > <div> > <button>: has two `click` handlers; only one runs, so merge them into one on_event(...)
    ),
  )
}

///|
test "checking the mistakes' book fails with its issues" {
  let books : Array[@storybook.Book[@memdom.MemNode]] = @mistakes.books()
  let message = try {
    @storybook.check_books(books)
    ""
  } catch {
    @storybook.StoryFailed(m) => m
    e => raise e
  }
  assert_true(message.has_prefix("Mistakes/Greeting: Greeting.main"))
  assert_true(message.contains("`clik` is not a DOM event"))
}

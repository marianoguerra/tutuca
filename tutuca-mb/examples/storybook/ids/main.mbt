///|
/// The books the storybook page shows, in its order.
fn books() -> Array[@storybook.Book[@memdom.MemNode]] {
  [
    @drawing_stories.drawing_book(),
    @math_stories.math_book(),
    @math_stories.workbench_book(),
    @tracker_stories.thing_tracker_book(),
    @todo_stories.todo_book(),
    @json_stories.json_book(),
    @schema_stories.schema_book(),
    @schema_stories.studio_book(),
    @dev_stories.dev_book(),
  ]
}

///|
fn main {
  for b in books() {
    for s in b.stories {
      println(s.id)
    }
  }
}

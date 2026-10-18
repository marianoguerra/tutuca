///|
/// margaui's theme, which the previews link in their shadow roots as the page does.
let theme_css : String = "/node_modules/margaui/dist/themes/theme.css"

///|
/// Starts the storybook on the element `selector` finds, with `selected` open.
pub fn start(selector : String, selected : String) -> Bool {
  match @tw.query(selector) {
    Some(root) => {
      ignore(
        @sbw.start(
          root,
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
          ],
          selected~,
          compile=@tw.margaui,
          links=[theme_css],
        ),
      )
      true
    }
    None => false
  }
}

///|
pub fn on_call(
  id : Int32,
  status : Int32,
  arg : @tw.JsNode,
  text : String,
) -> Unit {
  @tw.on_call(id, status, arg, text)
}

///|
fn main {

}

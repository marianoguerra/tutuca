// The prebuilt half of a playground run on wasm-gc, as run is on js. JS can't hand wasm a
// config object, so the page answers the `playground` import namespace with this run's: the
// node to run on, the prefix of its preview keys, the stories it would like shown, one per
// line, and the id of the <style> for the UI's CSS. The run's boot file exports `current` as
// `playground_story`, the story shown, which the page reads for the next run.

///|
extern "wasm" fn root_ffi() -> @tw.JsNode = "playground" "root"

///|
extern "wasm" fn prefix_ffi() -> String = "playground" "prefix"

///|
extern "wasm" fn style_id_ffi() -> String = "playground" "style_id"

///|
extern "wasm" fn wanted_lines_ffi() -> String = "playground" "wanted_lines"

///|
/// Fails the run with `message`: the page's import throws it.
extern "wasm" fn fail(message : String) -> Unit = "playground" "fail"

///|
/// margaui's theme, which the previews link in their shadow roots as the page does.
let theme_css : String = "/node_modules/margaui/dist/themes/theme.css"

///|
let app : Ref[@tutuca.App[@storybook.Storybook, @storybook.StorybookMsg]?] = Ref(
  None,
)

///|
/// Runs `books` with the storybook UI on the page's run root. A component with issues can't
/// render, so books with any fail the run with them, as a compile error would.
pub fn start(books : Array[@storybook.Book[@tw.JsNode]]) -> Unit {
  let issues = @playground.issues_of(
    books.map(b => b.stories.map(s => (s.id, s.issues))),
  )
  if issues != "" {
    fail(issues)
    return
  }
  let ids = []
  for b in books {
    for s in b.stories {
      ids.push(s.id)
    }
  }
  let wanted : Array[String] = wanted_lines_ffi()
    .split("\n")
    .map(w => w.to_owned())
    .collect()
  app.val = Some(
    @sbw.start(
      root_ffi(),
      books,
      selected=@playground.choose_story(ids, wanted),
      prefix=prefix_ffi(),
      style_id=style_id_ffi(),
      compile=@tw.margaui,
      links=[theme_css],
    ),
  )
}

///|
/// The story the run shows, "" before it starts.
pub fn current() -> String {
  match app.val {
    Some(a) => a.state().selected
    None => ""
  }
}

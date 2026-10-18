// The prebuilt half of a playground run. The page sets globalThis.__tutucaPlayground to a
// fresh object { root, prefix, wanted, styleId } just before it imports a run: the node to run
// on, the prefix of this run's preview keys, the stories it would like shown, in order, and
// the id of the <style> for the UI's CSS. The run's `main` calls `start` with its books, which
// leaves `current()` on that object, answering the story shown, so the next run can keep it.
// A page with many playgrounds imports one run at a time, so each run reads its own object.

///|
#external
priv type Config

///|
extern "js" fn config_ffi() -> Config =
  #|() => globalThis.__tutucaPlayground ?? {}

///|
extern "js" fn Config::root(self : Config) -> @browser.JsNode =
  #|(c) => c.root ?? document.body

///|
extern "js" fn Config::prefix(self : Config) -> String =
  #|(c) => c.prefix ?? ""

///|
extern "js" fn Config::style_id(self : Config) -> String =
  #|(c) => c.styleId ?? "margaui"

///|
/// The stories wanted, one per line.
extern "js" fn Config::wanted_lines(self : Config) -> String =
  #|(c) => (c.wanted ?? []).join("\n")

///|
fn Config::wanted(self : Config) -> Array[String] {
  self.wanted_lines().split("\n").map(w => w.to_owned()).collect()
}

///|
extern "js" fn Config::publish(self : Config, current : () -> String) -> Unit =
  #|(c, current) => { c.current = current; }

///|
extern "js" fn fail(message : String) -> Unit =
  #|(message) => { throw new Error(message); }

///|
/// margaui's theme, which the previews link in their shadow roots as the page does.
let theme_css : String = "/node_modules/margaui/dist/themes/theme.css"

///|
/// Runs `books` with the storybook UI on the page's run root. A component with issues can't
/// render, so books with any fail the run with them, as a compile error would.
pub fn start(books : Array[@storybook.Book[@browser.JsNode]]) -> Unit {
  let c = config_ffi()
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
  let app = @web.start(
    c.root(),
    books,
    selected=@playground.choose_story(ids, c.wanted()),
    prefix=c.prefix(),
    style_id=c.style_id(),
    compile=@browser.margaui,
    links=[theme_css],
  )
  c.publish(() => app.state().selected)
}

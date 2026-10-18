///|
/// Mounts the drawing editor on the element `selector` finds, with a house in the sun.
pub fn start(selector : String) -> Bool {
  guard @browser.query(selector) is Some(root) else { return false }
  let scope = @tutuca.Scope::new()
  @files.handle_files(scope)
  let (host, app) = @browser.mount(
    root,
    @drawing.drawing,
    @stories.house(),
    dev=true,
    scope~,
    on_report=@browser.compile_styles(root),
  )
  @browser.expose("app", host, app, @drawing.drawing)
  true
}

///|
fn main {
  ignore(start("#app"))
}

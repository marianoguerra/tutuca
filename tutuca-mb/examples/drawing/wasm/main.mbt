///|
/// Mounts the drawing editor on the element `selector` finds, with a house in the sun.
pub fn start(selector : String) -> Bool {
  guard @tw.query(selector) is Some(root) else { return false }
  let scope = @tutuca.Scope::new()
  @files.handle_files(scope)
  let (host, app) = @tw.mount(
    root,
    @drawing.drawing,
    @stories.house(),
    dev=true,
    scope~,
    on_report=@tw.compile_styles(root),
  )
  @tw.expose("app", host, app, @drawing.drawing)
  true
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

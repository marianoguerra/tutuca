///|
/// Mounts the schema studio on the element `selector` finds. Edits happen inside the editor,
/// which doesn't tell the studio, so the studio infers again after each one that leaves it
/// stale, as the JS demo does.
pub fn start(selector : String) -> Bool {
  guard @tw.query(selector) is Some(root) else { return false }
  let scope = @tutuca.Scope::new()
  @files.handle_files(scope)
  let app_ref : Ref[@tutuca.App[@js.Studio, @js.StudioMsg]?] = Ref(None)
  let styles = @tw.compile_styles(root)
  let on_report = (r : @tutuca.Report) => {
    styles(r)
    if r is TaskHandled(_) && app_ref.val is Some(app) && app.state().is_stale() {
      app.send(Regenerate)
    }
  }
  let (host, app) = @tw.mount(
    root,
    @js.studio_component,
    @js.studio(),
    dev=true,
    scope~,
    on_report~,
  )
  app_ref.val = Some(app)
  @tw.expose("app", host, app, @js.studio_component)
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

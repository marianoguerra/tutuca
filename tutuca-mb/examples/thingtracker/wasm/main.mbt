///|
/// Mounts the demo on the element `selector` finds, if any; returns whether it did.
pub fn start(selector : String) -> Bool {
  match @tw.query(selector) {
    Some(root) => {
      let scope = @tutuca.Scope::new()
      @common_wasm.handle_files(scope)
      @common_wasm.handle_clock(scope)
      let now = @tw.now().floor()
      let (host, app) = @tw.mount(
        root,
        @tt.tracker_app,
        @tt.demo_app(now, tz=@tw.local_offset(now)),
        dev=true,
        scope~,
        on_report=@tw.compile_styles(root),
      )
      @tw.expose("app", host, app, @tt.tracker_app)
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

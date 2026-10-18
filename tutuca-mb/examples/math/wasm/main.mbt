///|
/// Mounts the workbench on the element `selector` finds, with two problems saved.
pub fn start(selector : String) -> Bool {
  guard @tw.query(selector) is Some(root) else { return false }
  let state = {
    ..@math.Workbench::new(),
    quadratic: { a: 1.0, b: -3.0, c: 2.0, },
    history: @tutuca.Vec::of([
      SavedQuadratic({ a: 1.0, b: 2.0, c: 5.0, }),
      SavedMatrix({ a: 2, b: 4, c: 1, d: 2, }),
    ]),
  }
  let (host, app) = @tw.mount(
    root,
    @math.workbench,
    state,
    dev=true,
    on_report=@tw.compile_styles(root),
  )
  @tw.expose("app", host, app, @math.workbench)
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

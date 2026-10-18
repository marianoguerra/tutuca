///|
/// Mounts the workbench on the element `selector` finds, with two problems saved.
pub fn start(selector : String) -> Bool {
  guard @browser.query(selector) is Some(root) else { return false }
  let state = {
    ..@math.Workbench::new(),
    quadratic: { a: 1.0, b: -3.0, c: 2.0, },
    history: @tutuca.Vec::of([
      SavedQuadratic({ a: 1.0, b: 2.0, c: 5.0, }),
      SavedMatrix({ a: 2, b: 4, c: 1, d: 2, }),
    ]),
  }
  let (host, app) = @browser.mount(
    root,
    @math.workbench,
    state,
    dev=true,
    on_report=@browser.compile_styles(root),
  )
  @browser.expose("app", host, app, @math.workbench)
  true
}

///|
fn main {
  ignore(start("#app"))
}

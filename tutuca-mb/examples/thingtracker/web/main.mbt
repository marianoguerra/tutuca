///|
extern "js" fn date_now() -> Double =
  #|() => Date.now()

///|
/// The browser's offset from UTC in minutes, as the tracker's tz.
extern "js" fn local_offset(now : Double) -> Int32 =
  #|(now) => -new Date(now).getTimezoneOffset()

///|
/// Mounts the demo on the element `selector` finds, if any; returns whether it did.
pub fn start(selector : String) -> Bool {
  match @browser.query(selector) {
    Some(root) => {
      let scope = @tutuca.Scope::new()
      @common_web.handle_files(scope)
      @common_web.handle_clock(scope)
      let now = date_now().floor()
      let (host, app) = @browser.mount(
        root,
        @tt.tracker_app,
        @tt.demo_app(now, tz=local_offset(now)),
        dev=true,
        scope~,
        on_report=@browser.compile_styles(root),
      )
      @browser.expose("app", host, app, @tt.tracker_app)
      true
    }
    None => false
  }
}

///|
fn main {
  ignore(start("#app"))
}

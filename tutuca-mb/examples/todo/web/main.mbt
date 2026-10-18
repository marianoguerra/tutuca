///|
/// Mounts the demo on the element `selector` finds, if any; returns whether it did.
pub fn start(selector : String) -> Bool {
  match @browser.query(selector) {
    Some(root) => {
      let scope = @tutuca.Scope::new()
      scope.answer(@todo.today_ask, _ => @browser.iso_today())
      let (host, app) = @browser.mount(
        root,
        @todo.todo_app,
        @todo.week_of_plans(@browser.iso_today()),
        dev=true,
        scope~,
        on_report=@browser.compile_styles(root),
      )
      @browser.expose("app", host, app, @todo.todo_app)
      app.send(SyncToday)
      true
    }
    None => false
  }
}

///|
fn main {
  ignore(start("#app"))
}

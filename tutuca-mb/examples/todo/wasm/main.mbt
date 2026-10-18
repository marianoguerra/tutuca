///|
/// Mounts the demo on the element `selector` finds; returns whether it did.
pub fn start(selector : String) -> Bool {
  match @tw.query(selector) {
    Some(root) => {
      let scope = @tutuca.Scope::new()
      scope.answer(@todo.today_ask, _ => @tw.iso_today())
      let (host, app) = @tw.mount(
        root,
        @todo.todo_app,
        @todo.week_of_plans(@tw.iso_today()),
        dev=true,
        scope~,
        on_report=@tw.compile_styles(root),
      )
      @tw.expose("app", host, app, @todo.todo_app)
      app.send(SyncToday)
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

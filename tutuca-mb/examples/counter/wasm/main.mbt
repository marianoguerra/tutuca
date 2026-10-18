///|
/// Answers the <tutuca-app app-key="counter[:start]"> requests under `selector`: each gets a
/// counter from `start`, which reports `count` after each click.
pub fn start(selector : String) -> Bool {
  guard @tw.query(selector) is Some(root) else { return false }
  @tw.on_app_request(root, req => {
    let key = req.key()
    guard key == "counter" || key.has_prefix("counter:") else { return }
    let mut from = 0
    for c in key.view(start_offset=key.length().min(8)) {
      if c >= '0' && c <= '9' {
        from = from * 10 + (c.to_int() - '0'.to_int())
      }
    }
    let app_ref : Ref[@tutuca.App[@counter.Counter, @counter.CounterMsg]?] = Ref(
      None,
    )
    let (_, app) = @tw.mount_app(req, @counter.counter, { count: from, }, on_report=r => {
      if r is TaskHandled(_) && app_ref.val is Some(app) {
        req.emit("count", Json::number(app.state().count.to_double()))
      }
    })
    app_ref.val = Some(app)
  })
  // After the listener: elements already on the page ask as they upgrade.
  @tw.define_app_element()
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

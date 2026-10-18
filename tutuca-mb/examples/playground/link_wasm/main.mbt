///|
fn main {
  @run.start([])
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
pub fn playground_story() -> String {
  @run.current()
}

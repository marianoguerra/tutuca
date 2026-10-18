///|
extern "js" fn date_now() -> Double =
  #|() => Date.now()

///|
extern "js" fn set_timeout(f : () -> Unit, ms : Int32) -> Unit =
  #|(f, ms) => { setTimeout(f, ms); }

///|
/// Answers `now` with the browser's clock and `wait` with a timer.
pub fn handle_clock(scope : @tutuca.Scope) -> Unit {
  scope.answer(@common.now, _ => date_now())
  scope.handle(@common.wait, (ms, reply) => set_timeout(() => reply(Ok(())), ms))
}

///|
/// The current time, in epoch ms.
pub let now : @tutuca.Ask[Unit, Double] = @tutuca.Ask::new("now")

///|
/// Replies after the milliseconds asked: a timer.
pub let wait : @tutuca.Ask[Int32, Unit] = @tutuca.Ask::new("wait")

///|
/// Timers for tests: each wait is kept until the test fires it.
pub struct Timers {
  priv pending : Array[(Int32, () -> Unit)]
}

///|
pub fn Timers::new() -> Timers {
  { pending: [], }
}

///|
/// The waits not fired yet, in milliseconds, oldest first.
pub fn Timers::waiting(self : Timers) -> Array[Int32] {
  self.pending.map(t => t.0)
}

///|
/// Fires every pending wait, oldest first; the replies are queued as tasks.
pub fn Timers::fire_all(self : Timers) -> Unit {
  let due = self.pending.copy()
  self.pending.clear()
  for t in due {
    (t.1)()
  }
}

///|
/// Handlers for tests: `now` answers with `clock`, `wait` waits for `timers` to fire.
pub fn handle_clock_in_memory(
  scope : @tutuca.Scope,
  clock : () -> Double,
  timers : Timers,
) -> Unit {
  scope.answer(now, _ => clock())
  scope.handle(wait, (ms, reply) => {
    timers.pending.push((ms, () => reply(Ok(()))))
  })
}

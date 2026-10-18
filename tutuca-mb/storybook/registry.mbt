// The live runners by story id, answering the UI's `story_op` asks.

///|
/// What the UI asks a story's runner to do; every op answers with the new summary.
pub(all) enum Op {
  Show
  Load(String)
  Goto(Int32)
  Back
  Forward
  ToEnd
  Reset
  Random(UInt64)
  Stress(Int32, Int32, UInt64, StressFrom) // Runs, steps per run, seed, where runs start.
  SendTo(Int32, String, String, String) // Target, message name, its args as a JSON array, item key.
  StressStart(Int32, Int32, UInt64, StressFrom) // As Stress, in batches that report progress.
  StressEvents(Int32, Int32, UInt64, StressFrom) // As StressStart, with random DOM events.
  StressCancel
} derive(Eq, Debug)

///|
pub let story_op : @tutuca.Ask[(String, Op), Summary] = @tutuca.Ask::new(
  "story",
)

///|
/// Generated args for a story's target's message: (story, target, message, seed) to a JSON
/// array, for the send form.
pub let story_sample_args : @tutuca.Ask[(String, Int32, String, UInt64), String] = @tutuca.Ask::new(
  "storySampleArgs",
)

///|
/// Waits that many milliseconds: the UI's Play steps once per wait.
pub let delay : @tutuca.Ask[Int32, Unit] = @tutuca.Ask::new("delay")

///|
pub struct Registry[N] {
  stories : Map[String, Story[N]]
  runners : Map[String, Runner]
  priv schedules : Map[String, (() -> Unit) -> Unit]
  priv mut on_change : (String) -> Unit
}

///|
pub fn[N] Registry::new(books : Array[Book[N]]) -> Registry[N] {
  let stories = Map([])
  for b in books {
    for s in b.stories {
      stories[s.id] = s
    }
  }
  { stories, runners: Map([]), schedules: Map([]), on_change: _ => (), }
}

///|
/// Called after a story mounts, so the UI can ask for its summary.
pub fn[N] Registry::set_on_change(
  self : Registry[N],
  f : (String) -> Unit,
) -> Unit {
  self.on_change = f
}

///|
/// Runs story `id` on `root`, a node of `doc`, replacing a runner already there; a story of
/// generated states draws its state with `seed`.
pub fn[N] Registry::mount(
  self : Registry[N],
  id : String,
  doc : N,
  root : N,
  seed~ : UInt64 = 0,
  schedule? : (() -> Unit) -> Unit,
  connect~ : (@tutuca.Host[N]) -> Unit = _ => (),
) -> Unit {
  match self.stories.get(id) {
    Some(s) => {
      self.unmount(id)
      if schedule is Some(f) {
        self.schedules[id] = f
      }
      self.runners[id] = (s.runner)(
        seed,
        doc,
        root,
        schedule,
        () => (self.on_change)(id),
        connect,
      )
      (self.on_change)(id)
    }
    None => ()
  }
}

///|
pub fn[N] Registry::unmount(self : Registry[N], id : String) -> Unit {
  if self.runners.get(id) is Some(r) {
    (r.dispose)()
    self.runners.remove(id)
  }
}

///|
/// Runs `op` on story `id`'s runner and returns its summary.
pub fn[N] Registry::call(
  self : Registry[N],
  id : String,
  op : Op,
) -> Summary raise StoryFailed {
  guard self.runners.get(id) is Some(r) else {
    raise StoryFailed("story \{id} is not mounted")
  }
  match op {
    Show => ()
    Load(name) => (r.load)(name)
    Goto(i) => (r.goto)(i)
    Back => (r.back)()
    Forward => ignore((r.forward)())
    ToEnd => (r.to_end)()
    Reset => (r.reset)()
    Random(seed) => ignore((r.random_step)(seed))
    Stress(runs, steps, seed, from) =>
      ignore((r.stress)(runs, steps, seed, from))
    SendTo(target, name, args, key) =>
      ignore((r.send_to)(target, name, args, key))
    StressStart(runs, steps, seed, from) => {
      (r.stress_start)(runs, steps, seed, from)
      self.continue_stress(id, r)
    }
    StressEvents(runs, steps, seed, from) => {
      (r.stress_events_start)(runs, steps, seed, from)
      self.continue_stress(id, r)
    }
    StressCancel => (r.stress_cancel)()
  }
  self.summary_of(id, r)
}

///|
/// The runner's summary, with the components of the story's book.
fn[N] Registry::summary_of(
  self : Registry[N],
  id : String,
  r : Runner,
) -> Summary {
  let summary = (r.summary)()
  match self.stories.get(id) {
    Some(s) if s.specs.length() > 0 =>
      {
        ..summary,
        specs: s.specs,
        lint: s.specs.map(spec => spec.lint).flatten(),
      }
    _ => summary
  }
}

///|
/// Answers `story_op` and `story_sample_args` in `scope`.
pub fn[N] Registry::serve(self : Registry[N], scope : @tutuca.Scope) -> Unit {
  scope.answer(story_op, req => self.call(req.0, req.1))
  scope.answer(story_sample_args, req => {
    guard self.runners.get(req.0) is Some(r) else {
      raise StoryFailed("story \{req.0} is not mounted")
    }
    (r.sample_args)(req.1, req.2, req.3)
  })
}

///|
/// Runs a stress test's batches: one per tick of the story's schedule, telling the UI after
/// each; all at once without one.
fn[N] Registry::continue_stress(
  self : Registry[N],
  id : String,
  r : Runner,
) -> Unit {
  match self.schedules.get(id) {
    Some(schedule) =>
      schedule(() => {
        if self.runners.get(id) is Some(current) &&
          physical_equal(current, r) &&
          (r.stress_step)() {
          self.continue_stress(id, r)
        }
        (self.on_change)(id)
      })
    None =>
      while (r.stress_step)() {

      }
  }
}

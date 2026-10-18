///|
pub suberror PropertyFailed {
  PropertyFailed(String)
}

///|
/// Runs `prop` `count` times with fresh random states, raising with the seed and run on the
/// first failure. `prop` raises `Discard` to skip an input it can't use.
pub fn check_property(
  name : String,
  prop : (@splitmix.RandomState, Int32) -> Unit raise,
  count~ : Int32 = 100,
  size~ : Int32 = 10,
  seed~ : UInt64 = 42,
) -> Unit raise PropertyFailed {
  let rs = @splitmix.RandomState(seed~)
  let mut discarded = 0
  for run in 0..<count {
    let run_rs = rs.split()
    prop(run_rs, size) catch {
      Discard => discarded += 1
      e =>
        raise PropertyFailed(
          "\{name} failed on run \{run} (seed \{seed}, size \{size}):\n  \{e}",
        )
    }
  }
  if discarded == count {
    raise PropertyFailed("\{name}: every one of \{count} inputs was discarded")
  }
}

///|
/// Raised by a property for an input it can't use.
pub(all) suberror Discard {
  Discard
}

///|
pub(all) suberror Broke {
  Broke(String)
}

///|
fn[T : @quickcheck.Arbitrary] gen(
  rs : @splitmix.RandomState,
  size : Int32,
) -> T {
  @quickcheck.Arbitrary::arbitrary(size, rs)
}

///|
pub impl Show for PropertyFailed with fn output(self, logger) {
  let PropertyFailed(msg) = self
  logger.write_string(msg)
}

///|
pub impl Show for Broke with fn output(self, logger) {
  let Broke(msg) = self
  logger.write_string(msg)
}

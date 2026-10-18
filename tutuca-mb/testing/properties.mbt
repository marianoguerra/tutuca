// The generic properties of a component.

///|
/// What a failing input broke, or None when it passed or doesn't apply.
fn[T] failure_of(check : (T) -> Unit raise, input : T) -> String? {
  try check(input) catch {
    Discard => None
    e => Some(e.to_string())
  } noraise {
    _ => None
  }
}

///|
/// The smallest input `shrink` reaches from `input` that still fails, with what it broke.
fn[T] shrink_input(
  check : (T) -> Unit raise,
  input : T,
  problem : String,
  shrink : (T) -> Iter[T],
) -> (T, String) {
  let mut best = input
  let mut problem = problem
  let mut budget = 200
  let mut improved = true
  while improved && budget > 0 {
    improved = false
    for candidate in shrink(best) {
      budget -= 1
      if budget <= 0 {
        break
      }
      if failure_of(check, candidate) is Some(p) {
        best = candidate
        problem = p
        improved = true
        break
      }
    }
  }
  (best, problem)
}

///|
/// Runs `check` on `count` generated inputs; the first that fails is shrunk, when `shrink`
/// is given, and raised with its description.
fn[T] check_inputs(
  name : String,
  make : (@splitmix.RandomState, Int32) -> T,
  check : (T) -> Unit raise,
  show : (T) -> String,
  shrink : ((T) -> Iter[T])?,
  count : Int32,
  seed : UInt64,
) -> Unit raise PropertyFailed {
  let rs = @splitmix.RandomState(seed~)
  let mut discarded = 0
  for run in 0..<count {
    let input = make(rs.split(), 10)
    check(input) catch {
      Discard => discarded += 1
      e => {
        let (input, problem) = match shrink {
          Some(f) => shrink_input(check, input, e.to_string(), f)
          None => (input, e.to_string())
        }
        raise PropertyFailed(
          "\{name} failed on run \{run} (seed \{seed}) for\n  \{show(input)}\n  \{problem}",
        )
      }
    }
  }
  if discarded == count {
    raise PropertyFailed("\{name}: every one of \{count} inputs was discarded")
  }
}

///|
/// Checks that every view renders random states without a problem, and that random messages
/// on random states keep the component's contract and are deterministic. States that break
/// the component's invariants are discarded; pass `state` for invariants too sparse to reach
/// by chance. A failing state is shrunk with `shrink` (e.g. `@quickcheck.Shrink::shrink`).
pub fn[S : @quickcheck.Arbitrary + ToJson, M : @quickcheck.Arbitrary + Debug] check_component(
  comp : @tutuca.Component[S, M],
  state? : (@splitmix.RandomState, Int32) -> S,
  shrink? : (S) -> Iter[S],
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  count~ : Int32 = 50,
  seed~ : UInt64 = 42,
) -> Unit raise {
  comp.compile()
  let make = state.unwrap_or((rs, size) => gen(rs, size))
  let show_state = (s : S) => ToJson::to_json(s).stringify()
  for view in comp.view_names() {
    check_inputs(
      "\{comp.name}.\{view} renders",
      make,
      s => {
        let d = Driver::new(comp, s, scope~, view~)
        let problems = d.problems()
        if problems.iter().any(p => p is StateInvalid(_)) {
          raise Discard
        }
        if problems.length() > 0 {
          raise Broke(problems.map(describe).join("; "))
        }
      },
      show_state,
      shrink,
      count,
      seed,
    )
  }
  let shrink_pair = shrink.map(f => {
    (pair : (S, M)) => f(pair.0).map(s => (s, pair.1))
  })
  check_inputs(
    "\{comp.name} messages keep the contract and are deterministic",
    (rs, size) => {
      let s = make(rs, size)
      let msg : M = gen(rs, size)
      (s, msg)
    },
    pair => {
      let (s, msg) = pair
      let a = Driver::new(comp, s, scope~)
      if a.problems().length() > 0 {
        raise Discard
      }
      a.send(msg)
      let problems = a.problems()
      if problems.length() > 0 {
        raise Broke(problems.map(describe).join("; "))
      }
      let b = Driver::new(comp, s, scope~)
      b.send(msg)
      let (ja, jb) = (
        ToJson::to_json(a.state()).stringify(),
        ToJson::to_json(b.state()).stringify(),
      )
      if ja != jb {
        raise Broke("it gave different states:\n  \{ja}\n  \{jb}")
      }
    },
    pair => "\{show_state(pair.0)} with \{@debug.to_string(pair.1)}",
    shrink_pair,
    count,
    seed,
  )
}

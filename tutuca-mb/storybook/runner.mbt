// A story running on a host, with a timeline of states to go back and forth through: one entry
// per step and per user interaction.

///|
priv struct Entry[R] {
  label : String
  origin : String // "initial", "step", "user"
  mut state : R
  mut problems : Array[String]
  mut status : String // "ok", "failed", "skipped"
  error : String
  step_index : Int32? // The sequence step it ran.
  next_step : Int32
  tasks : Array[TaskView] // The tasks that made it.
}

///|
/// The outcome of a step.
pub(all) struct StepResult {
  status : String
  error : String
}

///|
/// What the UI shows of a running story.
pub(all) struct Summary {
  sequences : Array[String]
  sequence : String
  steps : Array[StepView]
  timeline : Array[EntryView]
  cursor : Int32
  problems : Array[String]
  error : String
  state : Json
  tasks : Array[TaskView] // The tasks that made the current entry.
  issues : Array[String] // What the check pass found in the story's component.
  lint : Array[@dev.LintRecord] // What the checks of the book's components found.
  specs : Array[@dev.SpecInfo] // The book's components, or the story's when it names none.
  spec : @dev.SpecInfo // The story's component, for the dev panel.
  stress : StressResult?
  targets : Array[TargetView]
} derive(Eq, Debug, ToJson)

///|
pub(all) struct StepView {
  label : String
  status : String // "pending", "ok", "failed", "skipped"
  is_next : Bool
} derive(Eq, Debug, ToJson)

///|
pub(all) struct EntryView {
  label : String
  origin : String
  problem_count : Int32
  is_current : Bool
} derive(Eq, Debug, ToJson)

///|
pub(all) struct StressResult {
  status : String // "running", "passed", "failed", "cancelled", "unavailable"
  runs : Int32 // How many runs it does.
  done : Int32 // How many it has done.
  error : String
  steps : Array[String] // The shrunk counterexample, loadable as the "counterexample" sequence.
} derive(Eq, Debug, ToJson)

///|
/// A task that made an entry: its kind, label, where it ran and the DOM event behind it.
pub(all) struct TaskView {
  kind : @tutuca.TaskKind
  label : String
  path : @tutuca.DispatchPath
  trigger : String?
} derive(Eq, Debug)

///|
pub impl ToJson for TaskView with fn to_json(self) {
  {
    "kind": Json::string(@debug.to_string(self.kind)),
    "label": Json::string(self.label),
    "path": Json::string(self.path.to_string()),
  }
}

///|
fn TaskView::of(t : @tutuca.Task) -> TaskView {
  { kind: t.kind, label: t.label, path: t.path, trigger: t.trigger, }
}

///|
/// The message of a task's label: "TodoTask.Toggle" → "Toggle".
fn TaskView::message(self : TaskView) -> String {
  match self.label.find(".") {
    Some(i) => self.label.view(start_offset=i + 1).to_owned()
    None => self.label
  }
}

///|
/// How JS labels a root task in the timeline: `click → toggle()`, or the call.
fn TaskView::entry_label(self : TaskView) -> String {
  let call = @dev.debug_call(self.message())
  match self.trigger {
    Some(e) => "\{e} → \{call}"
    None => call
  }
}

///|
/// Where the send form can send: a rendered component instance, labelled as JS labels it
/// (`TodoTask at .tasks[0]`), and the messages it takes.
pub(all) struct TargetView {
  name : String
  path : String
  messages : Array[MessageView]
} derive(Eq, Debug, ToJson)

///|
/// A message a target takes, as JS names it (`toggle`, `removeTask`), and the item keys a
/// signal it hears from a collection can come from.
pub(all) struct MessageView {
  name : String
  keys : Array[String]
} derive(Eq, Debug, ToJson)

///|
/// A running story's operations, as the UI asks for them.
pub struct Runner {
  load : (String) -> Unit
  goto : (Int32) -> Unit
  back : () -> Unit
  forward : () -> StepResult // Redo, else the next step; "done" when there is none.
  to_end : () -> Unit
  reset : () -> Unit
  random_step : (UInt64) -> StepResult
  stress : (Int32, Int32, UInt64, StressFrom) -> StressResult // runs, steps per run, seed
  stress_start : (Int32, Int32, UInt64, StressFrom) -> Unit // The same, run in batches.
  stress_events_start : (Int32, Int32, UInt64, StressFrom) -> Unit // DOM events, in batches.
  stress_step : () -> Bool // Runs the next batch; false once there is none.
  stress_cancel : () -> Unit
  send_to : (Int32, String, String, String) -> StepResult // target, message, args JSON, key
  sample_args : (Int32, String, UInt64) -> String // Generated args for a target's message.
  summary : () -> Summary
  dispose : () -> Unit
}

///|
/// Where a stress test's runs start.
pub(all) enum StressFrom {
  FromStory // The story's initial state.
  FromCurrent // The state the timeline is at.
  FromGenerated // Generated states, when the story has a generator.
} derive(Eq, Debug)

///|
fn[N : @vdom.DomNode] find_node(root : N, f : Find) -> N? {
  if f.selector is Some(sel) {
    return query_selector(root, sel) catch { _ => None }
  }
  let found = []
  fn walk(n : N) {
    for c in n.child_nodes() {
      let tag_ok = f.tag == "" || c.tag_name() == f.tag
      let attr_ok = match f.attr {
        Some((k, v)) => c.get_attribute(k) == Some(v)
        None => true
      }
      let text_ok = match f.text {
        Some(t) => text_of(c).trim() == t
        None => true
      }
      if c.tag_name() != "" && tag_ok && attr_ok && text_ok {
        found.push(c)
      }
      walk(c)
    }
  }

  walk(root)
  found.get(f.nth)
}

///|
fn[N : @vdom.DomNode] text_of(n : N) -> String {
  if n.tag_name() == "" {
    n.get_data()
  } else {
    n.child_nodes().map(c => text_of(c)).join("")
  }
}

///|
fn describe_all(reports : ArrayView[@tutuca.Report]) -> Array[String] {
  reports.iter().filter(@testing.is_problem).map(@testing.describe).to_array()
}

///|
fn[N : @vdom.DomNode, R : ToJson, M] make_runner(
  comp : @tutuca.Component[R, M],
  initial : R,
  sequences : Array[(String, Array[Step[R, M]])],
  targets : Array[@testing.Target[R, M]],
  generate : ((@splitmix.RandomState, Int32) -> R)?,
  scope : @tutuca.Scope,
  max_steps : Int32,
  doc : N,
  root : N,
  schedule : ((() -> Unit) -> Unit)?,
  changed : () -> Unit,
  connect : (@tutuca.Host[N]) -> Unit,
) -> Runner {
  let host = @tutuca.Host::new(doc, root, dev=true, scope~, schedule?)
  connect(host)
  let reports : Array[@tutuca.Report] = []
  let checked = comp.check()
  let issues = checked.map(i => i.to_string())
  let lint = @dev.lint_records(checked)
  let target_views = targets.map(t => {
    (
      if t.name == "root" {
        "\{comp.name} at ·"
      } else {
        t.name
      },
      message_names(
        if t.name == "root" {
          comp.message_names()
        } else {
          t.messages
        },
        t,
      ),
    )
  })
  let spec = @dev.SpecInfo::of(comp)
  // The tasks a step ran, for the entry it makes.
  let step_tasks : Array[TaskView] = []
  let busy = Ref(true)
  // The first render's reports are the initial entry's problems.
  host.set_on_report(r => reports.push(r))
  let app = Ref(host.start(comp, initial))
  let timeline : Array[Entry[R]] = [
    {
      label: "initial",
      origin: "initial",
      state: initial,
      problems: [],
      status: "ok",
      error: "",
      step_index: None,
      next_step: 0,
      tasks: [],
    },
  ]
  let cursor = Ref(0)
  let sequence = Ref(sequences.get(0).map(s => s.0).unwrap_or(""))
  let steps = Ref(sequences.get(0).map(s => s.1).unwrap_or([]))
  let last_stress : Ref[StressResult?] = Ref(None)
  // The last failed stress run, shrunk: its start state and steps.
  let counterexample : Ref[(R, Array[Step[R, M]])?] = Ref(None)
  // Why the last send didn't run, until the next one does.
  let send_error = Ref("")
  let current = () => timeline[cursor.val]
  // Problems a live interaction reports go to the entry it made.
  host.set_on_report(r => {
    reports.push(r)
    if busy.val {
      if r is TaskHandled(task) {
        step_tasks.push(TaskView::of(task))
      }
      return
    }
    match r {
      TaskHandled(task) => {
        let state = app.val.state()
        if task.kind is (Event | Send) {
          timeline.truncate(cursor.val + 1)
          let view = TaskView::of(task)
          timeline.push({
            label: view.entry_label(),
            origin: "user",
            state,
            problems: [],
            status: "ok",
            error: "",
            step_index: None,
            next_step: current().next_step,
            tasks: [view],
          })
          cursor.val = timeline.length() - 1
        } else {
          current().state = state
          current().tasks.push(TaskView::of(task))
        }
        changed()
      }
      r if @testing.is_problem(r) => {
        current().problems.push(@testing.describe(r))
        current().status = "failed"
      }
      _ => ()
    }
  })
  timeline[0].problems = describe_all(reports[:])
  busy.val = false
  let act = (f : () -> Unit) => {
    busy.val = true
    f()
    busy.val = false
  }
  let restart = (state : R) => {
    act(() => {
      host.stop()
      app.val = host.start(comp, state)
    })
  }
  let goto = (i : Int32) => {
    cursor.val = if i < 0 {
      0
    } else if i >= timeline.length() {
      timeline.length() - 1
    } else {
      i
    }
    restart(current().state)
  }
  let run_at = (step : Step[R, M], index : Int32?, next_step : Int32) => {
    let before = reports.length()
    step_tasks.clear()
    let mut status = "ok"
    let mut error = ""
    act(() => {
      match step {
        Send(_, msg) => app.val.send(msg)
        SendWith(_, f) => f(app.val)
        Event(_, name, target, value) =>
          match find_node(root, target) {
            Some(node) => {
              match value {
                Some(v) =>
                  if node.get_attribute("type") == Some("checkbox") {
                    ignore(node.set_property("checked", Bool(v == "true")))
                  } else {
                    ignore(node.set_property("value", Str(v)))
                  }
                None => ()
              }
              ignore(host.handle_event(node, name))
            }
            None => {
              status = "skipped"
              error = "nothing matches \{target.to_string()}"
            }
          }
        Check(label, pred) =>
          if !pred(app.val.state()) {
            status = "failed"
            error = "check failed: \{label}"
          }
      }
      host.drain()
    })
    let problems = describe_all(reports[before:])
    if status == "ok" && problems.length() > 0 {
      status = "failed"
      error = problems.join("\n")
    }
    timeline.truncate(cursor.val + 1)
    timeline.push({
      label: step.label(),
      origin: "step",
      state: app.val.state(),
      problems,
      status,
      error,
      step_index: index,
      next_step,
      tasks: step_tasks.copy(),
    })
    cursor.val = timeline.length() - 1
    { status, error, }
  }
  let forward = () => {
    if cursor.val < timeline.length() - 1 {
      goto(cursor.val + 1)
      return { status: "ok", error: "", }
    }
    let i = current().next_step
    match steps.val.get(i) {
      Some(step) => run_at(step, Some(i), i + 1)
      None => { status: "done", error: "", }
    }
  }
  // A stress test in progress: where runs start, and what is left.
  let stress_job : Ref[StressJob[R]?] = Ref(None)
  let start_stress = (
    runs : Int32,
    steps_per_run : Int32,
    seed : UInt64,
    from : StressFrom,
    events : Bool,
  ) => {
    // 0 asks for the story's own length, as JS's maxCommands.
    let steps_per_run = if steps_per_run <= 0 {
      max_steps
    } else {
      steps_per_run
    }
    let current_state = app.val.state()
    let story_state = timeline[0].state
    let start : ((@splitmix.RandomState, Int32) -> R)? = match from {
      FromStory => Some((_, _) => story_state)
      FromCurrent => Some((_, _) => current_state)
      FromGenerated => generate
    }
    match start {
      None => {
        stress_job.val = None
        last_stress.val = Some({
          status: "unavailable",
          runs: 0,
          done: 0,
          error: "the story has no state generator; give story(..., generate=...)",
          steps: [],
        })
      }
      Some(start) => {
        stress_job.val = Some({
          start,
          runs,
          steps_per_run,
          seed,
          done: 0,
          events,
        })
        last_stress.val = Some({
          status: "running",
          runs,
          done: 0,
          error: "",
          steps: [],
        })
      }
    }
  }
  // Runs the next batch of a stress test; false once it is over.
  let step_stress = () => {
    guard stress_job.val is Some(job) else { return false }
    let batch = if job.runs - job.done < 10 { job.runs - job.done } else { 10 }
    if job.events {
      let seed = job.seed + job.done.to_uint64()
      let start = (job.start)(@splitmix.RandomState(seed~), 10)
      let done = job.done + batch
      let error : String? = try
        @testing.run_events(
          comp,
          () => start,
          scope~,
          count=batch,
          steps=job.steps_per_run,
          seed~,
        )
      catch {
        @testing.PropertyFailed(msg) => Some(msg)
      } noraise {
        _ => None
      }
      let status = if error is Some(_) {
        "failed"
      } else if done >= job.runs {
        "passed"
      } else {
        "running"
      }
      stress_job.val = if status == "running" {
        Some({ ..job, done, })
      } else {
        None
      }
      last_stress.val = Some({
        status,
        runs: job.runs,
        done,
        error: error.unwrap_or(""),
        steps: [],
      })
      return status == "running"
    }
    let found = @testing.find_failure(
      comp,
      job.start,
      targets,
      scope~,
      count=batch,
      steps=job.steps_per_run,
      seed=job.seed + job.done.to_uint64(),
    )
    let done = job.done + batch
    match found {
      Some(failure) => {
        counterexample.val = Some(
          (
            failure.start,
            failure.steps.map(s => {
              SendWith(js_label(comp.name, s.label), a => (s.send_app)(a))
            }),
          ),
        )
        stress_job.val = None
        last_stress.val = Some({
          status: "failed",
          runs: job.runs,
          done,
          error: failure.describe(),
          steps: failure.steps.map(s => js_label(comp.name, s.label)),
        })
        false
      }
      None if done >= job.runs => {
        stress_job.val = None
        last_stress.val = Some({
          status: "passed",
          runs: job.runs,
          done,
          error: "",
          steps: [],
        })
        false
      }
      None => {
        stress_job.val = Some({ ..job, done, })
        last_stress.val = Some({
          status: "running",
          runs: job.runs,
          done,
          error: "",
          steps: [],
        })
        true
      }
    }
  }
  let status_of = (i : Int32) => {
    for j = timeline.length() - 1; j >= 0; j = j - 1 {
      if timeline[j].step_index == Some(i) {
        return timeline[j].status
      }
    }
    "pending"
  }
  {
    load: name => {
      sequence.val = name
      let first = match (name, counterexample.val) {
        ("counterexample", Some((start, cx_steps))) => {
          steps.val = cx_steps
          { ..timeline[0], state: start, label: "counterexample start", }
        }
        _ => {
          steps.val = sequences
            .iter()
            .find_first(s => s.0 == name)
            .map(s => s.1)
            .unwrap_or([])
          timeline[0]
        }
      }
      timeline.clear()
      timeline.push(first)
      goto(0)
    },
    goto,
    back: () => goto(cursor.val - 1),
    forward,
    to_end: () => {
      if cursor.val < timeline.length() - 1 {
        goto(timeline.length() - 1)
      }
      while forward().status == "ok" && current().next_step < steps.val.length() {

      }
    },
    reset: () => goto(0),
    random_step: seed => {
      guard targets.length() > 0 else {
        return { status: "skipped", error: "the story has no stress targets", }
      }
      let rs = @splitmix.RandomState(seed~)
      for _ in 0..<30 {
        let i = rs
          .next_uint(limit=targets.length().reinterpret_as_uint())
          .reinterpret_as_int()
        let made = match targets[i].app_step {
          Some(f) => f(app.val, rs, 10)
          None => (targets[i].step)(app.val.state(), rs, 10)
        }
        if made is Some(s) {
          let next = current().next_step
          let label = if targets[i].app_step is Some(_) {
            s.label
          } else {
            js_label(target_views[i].0, s.label)
          }
          return run_at(SendWith(label, a => (s.send_app)(a)), None, next)
        }
      }
      {
        status: "skipped",
        error: "no generated message applies to the current state",
      }
    },
    stress: (runs, steps_per_run, seed, from) => {
      start_stress(runs, steps_per_run, seed, from, false)
      while step_stress() {

      }
      last_stress.val.unwrap()
    },
    stress_start: (runs, steps, seed, from) => {
      start_stress(runs, steps, seed, from, false)
    },
    stress_events_start: (runs, steps, seed, from) => {
      start_stress(runs, steps, seed, from, true)
    },
    stress_step: step_stress,
    stress_cancel: () => {
      match last_stress.val {
        Some({ status: "running", .. } as r) => {
          stress_job.val = None
          last_stress.val = Some({ ..r, status: "cancelled", })
        }
        _ => ()
      }
    },
    send_to: (index, name, args, key) => {
      guard host.instances().get(index) is Some(node) else {
        return { status: "failed", error: "no target #\{index}", }
      }
      let parsed = @json.parse(if args.trim() == "" { "[]" } else { args }) catch {
        _ => {
          send_error.val = "args must be a JSON array"
          return { status: "failed", error: send_error.val, }
        }
      }
      guard parsed is Array(xs) else {
        send_error.val = "args must be a JSON array"
        return { status: "failed", error: send_error.val, }
      }
      let task = (node.message_task)(name, xs, key) catch {
        e => {
          send_error.val = "that message doesn't read: \{e}"
          return { status: "failed", error: send_error.val, }
        }
      }
      send_error.val = ""
      let shown = xs.iter().map(a => a.stringify()).collect().join(", ")
      let shown = if shown.length() > 80 {
        shown.view(end_offset=80).to_owned() + "…"
      } else {
        shown
      }
      let label = "\{node.name} at \{node.home.to_string()}.\{name}(\{shown})"
      run_at(
        SendWith(label, _ => host.push_task(task)),
        None,
        current().next_step,
      )
    },
    sample_args: (index, name, seed) => {
      match host.instances().get(index) {
        Some(node) => Json::array((node.sample_args)(name, seed)).stringify()
        None => "[]"
      }
    },
    summary: () => {
      let cur = current()
      {
        sequences: if counterexample.val is Some(_) {
          [..sequences.map(s => s.0), "counterexample"]
        } else {
          sequences.map(s => s.0)
        },
        sequence: sequence.val,
        steps: steps.val.mapi((i, s) => {
          label: s.label(),
          status: status_of(i),
          is_next: i == cur.next_step,
        }),
        timeline: timeline.mapi((i, e) => {
          label: e.label,
          origin: e.origin,
          problem_count: e.problems.length(),
          is_current: i == cursor.val,
        }),
        cursor: cursor.val,
        problems: if cur.problems.is_empty() && cur.error != "" {
          [cur.error]
        } else {
          cur.problems
        },
        error: if send_error.val != "" {
          send_error.val
        } else if cur.status == "ok" {
          ""
        } else {
          cur.error
        },
        state: ToJson::to_json(cur.state),
        tasks: cur.tasks,
        issues,
        lint,
        spec,
        stress: last_stress.val,
        specs: [spec],
        targets: host
        .instances()
        .map(node => {
          name: "\{node.name} at \{node.home.to_string()}",
          path: node.home.to_string(),
          messages: node.messages.map(m => { name: m, keys: (node.keys_of)(m), }),
        }),
      }
    },
    dispose: () => host.stop(),
  }
}

///|
priv struct StressJob[R] {
  start : (@splitmix.RandomState, Int32) -> R
  runs : Int32
  steps_per_run : Int32
  seed : UInt64
  done : Int32
  events : Bool // DOM events instead of messages.
}

///|
/// The names of the messages a target sends, as JS names them: the ones its component
/// declares that it makes, in their order, else the ones samples of it show, sorted.
fn[R, M] message_names(
  declared : Array[String],
  target : @testing.Target[R, M],
) -> Array[String] {
  let seen = []
  let rs = @splitmix.RandomState(seed=7)
  for _ in 0..<300 {
    let msg = @json.parse((target.sample)(rs, 5)) catch { _ => continue }
    let name = match msg {
      String(n) => n
      Array(parts) if parts.get(0) is Some(String(n)) => n
      _ => continue
    }
    if !seen.contains(name) {
      seen.push(name)
    }
  }
  let names = if declared.is_empty() {
    seen.sort_by((a, b) => a.lexical_compare(b))
    seen
  } else {
    declared.filter(n => seen.contains(n))
  }
  names.map(@dev.js_name)
}

///|
/// A generated step's label as JS labels its commands: `Tally at ·.up()`, from the
/// testing label (`· Up`, `.items[0] Toggle`) and the target's name (its component first).
fn js_label(target : String, label : String) -> String {
  guard label.find(" ") is Some(i) else { return label }
  let place = label.view(end_offset=i).to_owned()
  let debug = label.view(start_offset=i + 1).to_owned()
  let comp = match target.find(" ") {
    Some(j) => target.view(end_offset=j).to_owned()
    None => target
  }
  "\{comp} at \{place}.\{@dev.debug_call(debug)}"
}

// Stories, typed where they are written and erased into Story[N] for books.

///|
/// Which element an event step targets: the first a CSS selector matches (`css`), as JS's
/// steps find theirs, or the `nth` element with this tag (any tag when ""), and this attribute
/// value or text when given.
pub(all) struct Find {
  tag : String
  attr : (String, String)?
  text : String? // The element's whole text, trimmed.
  nth : Int32
  selector : String?
}

///|
pub fn find(
  tag : String,
  attr? : (String, String),
  text? : String,
  nth~ : Int32 = 0,
) -> Find {
  { tag: tag.to_upper(), attr, text, nth, selector: None, }
}

///|
/// The first element `selector` matches, as JS's `querySelector`: tags, `#id`, `.class`,
/// `[attr]`, `[attr="v"]` (`^=`, `*=`, `$=`, `~=`), `:nth-of-type(n)` and descendants.
pub fn css(selector : String) -> Find {
  { tag: "", attr: None, text: None, nth: 0, selector: Some(selector), }
}

///|
pub fn Find::to_string(self : Find) -> String {
  if self.selector is Some(s) {
    return s
  }
  let tag = if self.tag == "" { "*" } else { self.tag.to_lower() }
  let attr = match self.attr {
    Some((k, v)) => "[\{k}=\"\{v}\"]"
    None => ""
  }
  let text = match self.text {
    Some(t) => ":text(\{t})"
    None => ""
  }
  let nth = if self.nth == 0 { "" } else { ":nth(\{self.nth})" }
  "\{tag}\{attr}\{text}\{nth}"
}

///|
/// A step of a sequence.
pub enum Step[R, M] {
  Send(String, M) // To the root.
  SendWith(String, (@tutuca.App[R, M]) -> Unit) // E.g. app.send_to(child, lens, msg).
  Event(String, String, Find, String?) // Label, event, target, field value to set first.
  Check(String, (R) -> Bool)
}

///|
pub fn[R, M : ToJson] send(msg : M, label? : String) -> Step[R, M] {
  Send(label.unwrap_or("·.\{@dev.message_call(msg.to_json())}"), msg)
}

///|
pub fn[R, M, C, CM : ToJson] send_to(
  comp : @tutuca.Component[C, CM],
  lens : @tutuca.Lens[R, C],
  msg : CM,
  label? : String,
) -> Step[R, M] {
  SendWith(
    label.unwrap_or(
      ".\{lens.name}\{lens.slot.map(s => s.to_string()).unwrap_or("")}.\{@dev.message_call(msg.to_json())}",
    ),
    app => app.send_to(comp, lens, msg),
  )
}

///|
/// `sig` with `payload` delivered to the root, from the child `from` reaches when given: what
/// JS sends as a notification handler's message (`step.send("moveTask", [1], { from })`).
pub fn[R, M, T : ToJson, C] hear(
  sig : @tutuca.Signal[T],
  payload : T,
  from? : @tutuca.Lens[R, C],
  label? : String,
) -> Step[R, M] {
  let args = match payload.to_json() {
    Null => ""
    v => v.stringify()
  }
  SendWith(label.unwrap_or("·.\{sig.name}(\{args})"), app => {
    app.hear(sig, payload, from?)
  })
}

///|
/// An event on the element `target` finds; `value` is set on the field first, as typing would.
pub fn[R, M] event(
  name : String,
  target : Find,
  value? : String,
  label? : String,
) -> Step[R, M] {
  Event(
    label.unwrap_or("\{name} on \{target.to_string()}"),
    name,
    target,
    value,
  )
}

///|
pub fn[R, M] check(label : String, pred : (R) -> Bool) -> Step[R, M] {
  Check(label, pred)
}

///|
pub fn[R, M] Step::label(self : Step[R, M]) -> String {
  match self {
    Send(l, _) | SendWith(l, _) | Event(l, _, _, _) | Check(l, _) => l
  }
}

///|
/// What the UI and checks see of a story: its types are hidden in the closures.
pub struct Story[N] {
  id : String
  name : String
  group : String
  sequences : Array[String]
  issues : Array[@tutuca.Issue]
  /// Whether its state is generated (`generated_story`), so a preview's seed picks it.
  is_generated : Bool
  /// Whether it was given stress targets: `check_books` stress tests only those, as JS's
  /// stories with a `pbt` config.
  stressed : Bool
  /// Whether its stress tests send DOM events (JS's `pbt: { events: true }`): `check_books`
  /// runs those, and the UI's message stress tests send any message, as JS's.
  events : Bool
  /// The components of its book, for the dev panel.
  specs : Array[@dev.SpecInfo]
  /// How many messages a stress run sends at most: JS's `pbt.maxCommands`.
  max_steps : Int32
  /// A runner on `root`, a node of `doc`, its state drawn with `seed` when the story's are
  /// generated; `schedule` makes it live for a user, and `changed` hears what the user does
  /// in it; `connect` wires the host to its DOM.
  runner : (
    UInt64,
    N,
    N,
    ((() -> Unit) -> Unit)?,
    () -> Unit,
    (@tutuca.Host[N]) -> Unit,
  ) -> Runner
  /// Runs every sequence on a fresh host, raising at the first step that isn't ok.
  check_sequences : () -> Unit raise
}

///|
/// A story of `comp`: its initial state, sequences of steps and the targets random
/// messages go to in stress tests (the root, by default, as JS sends any of a story's
/// messages; only stories given targets are stress tested by `check_books`). `asks`
/// registers the ask handlers it needs.
pub fn[N : @vdom.DomNode, R : ToJson, M] story(
  name : String,
  comp : @tutuca.Component[R, M],
  make : () -> R,
  sequences~ : Array[(String, Array[Step[R, M]])] = [],
  targets? : Array[@testing.Target[R, M]],
  generate? : (@splitmix.RandomState, Int32) -> R,
  asks~ : (@tutuca.Scope) -> Unit = _ => (),
  max_steps~ : Int32 = 20,
  events~ : Bool = false,
) -> Story[N] {
  seeded_story(
    name,
    comp,
    _ => make(),
    sequences~,
    targets=targets.unwrap_or([@testing.any_instance()]),
    stressed=targets is Some(_) || events,
    events~,
    generate?,
    asks~,
    max_steps~,
  )
}

///|
/// A story whose state is generated, as JS's stories with `arbitrary` and no `make`: a
/// preview keyed `id@seed` draws it with that seed, and its checks with seed 0. Its stress
/// tests can start from generated states too.
pub fn[N : @vdom.DomNode, R : ToJson, M] generated_story(
  name : String,
  comp : @tutuca.Component[R, M],
  generate : (@splitmix.RandomState, Int32) -> R,
  sequences~ : Array[(String, Array[Step[R, M]])] = [],
  targets? : Array[@testing.Target[R, M]],
  size~ : Int32 = 10,
  asks~ : (@tutuca.Scope) -> Unit = _ => (),
  max_steps~ : Int32 = 20,
  events~ : Bool = false,
) -> Story[N] {
  seeded_story(
    name,
    comp,
    is_generated=true,
    seed => generate(@splitmix.RandomState(seed~), size),
    sequences~,
    targets=targets.unwrap_or([@testing.any_instance()]),
    stressed=targets is Some(_) || events,
    events~,
    generate~,
    asks~,
    max_steps~,
  )
}

///|
fn[N : @vdom.DomNode, R : ToJson, M] seeded_story(
  name : String,
  comp : @tutuca.Component[R, M],
  make : (UInt64) -> R,
  sequences~ : Array[(String, Array[Step[R, M]])],
  targets~ : Array[@testing.Target[R, M]],
  stressed~ : Bool,
  events~ : Bool,
  generate? : (@splitmix.RandomState, Int32) -> R,
  asks~ : (@tutuca.Scope) -> Unit,
  max_steps~ : Int32,
  is_generated~ : Bool = false,
) -> Story[N] {
  let scope = () => {
    let s = @tutuca.Scope::new()
    asks(s)
    s
  }
  {
    id: name,
    name,
    group: "",
    sequences: sequences.map(s => s.0),
    issues: comp.check(),
    is_generated,
    stressed,
    events,
    specs: [],
    max_steps,
    runner: (seed, doc, root, schedule, changed, connect) => {
      make_runner(
        comp,
        make(seed),
        sequences,
        targets,
        generate,
        scope(),
        max_steps,
        doc,
        root,
        schedule,
        changed,
        connect,
      )
    },
    check_sequences: () => {
      let doc = @memdom.document()
      for seq in sequences {
        let (seq_name, steps) = seq
        let runner = make_runner(
          comp,
          make(0),
          sequences,
          targets,
          generate,
          scope(),
          max_steps,
          doc,
          doc.element("main"),
          None,
          () => (),
          _ => (),
        )
        let initial = (runner.summary)().problems
        if initial.length() > 0 {
          raise StoryFailed("\{name}: initial state: \{initial.join("; ")}")
        }
        (runner.load)(seq_name)
        for i, step in steps {
          let r = (runner.forward)()
          if r.status != "ok" {
            raise StoryFailed(
              "\{name} › \{seq_name} › \{i + 1}. \{step.label()}: \{r.status} \{r.error}",
            )
          }
        }
      }
    },
  }
}

///|
pub(all) suberror StoryFailed {
  StoryFailed(String)
}

///|
pub impl Show for StoryFailed with fn output(self, logger) {
  let StoryFailed(msg) = self
  logger.write_string(msg)
}

///|
/// A titled group of stories; story ids become "title/name".
pub struct Book[N] {
  title : String
  stories : Array[Story[N]]
}

///|
/// `specs` are the components its stories use, as JS books register them, for the dev panel.
pub fn[N] book(
  title : String,
  stories : Array[Story[N]],
  specs~ : Array[@dev.SpecInfo] = [],
) -> Book[N] {
  {
    title,
    stories: stories.map(s => {
      ..s,
      id: "\{title}/\{s.name}",
      group: title,
      specs,
    }),
  }
}

///|
/// Checks that every story of the books starts valid and renders, that its component checks
/// clean, and every sequence; `stress` runs that many stress runs from each story's state too
/// (none by default), of `steps` messages, or the story's `max_steps`. Failures name the story by its id.
pub fn check_books(
  books : Array[Book[@memdom.MemNode]],
  stress~ : Int32 = 0,
  steps? : Int32,
  seed~ : UInt64 = 1,
) -> Unit raise {
  for b in books {
    for s in b.stories {
      if s.issues.length() > 0 {
        raise StoryFailed(
          "\{s.id}: " + s.issues.map(i => i.to_string()).join("; "),
        )
      }
      let doc = @memdom.document()
      let root = doc.element("main")
      let runner = (s.runner)(0, doc, root, None, () => (), _ => ())
      let summary = (runner.summary)()
      (runner.dispose)()
      if summary.problems.length() > 0 {
        raise StoryFailed(
          "\{s.id}: initial state: \{summary.problems.join("; ")}",
        )
      }
      if root.child_nodes().is_empty() {
        raise StoryFailed("\{s.id}: renders nothing")
      }
      (s.check_sequences)() catch {
        StoryFailed(msg) => raise StoryFailed("\{b.title}/\{msg}")
        e => raise e
      }
      if stress > 0 && s.stressed {
        let runner = (s.runner)(0, doc, doc.element("main"), None, () => (), _ => {
          ()
        })
        let steps = steps.unwrap_or(s.max_steps)
        let r = if s.events {
          (runner.stress_events_start)(stress, steps, seed, FromStory)
          while (runner.stress_step)() {

          }
          (runner.summary)().stress.unwrap()
        } else {
          (runner.stress)(stress, steps, seed, FromStory)
        }
        (runner.dispose)()
        if r.status == "failed" {
          raise StoryFailed("\{s.id}: stress test failed: \{r.error}")
        }
      }
    }
  }
}

///|
/// An initial state drawn from `generate` with `seed`, for a story of generated states: the
/// same seed gives the same state.
pub fn[R] sampled(
  generate : (@splitmix.RandomState, Int32) -> R,
  seed~ : UInt64 = 0,
  size~ : Int32 = 10,
) -> () -> R {
  () => generate(@splitmix.RandomState(seed~), size)
}

///|
/// A component's spec, for a book's `specs`.
pub fn[S, M] spec(comp : @tutuca.Component[S, M]) -> @dev.SpecInfo {
  @dev.SpecInfo::of(comp)
}

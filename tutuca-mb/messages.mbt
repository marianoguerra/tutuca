// What a component says about its messages, for the dev tools and the storybook's form: their
// names as JS names them (`toggle`, `setTitle`), in the order JS lists a component's `on`
// handlers, with the signals it hears and the ask replies it takes among them, and how to
// make each from JSON, so the form can send one to any rendered instance.

///|
/// A signal a component lists among its messages: sending it delivers its payload, read from
/// JSON, to an instance's listener, as a notification from below.
pub struct Heard {
  name : String
  deliver : (Node, DispatchPath, Json) -> Task raise
}

///|
/// Lists `sig` among a component's messages (`json_messages(heard=[...])`).
pub fn[T : FromJson] heard(sig : Signal[T]) -> Heard {
  {
    name: sig.name,
    deliver: (node, source, payload) => {
      let value : T = @json.from_json(payload)
      notify_task(sig, value, source, node)
    },
  }
}

///|
/// The message variant that takes the replies of `ask`, which JS names `xReplyOk`,
/// `xReplyError` and `xHandlerNotFound` (`json_messages(replies=[...])`).
pub fn[A, R] reply(variant : String, ask : Ask[A, R]) -> (String, String) {
  (variant, ask.name)
}

///|
/// A component's messages: their names, as JS's, and how to make one from JSON.
pub struct Messages[M] {
  names : Array[String]
  decode : (String, Array[Json]) -> M raise
  heard : Array[Heard]
  /// Generated args for a message, as JSON, from a seed.
  sample : (String, UInt64) -> Array[Json]
}

///|
/// No messages declared: the component's listened signals are all the dev tools show.
fn[M] no_messages() -> Messages[M] {
  {
    names: [],
    decode: (name, _) => fail("\{name}: the component declares no messages"),
    heard: [],
    sample: (_, _) => [],
  }
}

///|
/// A name as JS writes a message's: the first letter lowered.
fn js_style(name : String) -> String {
  match name.get_char(0) {
    Some(c) if c >= 'A' && c <= 'Z' =>
      c.to_string().to_lower() + name.view(start_offset=1).to_owned()
    _ => name
  }
}

///|
/// A component's messages, by their variants' names (`"Toggle"`, `"SetTitle"`), the names of
/// the signals it lists (`heard`) and the variants that take ask replies (`replies`), in the
/// order its handlers read. They are sent as their JSON (`"Toggle"`, `["SetTitle", "x"]`).
pub fn[M : FromJson + ToJson + @quickcheck.Arbitrary] json_messages(
  names : Array[String],
  heard~ : Array[Heard] = [],
  replies~ : Array[(String, String)] = [],
) -> Messages[M] {
  // Each shown name and the JSON it makes from args.
  let shown : Array[(String, (Array[Json]) -> Json)] = []
  for n in names {
    if heard.iter().any(h => h.name == n) {
      shown.push((n, args => Json::array(args)))
      continue
    }
    match replies.iter().find_first(r => r.0 == n) {
      Some((variant, ask)) => {
        let first = (args : Array[Json]) => args.get(0).unwrap_or(Json::null())
        shown.push(("\{ask}ReplyOk", args => [variant, ["Ok", first(args)]]))
        shown.push(
          ("\{ask}ReplyError", args => [variant, ["Err", first(args)]]),
        )
        shown.push(("\{ask}HandlerNotFound", _ => [variant, "NotFound"]))
      }
      None =>
        shown.push(
          (
            js_style(n),
            args => {
              if args.is_empty() {
                Json::string(n)
              } else {
                Json::array([Json::string(n), ..args])
              }
            },
          ),
        )
    }
  }
  {
    names: shown.map(e => e.0),
    decode: (name, args) => {
      match shown.iter().find_first(e => e.0 == name) {
        Some((_, make)) => @json.from_json(make(args))
        None => fail("no message \{name}")
      }
    },
    heard,
    sample: (name, seed) => {
      let rs = @splitmix.RandomState(seed~)
      for _ in 0..<200 {
        let msg : M = @quickcheck.Arbitrary::arbitrary(5, rs)
        match ToJson::to_json(msg) {
          String(n) if js_style(n) == name => return []
          Array([String(n), .. args]) if js_style(n) == name =>
            return args.to_owned()
          _ => ()
        }
      }
      []
    },
  }
}

///|
/// A child component a component's state holds, for listing the instances in a state as JS
/// does (the storybook's form sends to any of them, rendered or not).
pub struct Child[S] {
  priv walk : (Route[S], Node) -> Array[Node]
  priv selves : (Route[S]) -> Array[Route[S]] // Children of the component's own type.
}

///|
/// The child `comp` that `lens` reaches, when it finds one.
pub fn[S, C, CM] child(comp : Component[C, CM], lens : Lens[S, C]) -> Child[S] {
  {
    walk: (route, parent) => {
      let r = route.focus(lens)
      match (r.get)() {
        Some(_) => comp.instances_at(r, parent)
        None => []
      }
    },
    selves: _ => [],
  }
}

///|
/// Each item of `items`, a `comp`.
pub fn[S, K, C, CM] each_child(
  comp : Component[C, CM],
  items : Items[S, K, C],
) -> Child[S] {
  {
    walk: (route, parent) => {
      match (route.get)() {
        Some(s) =>
          (items.entries)(s)
          .to_array()
          .map(e => comp.instances_at(route.focus(items.at(e.0)), parent))
          .flatten()
        None => []
      }
    },
    selves: _ => [],
  }
}

///|
/// Each item of `items`, an instance of the component itself (`render_self_each`'s).
pub fn[S, K] each_self(items : Items[S, K, S]) -> Child[S] {
  {
    walk: (_, _) => [],
    selves: route => {
      match (route.get)() {
        Some(s) =>
          (items.entries)(s).to_array().map(e => route.focus(items.at(e.0)))
        None => []
      }
    },
  }
}

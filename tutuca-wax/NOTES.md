The port of tutuca to wasm (using wax as the compilation target and language to implement the runtime in) should have the following charasteristics:

Given that any component should compose with any other component and all should share the same interface and types the core component type is a single type that all components implement.

It contains a reference to a component spec type that describes the "shape" of that component, it serves as the "class" for the component, to check if two components are of the same
type you can compare the spec instance by reference equality, later structural spec equality could be implemented but it's outside the scope of the MVP.

The component also has an opaque reference to the component instance, a component instance can be also compared for reference equality to check if the component changed (updates should return a new instance, if the same reference is returned semantically it means that the component instance didn't change).

The component also has a "vtable" that the component type provides with function reference to handle messages and property access.

All messages are handled through a single function that receives a message type that has a name and an array of value types the function does the routing from message to internal handlers in any way it feels like but they all adhere to the same interface, like the js implentation they return a value indicating if nothing changed, if there's a new instance for the component or if the component should be swapped for another one (of another type).

There's also a callback to handle property access (one for get, one for set). the handler again implements the logic however it likes but all implementations adhere to the same interface returning a value indicating if the property access can be handled or not (property doesn't exist, is not of the right type etc).

The "vtable" also provides an init function that takes a map of values and returns an instance, it should gracefully handle missing values or values of the wrong type or the right type that don't satisfy all the field conditions (out of range etc.)

Properties their types and access type (get, set or get/set), message handlers and their types, init arguments schema are specified in the schema, so they can be checked before calling but the handlers should handle messages and property access for undefined or invalid calls anyway assuming the caller doesn't do the check against the schema.

Message handlers receive an array of values and a context, the context type is the same for all components and is specified in the prelude along with the other runtime types (component, spec, scope, etc.)

The component also has a reference to the scope where it's defined, a component type can be instantiated in more than one scope so the scope reference is per instance, this means
that a component that requests an instance of a type by name can get a different component instance depending on the scope where it's instantiated (it can also get an error if the name doesn't have a registered component type for some scopes)

Here is a definition of the core tutuca value type defined in Moonbit syntax for simplicity:

```moonbit
/// A tutuca value: what fields hold, messages carry as arguments, properties
/// get and set, and init receives in its map of values.
enum Value {
  // Scalars, the leaves of JS's t.string / t.boolean / t.number and
  // tutuca-mb's Text / Boolean / Number / Whole field types.
  Null                // Also "no value" for optional fields (t.option, FieldType::Optional).
  Bool(Bool)
  Int(Int)            // Whole numbers (t.number().integer(), FieldType::Whole).
  Float(Double)       // Numbers (t.number(), FieldType::Number).
  String(String)

  // Collections, vendored and adapted from wax-mb's stdlib/collections:
  // List is the persistent vector (pv_vector, 32-way trie with a tail),
  // Map the persistent hash map (phm_map, a 32-way HAMT) with String keys.
  // Both are persistent, so an update returns a new value and the old one
  // stays usable; reference equality on the collection tells if it changed.
  List(List[Value])
  Map(Map[String, Value])

  // The outcome of something that can fail, e.g. an ask's answer:
  // Ok carries the value, Err a value describing the error.
  Result(Result[Value, Value])

  // A component (spec, instance, vtable, scope), as described above, so
  // fields can hold child components (t.component, FieldType::ComponentOf).
  Component(Component)
}
```

Notes on the representation in wax:

- The vendored collections store `&?eq`, so each `Value` case is a struct in
  the `eq` hierarchy (a subtype of a common `value` struct carrying a tag), and
  `List`/`Map` hold those references directly. Null is a single shared
  instance, not a wasm `null`, so a missing map entry (`found = 0`) stays
  distinct from an entry holding `Null`.
- Map keys are the String case, so the map is created with a hash/equal pair
  over strings (`wax_hash_bytes_key` / `wax_equal_bytes_key` adapted to the
  string representation), fixed by the vendored copy instead of passed per map.
- The adaptation renames the `phm_`/`pv_` prefixes to the runtime's, types the
  APIs over `&value` instead of `&?eq` where the call sites allow it, and keeps
  the transient APIs for building lists and maps in init and in handlers.
- Records (t.record) and one-ofs (t.oneOf, t.enum) aren't value cases: a record
  is a `Map` the schema checks the keys of, a one-of is a value the schema
  checks against its alternatives, and an enum is a `String` from a fixed set.

The component runtime types, in the same MoonBit syntax:

```moonbit
/// The state of a component instance: opaque to the runtime, which only hands
/// it back to the vtable and compares it by reference to tell if it changed.
#external
type Instance

/// A component: the one type every component is, so any component composes
/// with any other.
struct Component {
  /// The component's "class": two components are of the same type when their
  /// specs are the same reference.
  spec : ComponentSpec
  /// A new reference means a new state, the same reference no change.
  instance : Instance
  /// The functions the component type provides, shared by all its instances.
  vtable : VTable
  /// Per instance: the same type can be instantiated in more than one scope,
  /// and resolving a type by name depends on the scope.
  scope : Scope
}

/// The shape of a component type: what can be checked before calling its
/// vtable. The vtable handles calls the spec rejects anyway, since the caller
/// may not check.
struct ComponentSpec {
  name : String
  properties : Map[String, PropertySpec]
  messages : Map[String, MessageSpec]
  /// The values init takes, by name.
  init : Map[String, FieldSpec]
  /// Its views, as data (the spec's view.rkt expressions), one of them
  /// "main"; rendering a component evaluates one of them.
  views : Map[String, View]
  /// The hooks its views' loops and scopes name.
  loops : Map[String, Loop]
  scopes : Map[String, ScopeDef]
  /// The event handlers of the elements its views render, by template id,
  /// collected from the views: an element with handlers renders data-eid,
  /// and routing an event looks its handlers up here.
  handlers : Map[Int, Array[OnAttr]]
  /// The values it provides to the components rendered below it, by name:
  /// selectors frozen against it when a render enters it.
  provides : Map[String, Selector]
}

struct PropertySpec {
  ty : ValueType
  access : Access
}

enum Access {
  Get
  Set
  GetSet
}

struct MessageSpec {
  args : Array[ArgSpec]
}

struct ArgSpec {
  name : String
  ty : ValueType
}

/// An init value: init uses the default when it's missing or invalid.
struct FieldSpec {
  ty : ValueType
  constraints : Array[Constraint]
  default : Value
}

/// The type of a value, as JS's t.* and tutuca-mb's FieldType describe it.
enum ValueType {
  Any
  Null
  Bool
  Int
  Float
  String
  ListOf(ValueType)
  MapOf(ValueType)
  RecordOf(Map[String, ValueType]) // A Map with these keys.
  Enum(Array[String]) // A String from this set.
  OneOf(Array[ValueType])
  Optional(ValueType) // The type or Null.
  ResultOf(ValueType, ValueType)
  ComponentOf(Array[String]) // A component of one of these types, by name.
}

/// What a value must also be beyond its type.
enum Constraint {
  AtLeast(Double)
  AtMost(Double)
  MinLength(Int)
  MaxLength(Int)
  Matching(String)
}

/// A message: its name and arguments, routed by the component's handle.
struct Message {
  name : String
  args : Array[Value]
}

/// What handling a message did.
enum MessageResult {
  Unchanged
  /// A new state for the same component type.
  Updated(Instance)
  /// Replace the component with another one, possibly of another type.
  Swapped(Component)
  /// The message can't be handled: unknown, wrong arguments, or it failed.
  Rejected(MessageError)
}

enum MessageError {
  UnknownMessage
  WrongArity(expected~ : Int, got~ : Int)
  WrongArgType(index~ : Int, expected~ : ValueType)
  Failed(Value)
}

/// Why a property access can't be handled.
enum PropertyError {
  NoSuchProperty
  NotReadable
  NotWritable
  WrongType(expected~ : ValueType)
  Invalid(Constraint)
}

/// Reads a property of an instance.
type PropertyGet = (Instance, String) -> Result[Value, PropertyError]

/// Sets a property of an instance: the new instance, or the same reference
/// when the value didn't change it.
type PropertySet = (Instance, String, Value) -> Result[Instance, PropertyError]

/// Handles every message of a component type, routing it however it likes.
type MessageHandler = (Instance, Message, Context) -> MessageResult

/// Makes an instance from a map of values. A missing or invalid value takes
/// its default and is reported as an issue; Err is for what defaults can't
/// fix, like a default that breaks its own constraints (JS's NoDefaultError).
type Init = (Map[String, Value], InitContext) -> Result[(Instance, Array[InitIssue]), InitError]

/// What init gets besides its values: the scope the component is being made
/// in, so it can make the components it holds (InitContext::make, like
/// Context::make) from the names that scope resolves.
struct InitContext {
  scope : Scope
}

enum InitError {
  NoDefault(field~ : String, problem~ : InitProblem)
  Failed(Value)
}

struct InitIssue {
  field : String
  problem : InitProblem
}

enum InitProblem {
  Missing
  Unknown // Not a field of the spec; ignored.
  WrongType(expected~ : ValueType)
  Invalid(Constraint)
}

/// The functions a component type provides, one table per type.
struct VTable {
  init : Init
  handle : MessageHandler
  get : PropertyGet
  set : PropertySet
}

/// What a scope keeps for a component type registered under a name.
struct ScopeEntry {
  spec : ComponentSpec
  vtable : VTable
}

/// The names component types are registered under, nested into a tree. A
/// name resolves here first, then in the parents, so inner registrations win
/// and the same name can make different types depending on the scope asked.
struct Scope {
  name : String // "" for the root.
  parent : Scope?
  children : Map[String, Scope]
  entries : Map[String, ScopeEntry]
  /// What asks of this name are answered with, resolved like entries.
  ask_handlers : Map[String, AskHandler]
}

enum MakeError {
  /// Not registered in this scope or any of its parents.
  UnknownComponent(String)
  InitFailed(InitError)
}

/// The scope a name was asked in, or its child named so, made on first use.
fn Scope::enter(self : Scope, name : String) -> Scope {
  match self.children.get(name) {
    Some(child) => child
    None => {
      let child = { name, parent: Some(self), children: {}, entries: {}, ask_handlers: {} }
      self.children[name] = child
      child
    }
  }
}

fn Scope::register(self : Scope, name : String, spec : ComponentSpec, vtable : VTable) -> Unit {
  self.entries[name] = { spec, vtable }
}

fn Scope::lookup(self : Scope, name : String) -> ScopeEntry? {
  match self.entries.get(name) {
    Some(entry) => Some(entry)
    None =>
      match self.parent {
        Some(parent) => parent.lookup(name)
        None => None
      }
  }
}

fn Scope::lookup_ask_handler(self : Scope, name : String) -> AskHandler? {
  match self.ask_handlers.get(name) {
    Some(handler) => Some(handler)
    None =>
      match self.parent {
        Some(parent) => parent.lookup_ask_handler(name)
        None => None
      }
  }
}

/// Makes a component by name. The component gets the scope that was asked,
/// not the parent the entry was found in, so names it asks for resolve from
/// where it was made. Issues from init are returned for the caller to report.
fn Scope::make(
  self : Scope,
  name : String,
  fields : Map[String, Value],
) -> Result[(Component, Array[InitIssue]), MakeError] {
  guard self.lookup(name) is Some({ spec, vtable }) else {
    return Err(UnknownComponent(name))
  }
  match (vtable.init)(fields, { scope: self }) {
    Ok((instance, issues)) => Ok(({ spec, instance, vtable, scope: self }, issues))
    Err(e) => Err(InitFailed(e))
  }
}
```

Paths and the handler context, following `src/paths.js` and `src/tasks.js`
(`MessageContext`) in tutuca js, and `spec/component/paths.rkt` and
`spec/component/action.rkt` in the PLT Redex spec. A path is split by what it
is for:

- an update path: the keys from the root state to a component; reading and
  writing the state goes through it and nothing else does.
- a dispatch path: the frames of rendered ancestry, one per render source or
  loop item entered; notify bubbling and the source key follow it, and it
  resolves to an update path.
- a selector: the steps a handler gives to send a message below it, read
  against the state when they freeze, at commit.
- a route: a dispatch path with its update path.

```moonbit
/// A key in a path: a property of a component or a Map, or an index in a List.
enum PathKey {
  Name(String)
  Index(Int)
}

/// The keys from the root state to a component.
struct UpdatePath {
  keys : Array[PathKey]
}

/// Where a path or a selector can't go.
suberror PathError {
  NoSuchKey(PathKey)
  /// A key into a value that has no keys, or a key of the wrong kind for it.
  NotAContainer(PathKey)
  Property(PathKey, PropertyError)
}

// What the vendored collections give the paths (the adapted pv_get/pv_assoc
// and phm_get/phm_assoc):
//   list_get(List[Value], Int) -> Value?
//   list_assoc(List[Value], Int, Value) -> List[Value]
//   map_get(Map[String, Value], String) -> Value?
//   map_assoc(Map[String, Value], String, Value) -> Map[String, Value]

/// One step down: a component's property through its vtable, a Map's key or a
/// List's index.
fn get_key(value : Value, key : PathKey) -> Value raise PathError {
  let found = match (value, key) {
    (Component(c), Name(name)) =>
      match (c.vtable.get)(c.instance, name) {
        Ok(v) => Some(v)
        Err(e) => raise Property(key, e)
      }
    (Map(m), Name(name)) => map_get(m, name)
    (List(l), Index(i)) => list_get(l, i)
    _ => raise NotAContainer(key)
  }
  guard found is Some(v) else { raise NoSuchKey(key) }
  v
}

/// The value with key set to v, as a new value: a component through its
/// vtable's set, which keeps the component's spec, vtable and scope.
fn set_key(value : Value, key : PathKey, v : Value) -> Value raise PathError {
  match (value, key) {
    (Component(c), Name(name)) =>
      match (c.vtable.set)(c.instance, name, v) {
        Ok(instance) => Component({ ..c, instance, })
        Err(e) => raise Property(key, e)
      }
    (Map(m), Name(name)) => Map(map_assoc(m, name, v))
    (List(l), Index(i)) => List(list_assoc(l, i, v))
    _ => raise NotAContainer(key)
  }
}

fn UpdatePath::get_in(self : UpdatePath, root : Value) -> Value raise PathError {
  let mut v = root
  for key in self.keys {
    v = get_key(v, key)
  }
  v
}

/// The root with the value at this path set to v, as a new root.
fn UpdatePath::set_in(self : UpdatePath, root : Value, v : Value) -> Value raise PathError {
  fn go(value : Value, i : Int) -> Value raise PathError {
    if i == self.keys.length() {
      return v
    }
    let key = self.keys[i]
    set_key(value, key, go(get_key(value, key), i + 1))
  }
  go(root, 0)
}

/// Where a provider captured the value a frame starts from: the frame at
/// depth, then these keys. Frames without one start where the previous ended.
struct Provider {
  name : String
  depth : Int
  keys : Array[PathKey]
}

/// One step of rendered ancestry: a render source, or a loop item entered.
struct Frame {
  keys : Array[PathKey]
  /// The item key, when the frame selects an item of a loop or a seqItem.
  item : PathKey?
  provider : Provider?
  /// A component boundary follows the frame.
  is_component : Bool
}

/// The keys a frame reads from where it starts: its keys, then its item.
fn Frame::access_keys(self : Frame) -> Array[PathKey] {
  match self.item {
    Some(item) => [..self.keys, item]
    None => self.keys
  }
}

/// How a message got to a component: the frames from the root.
struct DispatchPath {
  frames : Array[Frame]
}

fn DispatchPath::is_root(self : DispatchPath) -> Bool {
  self.frames.is_empty()
}

fn DispatchPath::to_parent_path(self : DispatchPath) -> DispatchPath {
  { frames: self.frames[:self.frames.length() - 1].to_owned() }
}

/// Drops trailing frames that aren't component frames: an event inside a
/// loop item belongs to the component whose view has the loop.
fn DispatchPath::to_component_path(self : DispatchPath) -> DispatchPath {
  let mut end = self.frames.length()
  while end > 0 && !self.frames[end - 1].is_component {
    end -= 1
  }
  { frames: self.frames[:end].to_owned() }
}

/// From frames to keys, left to right. A frame starts where the previous one
/// ended or, with a provider, at the end of the first depth frames followed by
/// the provider's keys.
fn DispatchPath::resolve(self : DispatchPath) -> UpdatePath {
  let prefixes : Array[Array[PathKey]] = [[]]
  for frame in self.frames {
    let start = match frame.provider {
      None => prefixes[prefixes.length() - 1]
      Some(p) => [..prefixes[p.depth], ..p.keys]
    }
    prefixes.push([..start, ..frame.access_keys()])
  }
  { keys: prefixes[prefixes.length() - 1] }
}

fn DispatchPath::to_update_path(self : DispatchPath) -> UpdatePath {
  self.to_component_path().resolve()
}

/// The item key of the frame that leads out of the receiver's view, or None
/// when the receiver itself or an ancestor sent it.
fn DispatchPath::source_key_in(self : DispatchPath, receiver : DispatchPath) -> PathKey? {
  let mut i = receiver.frames.length()
  if i >= self.frames.length() {
    return None
  }
  while i < self.frames.length() - 1 && !self.frames[i].is_component {
    i += 1
  }
  self.frames[i].item
}

/// A dispatch path with its update path.
struct Route {
  path : DispatchPath
  update_path : UpdatePath
}

fn route_for(path : DispatchPath) -> Route {
  { path, update_path: path.to_update_path() }
}

/// A step of a selector (JS's PathBuilder calls).
enum SelectorStep {
  /// A field: b.field(name).
  Field(String)
  /// An item of a field: b.item(name, key).
  Item(String, PathKey)
  /// The item of a field whose key another field holds: b.seqItem(name, key_field).
  SeqItem(String, String)
}

/// Where a handler sends a message below it, read against the state when it
/// freezes, at commit.
struct Selector {
  steps : Array[SelectorStep]
}

/// The frames the selector selects in value, one component frame per step. A
/// seqItem whose key field is Null selects the whole field.
fn Selector::freeze(self : Selector, value : Value) -> Array[Frame] raise PathError {
  let frames = []
  let mut v = value
  for step in self.steps {
    let (name, item) = match step {
      Field(name) => (name, None)
      Item(name, key) => (name, Some(key))
      SeqItem(name, key_field) =>
        match get_key(v, Name(key_field)) {
          Null => (name, None)
          String(s) => (name, Some(Name(s)))
          Int(i) => (name, Some(Index(i)))
          _ => raise NotAContainer(Name(key_field))
        }
    }
    let frame = { keys: [Name(name)], item, provider: None, is_component: true }
    frames.push(frame)
    v = UpdatePath::{ keys: frame.access_keys() }.get_in(v)
  }
  frames
}

/// Where a task goes: a dispatch path, then a selector below it.
struct Target {
  base : DispatchPath
  selector : Selector
}

fn Target::freeze(self : Target, root : Value) -> DispatchPath raise PathError {
  let below = self.selector.freeze(self.base.resolve().get_in(root))
  { frames: [..self.base.frames, ..below] }
}

/// What a handler asks for besides its next state, evaluated when it runs.
/// The host turns them into tasks once the handler returns, and they are what
/// a message's emits contract is checked against.
enum Effect {
  /// To the parent, bubbling up until a handler stops it.
  Notify(String, Array[Value])
  /// To the scope's ask handler; the answer comes back as name.ok or
  /// name.error, or name.unhandled.
  Ask(String, Array[Value])
  /// To a component below, by selector.
  SendAt(String, Array[Value], Selector)
  /// The message being handled, to a component below.
  ForwardAt(Selector)
  /// Stop the notify being handled from bubbling further up.
  StopNext
  Log(Value)
}

/// The world, as the host gives it, so a run can be repeated: handlers use
/// these and not the clock or a random source directly.
struct Env {
  now : () -> Double
  random : () -> Double
  uuid : () -> String
}

/// What a message handler gets besides its arguments, the same for every
/// component. The host makes one per handled message.
struct Context {
  /// The handling component's scope, to make components from (e.g. the one
  /// a handler returns in Swapped).
  scope : Scope
  /// The handling component's dispatch path, as a component path.
  path : DispatchPath
  /// The item key of the child the message arrived from, if any.
  source_key : PathKey?
  /// The event, for event tasks (Null otherwise), and what is being dragged,
  /// for drag events (Null otherwise).
  event : Value
  drag : Value
  env : Env
  /// What the handler asked for, in order.
  effects : Array[Effect]
}

fn Context::now(self : Context) -> Double {
  (self.env.now)()
}

fn Context::random(self : Context) -> Double {
  (self.env.random)()
}

fn Context::uuid(self : Context) -> String {
  (self.env.uuid)()
}

fn Context::notify(self : Context, name : String, args : Array[Value]) -> Unit {
  self.effects.push(Notify(name, args))
}

fn Context::ask(self : Context, name : String, args : Array[Value]) -> Unit {
  self.effects.push(Ask(name, args))
}

fn Context::send_at(self : Context, name : String, args : Array[Value], selector : Selector) -> Unit {
  self.effects.push(SendAt(name, args, selector))
}

fn Context::forward_at(self : Context, selector : Selector) -> Unit {
  self.effects.push(ForwardAt(selector))
}

fn Context::stop_next(self : Context) -> Unit {
  self.effects.push(StopNext)
}

fn Context::log(self : Context, value : Value) -> Unit {
  self.effects.push(Log(value))
}
```

The host turns the effects into tasks with targets as JS's `MessageContext`
does: a notify targets the parent path (and is dropped at the root), an ask
the handling component's path, and a send or forward the handling component's
path with the selector below it. JS's `node` (the DOM element of an event
handler) has no counterpart: the wasm side sees the event as a `Value`.

Tasks and the host, following `src/tasks.js` and `src/host.js` in tutuca js and
`spec/system/host.rkt` in the PLT Redex spec. The host keeps the root state and
a queue of tasks and runs one task at a time, each as one transaction: the
handler runs on the component the task's route reaches, its effects become
child tasks, the new root is set, and every child's target freezes against the
new root. Anything that fails aborts the whole transaction: the root stays, the
child tasks are dropped and the failure is observed. Only logs survive, like
any side effect in JS.

```moonbit
/// What a task is: how it reaches its target and what it runs there.
enum TaskKind {
  /// A message to a component: a send, a sendAt, a forwardAt, an async reply.
  Plain
  /// Handled, then sent on to the parent, unless the handler stopped it or it
  /// reached the root.
  Notify
  /// Runs the scope's ask handler, then the reply message on the asker.
  Ask
  /// An event on a rendered element. Its route was fixed when the event was
  /// routed; its args are evaluated when the task runs, against the element's
  /// value and the source key.
  Event(event~ : Value, drag~ : Value)
}

struct Task {
  kind : TaskKind
  name : String
  args : Array[Value]
  /// The dispatch path of the component that sent it.
  source : DispatchPath
  target : Target
  /// Fixed for events and async replies. Every other task's is frozen from
  /// its target against the root at commit.
  route : Route?
}

fn Task::prepare(self : Task, root : Value) -> Task raise PathError {
  match self.route {
    Some(_) => self
    None => { ..self, route: Some(route_for(self.target.freeze(root))) }
  }
}

/// A host-side handle on an answer still to come, like a JS promise.
#external
type PendingAsk

/// What an ask handler answers with: a reply now, or one the host gets later.
enum AskResult {
  Reply(Result[Value, Value])
  Pending(PendingAsk)
}

/// Answers an ask by name; registered on a scope.
type AskHandler = (Array[Value], Context) -> AskResult

/// An ask whose reply hasn't arrived: the reply goes to the asker.
struct PendingReply {
  ask : PendingAsk
  name : String
  source : DispatchPath
}

/// What the host reports while it runs tasks.
enum Observation {
  Log(Value)
  /// A message the component has no handler for: the component stays as it
  /// was, as JS warns and keeps next.
  Unhandled(String)
  /// A task whose transaction aborted.
  Failed(String, Error)
}

suberror TaskError {
  /// The task's route doesn't reach a component.
  NotAComponent
  Rejected(MessageError)
}

struct Host {
  mut root : Value
  queue : Array[Task]
  pending : Array[PendingReply]
  env : Env
  observe : (Observation) -> Unit
}

/// Queues a task, freezing its target against the current root.
fn Host::push(self : Host, task : Task) -> Unit raise {
  self.queue.push(task.prepare(self.root))
}

/// Runs queued tasks, in order, until the queue is empty: the tasks a task
/// queues run after the ones already queued.
fn Host::run(self : Host) -> Unit {
  while self.queue.length() > 0 {
    self.handle_task(self.queue.remove(0))
  }
}

/// An async ask settled: its reply joins the queue, routed to the asker.
fn Host::settle(self : Host, ask : PendingAsk, result : Result[Value, Value]) -> Unit {
  guard self.pending.search_by(p => physical_equal(p.ask, ask)) is Some(i) else { return }
  let { name, source, .. } = self.pending.remove(i)
  let (suffix, value) = match result {
    Ok(v) => (".ok", v)
    Err(e) => (".error", e)
  }
  self.queue.push({
    kind: Plain,
    name: name + suffix,
    args: [value],
    source,
    target: { base: source, selector: { steps: [] } },
    route: Some(route_for(source)),
  })
}

fn Host::handle_task(self : Host, task : Task) -> Unit {
  try self.transaction(task) catch {
    e => (self.observe)(Failed(task.name, e))
  } noraise {
    (root, children) => {
      self.root = root
      for child in children {
        self.queue.push(child)
      }
    }
  }
}

/// One task as one transaction: the new root and the child tasks to queue,
/// prepared against it. The host commits them only if nothing raised.
fn Host::transaction(self : Host, task : Task) -> (Value, Array[Task]) raise {
  guard task.route is Some(route) else { abort("a task is prepared when it's queued") }
  guard route.update_path.get_in(self.root) is Component(c) else { raise NotAComponent }
  let path = route.path.to_component_path()
  let (event, drag) = match task.kind {
    Event(event~, drag~) => (event, drag)
    _ => (Null, Null)
  }
  let ctx : Context = {
    scope: c.scope,
    path,
    source_key: task.source.source_key_in(path),
    event,
    drag,
    env: self.env,
    effects: [],
  }
  let result = match task.kind {
    Ask => self.run_ask(c, task, ctx)
    _ => (c.vtable.handle)(c.instance, { name: task.name, args: task.args }, ctx)
  }
  // Effects run before the result is looked at, so the logs of a handler
  // that rejects its message are observed, as a throwing handler's are.
  let (children, stop) = self.effect_tasks(task, ctx)
  let leaf = match result {
    Unchanged => None
    Updated(instance) => Some(Value::Component({ ..c, instance, }))
    Swapped(other) => Some(Value::Component(other))
    Rejected(UnknownMessage) => {
      (self.observe)(Unhandled(task.name))
      None
    }
    Rejected(e) => raise TaskError::Rejected(e)
  }
  if task.kind is Notify && !path.is_root() && !stop {
    children.push({
      ..task,
      target: { base: path.to_parent_path(), selector: { steps: [] } },
      route: None,
    })
  }
  let root = match leaf {
    // The same root: nothing changed, so nothing renders or syncs.
    None => self.root
    Some(v) => route.update_path.set_in(self.root, v)
  }
  (root, children.map(child => child.prepare(root)))
}

/// An ask runs the scope's ask handler and gives the asker the reply as a
/// message: name.ok, name.error or name.unhandled. A pending
/// answer leaves the asker as it is until the reply arrives.
fn Host::run_ask(self : Host, c : Component, task : Task, ctx : Context) -> MessageResult {
  let reply = (name, args) => (c.vtable.handle)(c.instance, { name, args }, ctx)
  match c.scope.lookup_ask_handler(task.name) {
    None => reply(task.name + ".unhandled", [])
    Some(ask) =>
      match ask(task.args, ctx) {
        Reply(Ok(v)) => reply(task.name + ".ok", [v])
        Reply(Err(e)) => reply(task.name + ".error", [e])
        Pending(p) => {
          self.pending.push({ ask: p, name: task.name, source: task.source })
          Unchanged
        }
      }
  }
}

/// The handler's effects, in order: the child tasks they make, and whether it
/// stopped a notify. Logs are observed as they come.
fn Host::effect_tasks(self : Host, task : Task, ctx : Context) -> (Array[Task], Bool) {
  let tasks = []
  let mut stop = false
  fn child(kind, name, args, base, selector) -> Task {
    { kind, name, args, source: ctx.path, target: { base, selector }, route: None }
  }
  let here : Selector = { steps: [] }
  for fx in ctx.effects {
    match fx {
      Log(v) => (self.observe)(Log(v))
      Notify(name, args) =>
        if !ctx.path.is_root() {
          tasks.push(child(Notify, name, args, ctx.path.to_parent_path(), here))
        }
      Ask(name, args) => tasks.push(child(Ask, name, args, ctx.path, here))
      SendAt(name, args, selector) =>
        tasks.push(child(Plain, name, args, ctx.path, selector))
      ForwardAt(selector) =>
        tasks.push(child(Plain, task.name, task.args, ctx.path, selector))
      StopNext => stop = true
    }
  }
  (tasks, stop)
}
```

What the host does around the transactions, left out above:

- Events: the host routes a DOM event to an `Event` task with its route fixed
  at routing time, against the current DOM and root, and pushes it.
- Rendering: once the queue is empty, if the root isn't the same reference as
  the last one rendered, the host renders it (JS also yields after a 16ms time
  slice and renders then; the spec erases the slice).
- Dev checks: after each committed task the fields that changed are checked
  against their component's spec, and the message against its contract (its
  `emits` against `ctx.effects`). Invariants are checked when the queue is
  empty, since a task can leave them broken for the tasks it queued: they hold
  in quiescent states.

Views and the vdom, following the PLT Redex spec's layers: what a component's
render produces is the semantic tree of `spec/view/sem.rkt`, which says what
the rendered tree means; `spec/bind/lower.rkt` lowers it to the vnodes of
`spec/vdom/vnode.rkt`, writing the wrappers as the metadata comments of
`spec/bind/meta.rkt`; the vdom diffs and patches vnodes into the DOM and knows
nothing of tutuca.

The semantic tree (`spec/view/sem.rkt`):

```moonbit
/// A send argument, evaluated on dispatch against the message context.
enum Arg {
  Value(Value)
  /// The value of the element with the handler.
  TargetValue
  SourceKey
  If(Arg, Arg, Arg)
}

/// What an event sends: (send name arg ...).
struct Action {
  name : String
  args : Array[Arg]
}

/// on:<event>.
struct OnAttr {
  event : String
  action : Action
}

/// Props keep element and iterable values without turning them into children.
enum SPropValue {
  Value(Value)
  Node(SNode)
  Frag(Array[SPropValue])
}

struct SElement {
  /// The template the element comes from, unique in its component type.
  tid : Int
  tag : String
  /// None: the element inherits its parent's.
  ns : String?
  key : String?
  /// Never named key or namespace: those have their own slots.
  props : Array[(String, SPropValue)]
  on : Array[OnAttr]
  children : Array[SNode]
}

/// What evaluating a view produces. Elements keep their event handlers, and
/// wrapper nodes say that their children are the render of a component, are
/// rendered at a frame, or are the items of a loop.
enum SNode {
  El(SElement)
  Text(String)
  /// A comment the view itself writes.
  Comment(String)
  /// An explicit fragment: a sibling key scope.
  Group(String?, Array[SNode])
  /// The render of an instance of the named component type.
  Component(String, Array[SNode])
  /// Rendered at a frame: a field, the selected item of a field, a provided value.
  Enter(Frame, Array[SNode])
  /// A loop, one entry per item.
  Items(Array[Entry])
}

/// A loop item: its key, its frame and its body.
struct Entry {
  key : String?
  frame : Frame
  body : Array[SNode]
}

/// A value an ancestor provides: the value, and where it was captured, the
/// depth of the frame and the keys below it, for the frames that jump to it.
struct Provided {
  value : Value
  depth : Int
  keys : Array[PathKey]
}

/// What a render gets from where it happens (RenderContext without it, binds
/// and component, which stay inside the component's own render).
struct RenderContext {
  provided : Map[String, Provided]
  /// The view names pushed by ancestors (pushView), innermost first.
  views : Array[String]
  /// The frames entered from the root.
  depth : Int
}

/// renderView: a component's view (the one named, or the first of ctx.views
/// it has, or its main view) evaluated inside its component wrapper. Fields
/// read through the vtable's get, so a computed property is a name get
/// answers.
fn render_view(c : Component, view : String?, ctx : RenderContext) -> SNode {
  Component(c.spec.name, c.spec.best_view(view, ctx).eval(c, ctx))
}

/// enterFrame: one frame further, capturing what the value entered provides
/// at its depth; its provides shadow outer ones.
fn RenderContext::enter_frame(self : RenderContext, value : Value) -> RenderContext raise PathError {
  let depth = self.depth + 1
  let provided = self.provided.copy()
  if value is Component(c) {
    for name, selector in c.spec.provides {
      let keys = route_for({ frames: selector.freeze(value) }).update_path
      provided[name] = { value: keys.get_in(value), depth, keys: keys.keys }
    }
  }
  { ..self, provided, depth }
}

/// The frame a provided source enters: a jump to where it was captured.
fn RenderContext::provided_frame(self : RenderContext, name : String) -> Frame? {
  guard self.provided.get(name) is Some(p) else { return None }
  Some({ keys: [], item: None, provider: Some({ name, depth: p.depth, keys: p.keys }), is_component: true })
}

/// The root render: the root component, entered from depth -1.
fn render_root(root : Component) -> Array[SNode] raise PathError {
  let ctx = { provided: {}, views: [], depth: -1 }.enter_frame(Component(root))
  [render_view(root, None, ctx)]
}
```

A component renders a child the way the spec's `x-render` does:
`Enter(frame, [render_view(child, view, ctx.enter_frame(Component(child)))])`,
and a loop item's body with `ctx.enter_frame(item)`.

The vnodes (`spec/vdom/vnode.rkt`):

```moonbit
let html_ns : String = "http://www.w3.org/1999/xhtml"
let svg_ns : String = "http://www.w3.org/2000/svg"
let math_ns : String = "http://www.w3.org/1998/Math/MathML"

/// Props hold opaque values, vnodes and iterables of those.
enum PropValue {
  Value(Value)
  Node(VNode)
  Frag(Array[PropValue])
}

/// An element, with its template id: two templates with the same tag replace
/// rather than patch each other.
struct VElement {
  tid : Int
  tag : String
  ns : String?
  key : String?
  /// Sorted by name, since attribute order isn't observable; never key or
  /// namespace, which have their own slots.
  props : Array[(String, PropValue)]
  children : Array[VNode]
}

enum VNode {
  El(VElement)
  /// An explicit fragment: a sibling key scope, even without a key.
  Group(String?, Array[VNode])
  Text(String)
  Comment(String)
}

/// The tag and namespace of a new element: with no namespace, svg and math
/// are detected case-insensitively and set their own.
fn shape_of(tag : String, ns : String?) -> (String, String?) {
  match (tag.to_lower(), ns) {
    ("svg", None) => ("svg", Some(svg_ns))
    ("math", None) => ("math", Some(math_ns))
    _ => (tag, ns)
  }
}

fn make_el(
  tid : Int,
  tag : String,
  ns : String?,
  key : String?,
  props : Array[(String, PropValue)],
  children : Array[VNode],
) -> VNode {
  let (tag, ns) = shape_of(tag, ns)
  let props = props.copy()
  props.sort_by((a, b) => lexical_compare(a.0, b.0))
  for i in 1..<props.length() {
    if props[i - 1].0 == props[i].0 {
      abort("duplicate prop \{props[i].0}")
    }
  }
  El({ tid, tag, ns, key, props, children })
}

/// Code-unit order, as JS sorts strings (MoonBit's compare puts shorter first).
fn lexical_compare(a : String, b : String) -> Int {
  let n = if a.length() < b.length() { a.length() } else { b.length() }
  for i in 0..<n {
    let c = a.code_unit_at(i).compare(b.code_unit_at(i))
    if c != 0 {
      return c
    }
  }
  a.length().compare(b.length())
}

/// isSameKind: same template and key, so morph patches one into the other.
fn VElement::same_kind(self : VElement, other : VElement) -> Bool {
  self.tid == other.tid && self.key == other.key
}
```

The metadata comments (`spec/bind/meta.rkt`): a wrapper becomes an opening
comment before its children and the closing comment after them. A frame's
`is_component` isn't written: routing restores it from the component boundary
that follows.

```moonbit
enum Meta {
  ComponentMeta
  FrameMeta(Frame)
}

let meta_close : String = "§/§"

fn path_key_json(key : PathKey) -> Json {
  match key {
    Name(s) => Json::string(s)
    Index(i) => Json::number(i.to_double())
  }
}

fn path_keys_json(keys : Array[PathKey]) -> Json {
  Json::array(keys.map(path_key_json))
}

/// The comment text: §{"t":"component"}§ or
/// §{"t":"frame","p":{"v":name,"d":depth,"k":keys}|null,"k":keys,"i":item|null}§.
fn Meta::to_string(self : Meta) -> String {
  let json : Json = match self {
    ComponentMeta => { "t": "component" }
    FrameMeta(f) => {
      "t": "frame",
      "p": match f.provider {
        None => Json::null()
        Some(p) => { "v": Json::string(p.name), "d": Json::number(p.depth.to_double()), "k": path_keys_json(p.keys) }
      },
      "k": path_keys_json(f.keys),
      "i": match f.item {
        None => Json::null()
        Some(k) => path_key_json(k)
      },
    }
  }
  "§\{json.stringify()}§"
}
```

Lowering (`spec/bind/lower.rkt`): a component or frame wrapper becomes its
metadata comment, its children and the closing comment; a loop becomes an
unkeyed fragment of keyed item fragments, so each loop is its own sibling key
scope, and each item is wrapped in its frame's metadata; an element with
handlers gets the data-eid attribute routing finds it by, and its handlers
stay in its component type's table.

```moonbit
fn wrap(meta : Meta, nodes : Array[VNode]) -> Array[VNode] {
  [Comment(meta.to_string()), ..nodes, Comment(meta_close)]
}

fn lower(node : SNode) -> Array[VNode] {
  match node {
    Text(s) => [Text(s)]
    Comment(s) => [Comment(s)]
    Group(key, children) => [Group(key, lower_all(children))]
    El(e) => {
      let props = e.props.map(p => (p.0, lower_value(p.1)))
      if !e.on.is_empty() {
        props.push(("data-eid", Value(Int(e.tid))))
      }
      [make_el(e.tid, e.tag, e.ns, e.key, props, lower_all(e.children))]
    }
    Component(_, children) => wrap(ComponentMeta, lower_all(children))
    Enter(frame, children) => wrap(FrameMeta(frame), lower_all(children))
    Items(entries) =>
      [Group(None, entries.map(e => Group(e.key, wrap(FrameMeta(e.frame), lower_all(e.body)))))]
  }
}

fn lower_all(nodes : Array[SNode]) -> Array[VNode] {
  nodes.iter().flat_map(n => lower(n).iter()).to_array()
}

/// Elements in props are vnode values; a wrapper there is the iterable of its
/// lowered nodes.
fn lower_value(v : SPropValue) -> PropValue {
  match v {
    Value(v) => Value(v)
    Frag(vs) => Frag(vs.map(lower_value))
    Node(n) =>
      match lower(n) {
        [one] => Node(one)
        nodes => Frag(nodes.map(n => PropValue::Node(n)))
      }
  }
}

/// Host.render: the vnodes of the root component's view.
fn lower_root(root : Component) -> Array[VNode] raise PathError {
  lower_all(render_root(root))
}
```

The host renders by lowering the root and morphing the DOM from the last
vnodes to the new ones (`spec/vdom/morph.rkt`): an element patches one of the
same kind, matched by key in its sibling key scope, and replaces any other;
morphing matches vnodes only to the DOM nodes the last render made, so nodes
other code put in a rendered element stay where they are. Routing an event
goes the other way (`spec/bind/decode.rkt`): from the target element up, the
metadata comments decode back to the dispatch path, and the nearest data-eid
names the template whose handlers the component type's table has.

The DOM the host gives the runtime, following the `DomNode` trait of
tutuca-mb's `vdom/dom.mbt`, which morph is written against, as functions the
wasm module imports from the host (module `"dom"`). The trait's methods map one
to one, except where a value can't cross the boundary as it is, as in
tutuca-mb's `wasm/dom.mbt`:

- a node is an `externref`; an absent node is a null reference, so a `DomNode?`
  is a nullable `externref` and needs no sentinel.
- strings are JS strings (`externref` through the JS string builtins); an
  absent string (an element's namespace, an attribute that isn't set) is a
  null reference too.
- `child_nodes` returns an array, so it's `first_child` and `next_sibling`
  instead, and the runtime collects the snapshot.
- `set_property` takes a vdom value, so it's one import per kind of scalar;
  `dangerouslySetInnerHTML` goes through `set_inner_html` and never reaches
  it.

None of them takes or returns a struct.

The signatures are the wax imports written in MoonBit syntax, so `String?` and
`DomNode?` are nullable `externref`s. MoonBit's own `extern "wasm"` stubs
reject `Option` types, which is why tutuca-mb passes `""` and a null node and
imports an `is_null` instead; wax doesn't need that.

```moonbit
/// A DOM node (or the document) as the externref it is.
#external
type DomNode

// Creating nodes, through the document.

/// document.createElementNS(ns, tag, { is }), or createElement when ns is
/// None: HTML.
extern "wasm" fn dom_create_element(doc : DomNode, tag : String, ns : String?, is_attr : String?) -> DomNode =
  "dom" "create_element"

extern "wasm" fn dom_create_text(doc : DomNode, text : String) -> DomNode =
  "dom" "create_text"

extern "wasm" fn dom_create_comment(doc : DomNode, text : String) -> DomNode =
  "dom" "create_comment"

extern "wasm" fn dom_create_fragment(doc : DomNode) -> DomNode =
  "dom" "create_fragment"

// The tree.

extern "wasm" fn dom_append_child(parent : DomNode, child : DomNode) -> Unit =
  "dom" "append_child"

/// Appends when ref_node is None.
extern "wasm" fn dom_insert_before(parent : DomNode, node : DomNode, ref_node : DomNode?) -> Unit =
  "dom" "insert_before"

extern "wasm" fn dom_remove_child(parent : DomNode, child : DomNode) -> Unit =
  "dom" "remove_child"

extern "wasm" fn dom_replace_child(parent : DomNode, node : DomNode, old : DomNode) -> Unit =
  "dom" "replace_child"

/// replaceChildren() with no arguments: removes every child.
extern "wasm" fn dom_replace_children(node : DomNode) -> Unit =
  "dom" "replace_children"

extern "wasm" fn dom_parent_node(node : DomNode) -> DomNode? =
  "dom" "parent_node"

extern "wasm" fn dom_first_child(node : DomNode) -> DomNode? =
  "dom" "first_child"

extern "wasm" fn dom_next_sibling(node : DomNode) -> DomNode? =
  "dom" "next_sibling"

/// isSameNode: externrefs have no identity comparison inside wasm.
extern "wasm" fn dom_is_same_node(a : DomNode, b : DomNode) -> Bool =
  "dom" "is_same_node"

// Attributes and properties.

extern "wasm" fn dom_set_attribute(node : DomNode, name : String, value : String) -> Unit =
  "dom" "set_attribute"

extern "wasm" fn dom_remove_attribute(node : DomNode, name : String) -> Unit =
  "dom" "remove_attribute"

/// None when the attribute isn't set.
extern "wasm" fn dom_get_attribute(node : DomNode, name : String) -> String? =
  "dom" "get_attribute"

/// name in node: whether morph sets it as a property or as an attribute.
extern "wasm" fn dom_has_property(node : DomNode, name : String) -> Bool =
  "dom" "has_property"

// node[name] = value, one per kind of value. Each returns whether the
// assignment held: false when it threw (a read-only property), and morph then
// falls back to the attribute.

extern "wasm" fn dom_set_string_property(node : DomNode, name : String, value : String) -> Bool =
  "dom" "set_string_property"

extern "wasm" fn dom_set_number_property(node : DomNode, name : String, value : Double) -> Bool =
  "dom" "set_number_property"

extern "wasm" fn dom_set_bool_property(node : DomNode, name : String, value : Bool) -> Bool =
  "dom" "set_bool_property"

/// node[name] = null.
extern "wasm" fn dom_set_null_property(node : DomNode, name : String) -> Bool =
  "dom" "set_null_property"

/// The value property, "" when there is none.
extern "wasm" fn dom_get_value(node : DomNode) -> String =
  "dom" "get_value"

extern "wasm" fn dom_get_checked(node : DomNode) -> Bool =
  "dom" "get_checked"

extern "wasm" fn dom_get_inner_html(node : DomNode) -> String =
  "dom" "get_inner_html"

extern "wasm" fn dom_set_inner_html(node : DomNode, html : String) -> Unit =
  "dom" "set_inner_html"

// Text and comment nodes.

/// The character data of a text or comment node.
extern "wasm" fn dom_set_data(node : DomNode, data : String) -> Unit =
  "dom" "set_data"

/// The character data of a text or comment node, "" for other nodes. Routing
/// reads the metadata comments with it.
extern "wasm" fn dom_get_data(node : DomNode) -> String =
  "dom" "get_data"

// What a node is.

/// Uppercase for HTML elements, as in the DOM.
extern "wasm" fn dom_tag_name(node : DomNode) -> String =
  "dom" "tag_name"

/// None for HTML.
extern "wasm" fn dom_namespace_uri(node : DomNode) -> String? =
  "dom" "namespace_uri"

/// The trait's child_nodes: a snapshot, not a live collection.
fn dom_child_nodes(node : DomNode) -> Array[DomNode] {
  let out = []
  let mut at = dom_first_child(node)
  while at is Some(n) {
    out.push(n)
    at = dom_next_sibling(n)
  }
  out
}
```

## Implementation status

The vdom is implemented in `src/*.wax` (README.md has the layout, the build
and the conventions; `npm test` runs it in jsdom, against tutuca's
`src/vdom.js` on random trees, and in Chromium). Where it departs from the
types above:

- Vnodes follow the JS runtime rather than the spec's model: an element holds
  a shared `shape` (tag, namespace, static attrs, the names of the dynamic
  ones) and its dynamic values aligned with the shape's names, instead of a
  `tid` and sorted props. The shape is what a template's `tid` becomes at
  runtime, and same-kind is the same shape and key. Props are `Value`s, as
  planned; props holding vnodes aren't implemented.
- The DOM imports are `src/imports.wax`: the list above, plus `own` and
  `is_owned` (the WeakSet of nodes render made, which morphing matches
  against), `is_same_node` (externrefs have no identity in wasm),
  `set_attribute_number` / `_bool`, and `fail`. The getters nothing uses yet
  (`get_attribute`, `get_value`, `get_checked`, `get_data`) are left out
  until routing needs them.
- Optional strings and nodes are nullable externrefs, as planned: wax accepts
  `&?extern` in imports, where MoonBit's stubs don't.
- The semantic tree and lowering are implemented in `src/sem.wax`,
  `src/meta.wax` and `src/lower.wax`. An element holds its template (id,
  shape, handlers) instead of a tid, tag, namespace and on-attrs: the
  template's shape already has `data-eid` when it has handlers, so lowering
  an element is building its vnode. Props and literal send arguments are
  `Value`s.
- `Value` is implemented in `src/value.wax` with the cases above; Int is i32
  and Float f64. `List` and `Map` are `src/collections.wax`, over wax-mb's
  persistent vector and hash map vendored unmodified in `vendor/wax-mb`
  rather than adapted in place: the adapter types them over `&value`, and the
  map's key policy is fixed to string keys, stored as the `value_string`
  holding the JS string, since the HAMT needs keys in the eq hierarchy. The
  Component case holds the component runtime's `component`.
- The component runtime is implemented (README.md, "The component runtime",
  has how it came out). Departures from the types above: the instance is any
  `&eq`; property access returns an `i32` result code (`property_ok`, ...)
  with the value or instance, and `init` an `init_result` whose issues are a
  list of `{ field, problem }` map values; `ComponentSpec` has the templates
  (the handlers table), the provides, and its schema as data (fields,
  properties, messages with their contracts, invariants, interfaces), which
  the host checks arguments against and dev mode the state; `MessageError`
  also has `InvalidArg(index, reason)`; an `AskHandler` gets the ask's name
  too, `(name, args, ctx)`, and can answer `NotFound` (the host's, when its
  `asks` has none); a pending ask is an int id, not a handle; `Env` is the
  host's `env` import rather than a struct of functions, so `Context` has no
  `env`; a failing task throws out of the transaction instead of returning
  an error, and the JS side, which runs one task per call, reports it; event
  arguments are evaluated when the task runs, as JS does, rather than when the
  event is routed (`Event` above).
- Component modules are implemented (README.md, "Modules: prelude, runtime,
  ABI, components"): the types this note describes are shared by building the
  runtime and each component module with the same prelude (types and i32
  consts only), every function lives once in the runtime and is imported as
  module `"tutuca"` (`src/abi.wax`), and a module exports
  `tutuca_abi_version` and `tutuca_register(scope)`. Scopes are what make
  modules compose: a type made by name resolves to whichever module
  registered it in the scope, or a parent.

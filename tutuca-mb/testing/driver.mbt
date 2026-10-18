///|
/// Runs a component tree through the host in dev mode on memdom, with no timers: tests send
/// messages and dispatch events, then `drain`.
pub struct Driver[R, M] {
  host : @tutuca.Host[@memdom.MemNode]
  app : @tutuca.App[R, M]
  root_node : @memdom.MemNode
  priv comp : @tutuca.Component[R, M]
  priv scope : @tutuca.Scope
  priv view : String?
  reports : Array[@tutuca.Report]
}

///|
/// A driver for `comp` started with `state`. `view` renders the root with that view.
pub fn[R, M] Driver::new(
  comp : @tutuca.Component[R, M],
  state : R,
  scope~ : @tutuca.Scope = @tutuca.Scope::new(),
  view? : String,
  dev~ : Bool = true,
) -> Driver[R, M] {
  let doc = @memdom.document()
  let root_node = doc.element("main")
  let host = @tutuca.Host::new(doc, root_node, dev~, scope~)
  let reports = []
  host.set_on_report(r => reports.push(r))
  let app = host.start(comp, state, view?)
  { host, app, root_node, comp, scope, view, reports, }
}

///|

///|
/// The scope its asks resolve in.
pub fn[R, M] Driver::scope(self : Driver[R, M]) -> @tutuca.Scope {
  self.scope
}

///|
pub fn[R, M] Driver::state(self : Driver[R, M]) -> R {
  self.app.state()
}

///|
/// Sends `msg` to the root and runs the queue.
pub fn[R, M] Driver::send(self : Driver[R, M], msg : M) -> Unit {
  self.app.send(msg)
  self.drain()
}

///|
/// Sends `msg` to the child `at` reaches and runs the queue.
pub fn[R, M, C, CM] Driver::send_to(
  self : Driver[R, M],
  comp : @tutuca.Component[C, CM],
  at : @tutuca.Lens[R, C],
  msg : CM,
) -> Unit {
  self.app.send_to(comp, at, msg)
  self.drain()
}

///|
pub fn[R, M] Driver::drain(self : Driver[R, M]) -> Unit {
  self.host.drain()
}

///|
/// Continues from `state` instead, dropping queued tasks: rewinds a timeline.
pub fn[R, M] Driver::restart(self : Driver[R, M], state : R) -> Driver[R, M] {
  self.host.stop()
  { ..self, app: self.host.start(self.comp, state, view?=self.view), }
}

///|
/// Whether a report is a problem: a failed task or render, invalid state or a broken message
/// contract.
pub fn is_problem(r : @tutuca.Report) -> Bool {
  r is (TaskFailed(_) | StateInvalid(_) | MessageInvalid(_) | RenderFailed(_))
}

///|
pub fn[R, M] Driver::problems(self : Driver[R, M]) -> Array[@tutuca.Report] {
  self.reports.filter(is_problem)
}

///|
/// The problems reported after the first `before` reports.
pub fn[R, M] Driver::problems_since(
  self : Driver[R, M],
  before : Int32,
) -> Array[@tutuca.Report] {
  self.reports[before:].iter().filter(is_problem).to_array()
}

///|
/// One line per problem.
pub fn describe(r : @tutuca.Report) -> String {
  match r {
    Rendered => "rendered"
    TaskHandled(t) => "handled \{t.label}"
    TaskFailed(t, e) => "task failed: \{t.label} at \{t.path.to_string()}: \{e}"
    StateInvalid(issues) =>
      "state invalid: " + issues.map(i => i.to_string()).join("; ")
    MessageInvalid(t, issues) =>
      "message invalid: \{t.label} at \{t.path.to_string()} broke \{issues.join(", ")}"
    RenderFailed(e) => "render failed: \{e}"
  }
}

///|
pub fn[R, M] Driver::html(self : Driver[R, M]) -> String {
  self.root_node.inner_html()
}

///|
/// The rendered text, without whitespace.
pub fn[R, M] Driver::text(self : Driver[R, M]) -> String {
  let sb = StringBuilder()
  for c in self.root_node.text_content() {
    if !(c is (' ' | '\n' | '\t')) {
      sb.write_char(c)
    }
  }
  sb.to_string()
}

///|
/// The elements with this tag, in document order.
pub fn[R, M] Driver::find_all(
  self : Driver[R, M],
  tag : String,
) -> Array[@memdom.MemNode] {
  // HTML tag names are upper case in the DOM, namespaced ones (svg, math) keep theirs.
  let tag = tag.to_lower()
  self.root_node.descendants().filter(n => n.tag_name().to_lower() == tag)
}

///|
/// The first element with this tag, and this text if given.
pub fn[R, M] Driver::find(
  self : Driver[R, M],
  tag : String,
  text? : String,
) -> @memdom.MemNode? {
  self
  .find_all(tag)
  .iter()
  .find_first(n => text is None || Some(n.text_content()) == text)
}

///|
/// Sets a form field's value (a checkbox's checked state for "true"/"false"), when given, and
/// dispatches `event` on `node`, then runs the queue.
pub fn[R, M] Driver::dispatch(
  self : Driver[R, M],
  node : @memdom.MemNode,
  event : String,
  value? : String,
  info~ : @tutuca.EventInfo = @tutuca.EventInfo::new(),
) -> Unit {
  if value is Some(v) {
    if node.get_attribute("type") == Some("checkbox") {
      node.set_checked(v == "true")
    } else if node.tag_name() is ("INPUT" | "TEXTAREA" | "SELECT") {
      node.set_value(v)
    }
  }
  ignore(self.host.handle_event(node, event, info~))
  self.drain()
}

///|
/// Clicks the first element with this tag, and this text if given.
pub fn[R, M] Driver::click(
  self : Driver[R, M],
  tag : String,
  text? : String,
) -> Unit {
  match self.find(tag, text?) {
    Some(node) => self.dispatch(node, "click")
    None => abort("no <\{tag}> with text \{@debug.to_string(text)} to click")
  }
}

///|
/// Types `value` into the first element with this tag and dispatches `event` (input by
/// default).
pub fn[R, M] Driver::type_into(
  self : Driver[R, M],
  tag : String,
  value : String,
  event~ : String = "input",
  nth~ : Int32 = 0,
) -> Unit {
  match self.find_all(tag).get(nth) {
    Some(node) => self.dispatch(node, event, value~)
    None => abort("no <\{tag}> #\{nth} to type into")
  }
}

///|
/// The storybook page's runners, on the browser DOM.
let registry : @storybook.Registry[@browser.JsNode] = @storybook.Registry::new([
  @drawing_stories.drawing_book(),
  @math_stories.math_book(),
  @math_stories.workbench_book(),
  @tracker_stories.thing_tracker_book(),
  @todo_stories.todo_book(),
  @json_stories.json_book(),
  @schema_stories.schema_book(),
  @schema_stories.studio_book(),
  @dev_stories.dev_book(),
])

///|
/// Every story id.
pub fn ids() -> Array[String] {
  registry.stories.keys().to_array()
}

///|
/// Runs story `id` on `root`, an element of the page's document, as a preview does;
/// false when there is no such story.
pub fn mount(id : String, root : @browser.JsNode) -> Bool {
  guard registry.stories.contains(id) else { return false }
  registry.mount(id, @browser.document(), root, connect=@browser.delegate)
  true
}

///|
/// The names of story `id`'s sequences.
pub fn sequences(id : String) -> Array[String] {
  match registry.stories.get(id) {
    Some(s) => s.sequences
    None => []
  }
}

///|
/// Starts sequence `name` of mounted story `id` again from its initial state.
pub fn load(id : String, name : String) -> Unit {
  ignore(registry.call(id, Load(name))) catch {
    _ => ()
  }
}

///|
/// The labels of the loaded sequence's steps.
pub fn steps(id : String) -> Array[String] {
  let summary = registry.call(id, Show) catch { _ => return [] }
  summary.steps.map(s => s.label)
}

///|
/// The problems of mounted story `id`'s current entry.
pub fn problems(id : String) -> Array[String] {
  let summary = registry.call(id, Show) catch { e => return ["\{e}"] }
  summary.problems
}

///|
/// Runs the next step of the loaded sequence: its status, a tab and its error.
pub fn forward(id : String) -> String {
  guard registry.runners.get(id) is Some(r) else {
    return "failed\tnot mounted"
  }
  let result = (r.forward)()
  "\{result.status}\t\{result.error}"
}

///|
fn main {

}

///|
/// Mounted story `id`'s summary as JSON: what it shows, for comparing specs.
pub fn summary_json(id : String) -> String {
  let summary = registry.call(id, Show) catch { e => return "\{e}" }
  ToJson::to_json(summary).stringify()
}

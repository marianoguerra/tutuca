///|
/// The story a run opens with: the first of `wanted` that `ids` has (the story asked for,
/// then the one the last run showed), else the first story, else none.
pub fn choose_story(ids : Array[String], wanted : Array[String]) -> String {
  for w in wanted {
    if w != "" && ids.contains(w) {
      return w
    }
  }
  ids.get(0).unwrap_or("")
}

///|
/// What fails a run before it starts: each story's check() issues, by story, deduplicated
/// (stories of one component share them); "" when there are none.
pub fn issues_of(
  books : Array[Array[(String, Array[@tutuca.Issue])]],
) -> String {
  let seen = []
  let lines = []
  for stories in books {
    for story in stories {
      for issue in story.1 {
        let text = issue.to_string()
        if !seen.contains(text) {
          seen.push(text)
          lines.push("\{story.0}: \{text}")
        }
      }
    }
  }
  if lines.is_empty() {
    ""
  } else {
    "The components have issues, which keep them from rendering:\n" +
    lines.join("\n")
  }
}

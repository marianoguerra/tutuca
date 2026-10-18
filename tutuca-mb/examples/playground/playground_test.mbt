///|
test "a run keeps the story asked for when the books still have it" {
  let ids = ["Math/Two roots", "Math/Double root"]
  assert_eq(
    @playground.choose_story(ids, ["Math/Double root", "Math/Two roots"]),
    "Math/Double root",
  )
  // The story asked for is gone: the one the last run showed.
  assert_eq(
    @playground.choose_story(ids, ["Gone", "Math/Two roots"]),
    "Math/Two roots",
  )
}

///|
test "a run without a wanted story opens the first one, or none" {
  assert_eq(@playground.choose_story(["A/a", "A/b"], ["", "Gone"]), "A/a")
  assert_eq(@playground.choose_story([], ["A/a"]), "")
}

///|
test "issues fail a run, listed once per component" {
  let issue : @tutuca.Issue = {
    path: "C.main <div>",
    message: "`x` is set more than once",
  }
  inspect(@playground.issues_of([[("A/a", []), ("A/b", [])]]), content="")
  inspect(
    @playground.issues_of([[("A/a", [issue]), ("A/b", [issue])]]),
    content=(
      #|The components have issues, which keep them from rendering:
      #|A/a: C.main <div>: `x` is set more than once
    ),
  )
}

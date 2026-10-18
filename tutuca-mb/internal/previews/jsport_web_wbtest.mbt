// The <tutuca-app> key format; the element itself is checked in jsdom by
// scripts/smoke-storybook.mjs.

///|
test "app-key: a prefix, a story id and an optional @seed" {
  assert_eq(parse_key("JSON/Bool (edit)", ""), Some(("JSON/Bool (edit)", 0)))
  assert_eq(
    parse_key("Math/Quadratic/Generated@3", ""),
    Some(("Math/Quadratic/Generated", 3)),
  )
  assert_eq(parse_key("a:Todo/Task@12", "a:"), Some(("Todo/Task", 12)))
  // Another storybook's key isn't this one's.
  assert_eq(parse_key("b:Todo/Task", "a:"), None)
  // An @ not followed by a number is part of the id.
  assert_eq(parse_key("Mail/To a@b", ""), Some(("Mail/To a@b", 0)))
  assert_eq(parse_key("a:Story@part@7", "a:"), Some(("Story@part", 7)))
  assert_eq(parse_key("a:Story@", "a:"), Some(("Story", 0)))
}

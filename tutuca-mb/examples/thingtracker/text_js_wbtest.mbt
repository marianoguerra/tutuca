///|
test "on js, search strips every diacritic NFD separates, as the JS version" {
  // Vietnamese and Greek marks are beyond the Latin table text_table.mbt has.
  assert_eq(normalize(" Phở Ệ ά "), "pho e α")
  assert_true(locale_compare("é", "f") < 0)
  assert_true(locale_compare("a", "A") < 0)
}

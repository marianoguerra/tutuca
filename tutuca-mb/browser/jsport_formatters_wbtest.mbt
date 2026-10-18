// Ports of test/dev/vdom-formatters.test.js's install tests: the formatter installed on
// globalThis, once, and leaving every value it didn't build to the native view.

///|
extern "js" fn tutuca_formatter_count() -> Int32 =
  #|() => (globalThis.devtoolsFormatters ?? []).filter((f) => f.tutuca).length

///|
/// The installed formatter's header and hasBody for `v`, as "null"/"header" and the boolean.
extern "js" fn formatter_sees(v : JsValue) -> String =
  #|(v) => {
  #|  const f = globalThis.devtoolsFormatters.find((f) => f.tutuca);
  #|  return `${f.header(v) === null ? "null" : "header"} ${f.hasBody(v)}`;
  #|}

///|
/// The values JS's test feeds it, with a described value inside the mixed array, as JS's
/// `[1, h("p")]`.
extern "js" fn unknown_values(d : JsValue) -> FixedArray[JsValue] =
  #|(d) => [1, "s", null, undefined, {}, [], [1, d], () => {}]

///|
test "install is idempotent per target" {
  install_formatters()
  install_formatters()
  assert_eq(tutuca_formatter_count(), 1)
}

///|
test "ignores values it doesn't know" {
  install_formatters()
  let d = described(@dev.describe_json({ "a": 1 }))
  assert_eq(formatter_sees(d), "header true")
  for v in unknown_values(d) {
    assert_eq(formatter_sees(v), "null false")
  }
}

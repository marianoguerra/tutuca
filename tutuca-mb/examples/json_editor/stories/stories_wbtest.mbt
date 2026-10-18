///|
test "a random pick reaches the value still to be chosen, nested too, as JS's setTo" {
  let start = edit(
    JArray({
      items: @tutuca.Vec::of([
        JNull,
        JObject({ entries: @tutuca.Vec::of([{ key: "k", value: Choose, }]), }),
      ]),
    }),
  )
  let target = value_messages()[0]
  let d = @testing.Driver::new(json_editor, start)
  assert_eq(choices(d.state().value, at_value).length(), 1)
  // decode picks the place by its key, as the storybook's send form does.
  let key = (target.keys)(d.state())[0]
  let msg : @json.ChooseMsg = SetTo(Number)
  ((target.decode)(d.state(), msg.to_json().stringify(), key).send_app)(d.app)
  d.drain()
  assert_eq(d.problems().length(), 0)
  assert_eq(choices(d.state().value, at_value).length(), 0)
  assert_eq(
    d.state().value.to_json_value(),
    Json::array([Json::null(), Json::object({ "k": Json::number(0) })]),
  )
}
